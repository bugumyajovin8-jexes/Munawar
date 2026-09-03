import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/auth";
import { saveBranch, saveCustomer } from "@/app/(app)/customers/actions";
import { saveProduct } from "@/app/(app)/products/actions";
import {
  saveDraft,
  recordPayment,
  issueInvoiceFromBlock,
  setCustomerTin,
} from "@/app/(app)/invoices/actions";
import { logReminder } from "@/app/(app)/reminders/actions";
import type {
  CustomerTinOpBody,
  IssueOpBody,
  SyncResult,
} from "@/lib/offline/types";
import { isRedirect, isTransient } from "@/lib/offline/retryable";

/**
 * Drains a device's outbox.
 *
 * Deliberately not a second implementation of the write API: each operation is
 * handed to the very same server action the online path uses, so validation,
 * permissions and revalidation cannot drift between "saved now" and "saved
 * later". All this route adds is the exactly-once guard and ordering.
 *
 * Operations are applied strictly in the order the device recorded them, and
 * the batch stops at the first failure. Two edits to one customer must not
 * land backwards, and an invoice must not be written before the customer it
 * names.
 *
 * The distinction this route turns on is between an operation the server
 * *looked at and refused* and one it never got the chance to apply. They used
 * to be the same thing. A statement timeout, a dropped database connection, a
 * cold start that ran out of time — all of it came back as "rejected", which
 * the device reads as "retrying will not help" and files under work needing a
 * human. Cash taken in a shop then sat blocked behind a problem that had
 * already fixed itself. See lib/offline/retryable.ts.
 */
export const dynamic = "force-dynamic";

const opSchema = z.object({
  id: z.string().uuid(),
  kind: z.enum([
    "customer.save",
    "branch.save",
    "product.save",
    "payment.record",
    "invoice.draft",
    "reminder.log",
    "invoice.issue",
    "customer.tin",
  ]),
  body: z.unknown(),
});

const requestSchema = z.object({ ops: z.array(opSchema).min(1).max(25) });

type Op = z.infer<typeof opSchema>;

function formData(body: unknown): FormData {
  const fd = new FormData();
  if (body && typeof body === "object") {
    for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
      if (value !== null && value !== undefined) fd.set(key, String(value));
    }
  }
  return fd;
}

type Applied = { error: null; data?: { invoiceId?: string } };
type Failed = { error: string };

async function apply(op: Op): Promise<Applied | Failed> {
  switch (op.kind) {
    case "customer.save": {
      const result = await saveCustomer(formData(op.body));
      return result.ok ? { error: null } : { error: result.error };
    }
    case "branch.save": {
      const result = await saveBranch(formData(op.body));
      return result.ok ? { error: null } : { error: result.error };
    }
    case "product.save": {
      const result = await saveProduct(formData(op.body));
      return result.ok ? { error: null } : { error: result.error };
    }
    case "payment.record": {
      const result = await recordPayment(
        op.body as Parameters<typeof recordPayment>[0],
      );
      return result.ok ? { error: null } : { error: result.error };
    }
    case "invoice.draft": {
      const result = await saveDraft(op.body);
      // The id goes back so a device that was online all along can open the
      // draft it just saved, exactly as it did before the outbox existed.
      return result.ok
        ? { error: null, data: { invoiceId: result.invoiceId } }
        : { error: result.error };
    }
    case "reminder.log": {
      const result = await logReminder(op.body as Parameters<typeof logReminder>[0]);
      return result.ok ? { error: null } : { error: result.error };
    }
    case "customer.tin": {
      const result = await setCustomerTin(op.body as CustomerTinOpBody);
      return result.ok ? { error: null } : { error: result.error };
    }
    /*
     * An invoice issued in the field. The number came from this device's own
     * block, and the server checks it against the range it granted before
     * booking anything — a number that was never lent, or already used, is
     * refused and the invoice stays a draft. That refusal is a rejection
     * rather than a retry: sending it again unchanged would fail identically.
     */
    case "invoice.issue": {
      const body = op.body as IssueOpBody;
      const result = await issueInvoiceFromBlock(
        body.invoiceId,
        body.deviceId,
        body.number,
        body.shipDate,
        body.issuedOn ?? null,
      );
      return result.ok
        ? { error: null, data: { invoiceId: body.invoiceId } }
        : { error: result.error };
    }
  }
}

export async function POST(request: Request) {
  // Checked here rather than inside the actions: requireSession() redirects,
  // which a fetch from the outbox would follow into an HTML login page and
  // report as success. The queue needs a 401 it can recognise.
  const session = await getSession();
  if (!session) {
    return Response.json({ error: "Not signed in." }, { status: 401 });
  }

  let parsed;
  try {
    parsed = requestSchema.safeParse(await request.json());
  } catch {
    return Response.json({ error: "Malformed request." }, { status: 400 });
  }
  if (!parsed.success) {
    return Response.json({ error: "Malformed request." }, { status: 400 });
  }

  const supabase = await createClient();
  const results: SyncResult[] = [];
  let stopped = false;

  for (const op of parsed.data.ops) {
    if (stopped) {
      results.push({ id: op.id, status: "skipped" });
      continue;
    }

    // Claim the id first. If the claim is refused this operation already ran —
    // most likely its acknowledgement was lost on the way back to the phone.
    // 0010 makes that refusal mean it, by reclaiming a stale unfinished claim.
    const { data: claimed, error: claimError } = await supabase.rpc("begin_client_op", {
      p_op_id: op.id,
      p_kind: op.kind,
    });

    if (claimError) {
      // The ledger itself is unreachable. Nothing was attempted, so this is
      // always worth another go.
      results.push({ id: op.id, status: "deferred", error: claimError.message });
      stopped = true;
      continue;
    }
    if (claimed === false) {
      results.push({ id: op.id, status: "duplicate" });
      continue;
    }

    let outcome: Applied | Failed;
    let transient = false;

    try {
      outcome = await apply(op);
    } catch (error) {
      if (isRedirect(error)) {
        // The session went during the batch. Answering 401 is what the queue
        // is built to understand, and it keeps every remaining item intact.
        await supabase.rpc("release_client_op", { p_op_id: op.id });
        return Response.json({ error: "Session expired." }, { status: 401 });
      }

      transient = isTransient(error);
      outcome = {
        error: error instanceof Error ? error.message : "Could not apply this change.",
      };
    }

    if (outcome.error !== null) {
      /*
       * Give the id back either way.
       *
       * A refusal means nothing was written — the action decided before
       * touching anything — so the claim is holding an id against work that
       * never happened, and a corrected retry would be mistaken for a replay.
       * A transient failure is the same in almost every case, and where it is
       * not, 0010's completion flag is what stops the retry: an operation that
       * committed but never finished its claim is only reclaimed after ten
       * minutes, by which time nothing is in flight.
       */
      await supabase.rpc("release_client_op", { p_op_id: op.id });
      results.push({
        id: op.id,
        status: transient ? "deferred" : "rejected",
        error: outcome.error,
      });
      stopped = true;
      continue;
    }

    // Only now is the claim more than provisional. Until this lands, a crash
    // leaves an unfinished claim that a later attempt may take over.
    await supabase.rpc("finish_client_op", { p_op_id: op.id });

    results.push({ id: op.id, status: "applied", data: outcome.data });
  }

  return Response.json({ results }, { headers: { "cache-control": "no-store" } });
}
