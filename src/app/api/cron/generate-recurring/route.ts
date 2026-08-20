import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
// Never cached — it mutates.
export const dynamic = "force-dynamic";

/**
 * Nightly recurring-invoice generation.
 *
 * Runs under the service role because it works across every org, which no
 * user session can do. `generate_due_recurring_invoices()` has EXECUTE revoked
 * from anon and authenticated for exactly that reason.
 *
 * Vercel Cron sends `Authorization: Bearer $CRON_SECRET`. Requests without it
 * are rejected, so the endpoint cannot be triggered by anyone who finds the URL.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;

  if (!secret) {
    return Response.json(
      { error: "CRON_SECRET is not configured — refusing to run." },
      { status: 500 },
    );
  }

  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${secret}`) {
    return Response.json({ error: "Unauthorised" }, { status: 401 });
  }

  try {
    const admin = createAdminClient();
    const { data, error } = await admin.rpc("generate_due_recurring_invoices");

    if (error) {
      return Response.json({ ok: false, error: error.message }, { status: 500 });
    }

    // Housekeeping while we are here: drop idempotency records older than any
    // queue could plausibly be. Failing this must not fail the night's
    // invoicing, so its error is reported and not thrown.
    const { data: pruned, error: pruneError } = await admin.rpc("prune_client_ops");

    return Response.json({
      ok: true,
      ...(data as Record<string, unknown>),
      prunedClientOps: pruneError ? pruneError.message : pruned,
    });
  } catch (e) {
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 },
    );
  }
}
