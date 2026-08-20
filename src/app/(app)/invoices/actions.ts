"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth";

const lineSchema = z.object({
  product_id: z.string().uuid().nullable(),
  description: z.string().min(1, "Every line needs a description."),
  unit: z.string().min(1),
  qty: z.number().positive("Quantity must be greater than zero."),
  unit_price: z.number().min(0, "Price cannot be negative."),
  vat_applicable: z.boolean(),
});

const draftSchema = z.object({
  invoice_id: z.string().uuid().nullable(),
  customer_id: z.string().uuid("Choose a customer."),
  order_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid order date."),
  terms_days: z.number().int().min(0).max(365),
  vat_mode: z.enum(["exclusive", "none"]),
  customer_notes: z.string().nullable(),
  internal_notes: z.string().nullable(),
  items: z.array(lineSchema).min(1, "Add at least one line item."),
});

export type DraftPayload = z.infer<typeof draftSchema>;
export type ActionResult =
  | { ok: true; invoiceId: string; number?: string | null }
  | { ok: false; error: string };

/** Everything funnels through save_draft_invoice() so the DB owns the maths. */
async function persistDraft(payload: DraftPayload): Promise<string> {
  const supabase = await createClient();

  /*
   * A draft built with no signal brings its own id, so that its lines — and an
   * invoice raised from it minutes later, still offline — have something real
   * to reference. save_draft_invoice() treats an id it cannot find as an
   * error, which is right for an edit and wrong for that case, so the shell
   * row is created first. Editing an existing draft finds it and returns.
   */
  if (payload.invoice_id) {
    const { error } = await supabase.rpc("ensure_draft", {
      p_invoice_id: payload.invoice_id,
      p_customer_id: payload.customer_id,
    });
    if (error) throw new Error(error.message);
  }

  const { data, error } = await supabase.rpc("save_draft_invoice", {
    p_invoice_id: payload.invoice_id,
    p_customer_id: payload.customer_id,
    p_order_date: payload.order_date,
    p_terms_days: payload.terms_days,
    p_vat_mode: payload.vat_mode,
    p_customer_notes: payload.customer_notes,
    p_internal_notes: payload.internal_notes,
    p_items: payload.items,
  });

  if (error) throw new Error(error.message);
  return data as string;
}

export async function saveDraft(raw: unknown): Promise<ActionResult> {
  await requireSession();

  const parsed = draftSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the form." };
  }

  try {
    const invoiceId = await persistDraft(parsed.data);
    revalidatePath("/invoices");
    revalidatePath(`/customers/${parsed.data.customer_id}`);
    return { ok: true, invoiceId };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not save the draft." };
  }
}

/**
 * Save and issue in one step — the "invoice it now" path, as opposed to
 * saving a draft today and issuing it on the day the goods actually ship.
 */
export async function saveAndIssue(
  raw: unknown,
  shipDate: string | null,
): Promise<ActionResult> {
  await requireSession();

  const parsed = draftSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the form." };
  }

  const supabase = await createClient();

  try {
    const invoiceId = await persistDraft(parsed.data);

    const { data, error } = await supabase.rpc("issue_invoice", {
      p_invoice_id: invoiceId,
      p_ship_date: shipDate,
      p_invoice_date: null,
    });
    if (error) throw new Error(error.message);

    revalidatePath("/invoices");
    revalidatePath(`/customers/${parsed.data.customer_id}`);
    return {
      ok: true,
      invoiceId,
      number: (data as { number?: string } | null)?.number ?? null,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not issue the invoice." };
  }
}

/**
 * Requirement #9: a draft raised on the 12th but shipped on the 15th gets its
 * invoice date, number and due date stamped on the 15th — at this moment.
 */
export async function issueInvoice(
  invoiceId: string,
  shipDate: string | null,
): Promise<ActionResult> {
  await requireSession();
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("issue_invoice", {
    p_invoice_id: invoiceId,
    p_ship_date: shipDate,
    p_invoice_date: null,
  });
  if (error) return { ok: false, error: error.message };

  revalidatePath("/invoices");
  revalidatePath(`/invoices/${invoiceId}`);
  return {
    ok: true,
    invoiceId,
    number: (data as { number?: string } | null)?.number ?? null,
  };
}

/**
 * Issue an invoice using a number this device was lent in advance.
 *
 * The number is not trusted. issue_invoice_from_block() checks it against the
 * range the server actually granted to this device and refuses anything else,
 * so a client cannot book an invoice under a number nobody can account for.
 */
