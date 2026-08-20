"use client";

/**
 * Turning what the user just typed into a row the mirror can show immediately.
 *
 * Recording a payment used to change nothing on screen. The work was safe — it
 * was in the outbox and it would sync — but every figure still came from the
 * server, so the invoice went on insisting it was unpaid. An app that takes
 * your input and shows no sign of it is one you stop trusting, whatever it
 * says in a sync panel.
 *
 * So the write goes into the mirror at the same moment it goes into the queue.
 * These rows are approximations: the server still normalises phone numbers,
 * recomputes VAT and stamps its own timestamps, and the next pull replaces
 * them with whatever it actually stored. The optimistic copy is only ever in
 * front of the truth, never instead of it — which is why nothing here needs to
 * be exactly right, only recognisable.
 */
import type { Row } from "./db";

function str(fields: Record<string, string>, key: string): string | null {
  const value = fields[key]?.trim();
  return value ? value : null;
}

function num(fields: Record<string, string>, key: string, fallback = 0): number {
  const value = Number(fields[key]);
  return Number.isFinite(value) ? value : fallback;
}

/** Marks a row as this device's guess, so screens can show it as unsent. */
function pending(row: Row): Row {
  return { ...row, _pending: true, updated_at: new Date().toISOString() };
}

export function customerRow(id: string, fields: Record<string, string>): Row {
  return pending({
    id,
    name: str(fields, "name") ?? "Customer",
    contact_person: str(fields, "contact_person"),
    // Left exactly as typed. The server normalises it to E.164 and the next
    // pull corrects this row, so guessing at the format here would only risk
    // showing a number that is wrong in a different way.
    phone_e164: str(fields, "phone_e164") ?? str(fields, "phone"),
    email: str(fields, "email"),
    address: str(fields, "address"),
    city: str(fields, "city"),
    tin: str(fields, "tin"),
    vrn: str(fields, "vrn"),
    payment_terms_days: num(fields, "payment_terms_days", 30),
    credit_limit: num(fields, "credit_limit"),
    notes: str(fields, "notes"),
    is_active: fields.is_active !== "false",
  });
}

export function productRow(id: string, fields: Record<string, string>): Row {
  return pending({
    id,
    sku: str(fields, "sku"),
    name: str(fields, "name") ?? "Product",
    description: str(fields, "description"),
    unit: str(fields, "unit") ?? "pcs",
    selling_price: num(fields, "selling_price"),
    /*
     * Never carried locally, even when an admin typed it.
     *
     * The mirror is read back by whoever is signed in on this device, and the
     * pull deliberately returns cost as NULL for a sales role. Writing a cost
     * here would put on the device the one number the whole grant and view
     * arrangement exists to keep off it.
     */
    vat_applicable: fields.vat_applicable !== "false",
    is_active: fields.is_active !== "false",
  });
}

export function paymentRow(
  id: string,
  body: {
    invoiceId: string;
    amount: number;
    paidOn: string;
    method: string;
    reference: string | null;
    note: string | null;
  },
): Row {
  return pending({
    id,
    invoice_id: body.invoiceId,
    amount: body.amount,
    paid_on: body.paidOn,
    method: body.method,
    reference: body.reference,
    note: body.note,
    created_at: new Date().toISOString(),
  });
}
