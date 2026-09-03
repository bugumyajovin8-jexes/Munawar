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
    default_discount_percent: num(fields, "default_discount_percent"),
    notes: str(fields, "notes"),
    is_active: fields.is_active !== "false",
  });
}

/**
 * A branch, as this device believes it, before the server has seen it.
 *
 * Written so an invoice raised minutes later — still with no signal — can name
 * it. The id was minted here, so the reference is real even though nothing has
 * synced.
 */
export function branchRow(id: string, fields: Record<string, string>): Row {
  return pending({
    id,
    customer_id: str(fields, "customer_id"),
    name: str(fields, "name") ?? "Branch",
    address: str(fields, "address"),
    city: str(fields, "city"),
    // Left as typed. The server normalises to E.164 and the next pull corrects
    // this row, so guessing here would only be wrong in a different way.
    phone_e164: str(fields, "phone_e164"),
    contact_person: str(fields, "contact_person"),
    is_active: fields.is_active !== "false",
    created_at: new Date().toISOString(),
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

/**
 * An invoice and its lines, as this device believes them, before the server
 * has seen either.
 *
 * Without this, issuing offline reserved a real number and then showed you
 * nothing: the invoice list stayed empty and the document you had just
 * promised a customer could not be printed, because it existed only as a
 * queued operation. The server still owns the arithmetic — it recomputes every
 * total when the queue drains, and the next pull replaces these rows — but the
 * screen no longer has to wait for that to admit the invoice exists.
 */
export function invoiceRow(input: {
  id: string;
  customerId: string;
  /** Null while it is a draft; the formatted number once issued. */
  number: string | null;
  draftRef: string;
  status: "draft" | "issued";
  orderDate: string;
  invoiceDate: string | null;
  dueDate: string | null;
  termsDays: number;
  vatMode: string;
  vatRate: number;
  subtotal: number;
  discountPercent: number;
  discountAmount: number;
  branchId: string | null;
  branchName: string | null;
  vatTotal: number;
  total: number;
  customerTin: string | null;
}): Row {
  return pending({
    id: input.id,
    customer_id: input.customerId,
    doc_type: "invoice",
    number: input.number,
    draft_ref: input.draftRef,
    status: input.status,
    order_date: input.orderDate,
    invoice_date: input.invoiceDate,
    ship_date: null,
    due_date: input.dueDate,
    terms_days: input.termsDays,
    vat_mode: input.vatMode,
    vat_rate: input.vatRate,
    subtotal: input.subtotal,
    // Both, for the same reason the table stores both: the screens read the
    // amount and only consult the percentage to label it.
    discount_percent: input.discountPercent,
    discount_amount: input.discountAmount,
    // The name as well as the id, because the document prints the snapshot and
    // this row is what the document is rendered from until the next pull.
    branch_id: input.branchId,
    branch_name: input.branchName,
    // vat_amount, not vat_total: that is the column name in the invoices
    // table and therefore what every screen reads. Writing the wrong key left
    // an invoice raised offline with no VAT figure at all — silently zero
    // anywhere it was summed — until the next pull replaced the row.
    vat_amount: input.vatTotal,
    total: input.total,
    customer_tin: input.customerTin,
    created_at: new Date().toISOString(),
  });
}

export function invoiceItemRows(
  invoiceId: string,
  lines: {
    id: string;
    product_id: string | null;
    description: string;
    unit: string;
    qty: number;
    unit_price: number;
    vat_applicable: boolean;
    line_subtotal: number;
    line_vat: number;
    line_total: number;
  }[],
): Row[] {
  return lines.map((line, index) =>
    pending({
      id: line.id,
      invoice_id: invoiceId,
      line_no: index + 1,
      product_id: line.product_id,
      description: line.description,
      unit: line.unit,
      qty: line.qty,
      unit_price: line.unit_price,
      vat_applicable: line.vat_applicable,
      line_subtotal: line.line_subtotal,
      line_vat: line.line_vat,
      line_total: line.line_total,
      /*
       * Never carried, even for an admin.
       *
       * The mirror is filled from invoice_items_view, which returns cost as
       * NULL for a sales role. Writing a cost here would put on the device the
       * one number that whole arrangement exists to keep off it.
       */
    }),
  );
}