export async function issueInvoiceFromBlock(
  invoiceId: string,
  deviceId: string,
  number: number,
  shipDate: string | null,
): Promise<ActionResult> {
  await requireSession();
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("issue_invoice_from_block", {
    p_invoice_id: invoiceId,
    p_device: deviceId,
    p_number: number,
    p_ship_date: shipDate,
    p_invoice_date: null,
  });
  if (error) return { ok: false, error: error.message };

  revalidatePath("/invoices");
  revalidatePath(`/invoices/${invoiceId}`);
  return {
    ok: true,
    invoiceId,
    number: (data as { number?: string } | null)?.number ?? null,
  };
}

export async function voidInvoice(
  invoiceId: string,
  reason: string,
): Promise<ActionResult> {
  await requireSession();
  const supabase = await createClient();

  const { error } = await supabase.rpc("void_invoice", {
    p_invoice_id: invoiceId,
    p_reason: reason,
  });
  if (error) return { ok: false, error: error.message };

  revalidatePath("/invoices");
  revalidatePath(`/invoices/${invoiceId}`);
  return { ok: true, invoiceId };
}

export async function deleteDraft(invoiceId: string): Promise<ActionResult> {
  await requireSession();
  const supabase = await createClient();

  const { error } = await supabase.rpc("delete_draft_invoice", {
    p_invoice_id: invoiceId,
  });
  if (error) return { ok: false, error: error.message };

  revalidatePath("/invoices");
  return { ok: true, invoiceId };
}

/**
 * Prices previously agreed with this customer. Feeds the builder so a
 * one-off discount becomes the price you are offered next time, instead of
 * something you have to remember.
 */
export async function getCustomerPrices(
  customerId: string,
): Promise<Record<string, number>> {
  await requireSession();
  const supabase = await createClient();

  const { data } = await supabase
    .from("customer_prices")
    .select("product_id, agreed_price")
    .eq("customer_id", customerId);

  const map: Record<string, number> = {};
  for (const row of data ?? []) {
    map[row.product_id as string] = Number(row.agreed_price);
  }
  return map;
}

export async function recordPayment(input: {
  invoiceId: string;
  amount: number;
  paidOn: string;
  method: string;
  reference: string | null;
  note: string | null;
}): Promise<ActionResult> {
  await requireSession();
  const supabase = await createClient();

  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    return { ok: false, error: "Enter an amount greater than zero." };
  }

  const { error } = await supabase.rpc("record_payment", {
    p_invoice_id: input.invoiceId,
    p_amount: input.amount,
    p_paid_on: input.paidOn,
    p_method: input.method,
    p_reference: input.reference,
    p_note: input.note,
  });
  if (error) return { ok: false, error: error.message };

  revalidatePath("/invoices");
  revalidatePath(`/invoices/${input.invoiceId}`);
  revalidatePath("/payments");
  return { ok: true, invoiceId: input.invoiceId };
}

/**
 * Corrections on an issued invoice go through a credit note — the invoice
 * itself is frozen. Pass itemIds to credit only some lines.
 */
export async function createCreditNote(
  invoiceId: string,
  reason: string,
  itemIds: string[] | null,
): Promise<ActionResult> {
  await requireSession();
  const supabase = await createClient();

  if (!reason.trim()) {
    return { ok: false, error: "Give a reason for the credit note." };
  }

  const { data, error } = await supabase.rpc("create_credit_note", {
    p_invoice_id: invoiceId,
    p_reason: reason.trim(),
    p_item_ids: itemIds && itemIds.length > 0 ? itemIds : null,
  });
  if (error) return { ok: false, error: error.message };

  const created = data as { id?: string; number?: string } | null;

  revalidatePath("/invoices");
  revalidatePath(`/invoices/${invoiceId}`);
  return {
    ok: true,
    invoiceId: created?.id ?? invoiceId,
    number: created?.number ?? null,
  };
}

/** Repeat orders are the common case — copy the lines into a fresh draft. */
export async function duplicateInvoice(invoiceId: string): Promise<ActionResult> {
  await requireSession();
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("duplicate_invoice", {
    p_invoice_id: invoiceId,
  });
  if (error) return { ok: false, error: error.message };

  revalidatePath("/invoices");
  return { ok: true, invoiceId: data as string };
}

export async function deletePayment(
  paymentId: string,
  invoiceId: string,
): Promise<ActionResult> {
  await requireSession();
  const supabase = await createClient();

  const { error } = await supabase.rpc("delete_payment", { p_payment_id: paymentId });
  if (error) return { ok: false, error: error.message };

  revalidatePath(`/invoices/${invoiceId}`);
  revalidatePath("/payments");
  return { ok: true, invoiceId };
}
