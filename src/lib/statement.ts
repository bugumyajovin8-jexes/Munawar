import "server-only";
import { createClient } from "./supabase/server";
import { round2 } from "./money";
import { PAYMENT_METHOD_LABELS } from "./types";
import type { Customer, CustomerBalance, PaymentMethod } from "./types";

/**
 * A statement of account: what they owed at the start of the period, every
 * invoice and payment since, and what they owe now.
 *
 * Built here rather than in the page so the screen, the print view and the
 * Excel export are all guaranteed to show identical figures.
 */

export type StatementLine = {
  date: string;
  kind: "invoice" | "payment" | "credit_note";
  reference: string;
  description: string;
  /** Increases what the customer owes. */
  debit: number;
  /** Reduces what the customer owes. */
  credit: number;
  balance: number;
  invoiceId: string;
};

export type Statement = {
  customer: Customer;
  from: string;
  to: string;
  openingBalance: number;
  lines: StatementLine[];
  closingBalance: number;
  totalInvoiced: number;
  totalPaid: number;
  ageing: CustomerBalance | null;
};

export async function buildStatement(
  customerId: string,
  from: string,
  to: string,
): Promise<Statement | null> {
  const supabase = await createClient();

  const { data: customerRow } = await supabase
    .from("customers")
    .select("*")
    .eq("id", customerId)
    .maybeSingle();
  if (!customerRow) return null;

  // Voided documents never appear on a statement — they carry no value.
  const { data: invoiceRows } = await supabase
    .from("invoices")
    .select("id, number, doc_type, invoice_date, total, customer_notes")
    .eq("customer_id", customerId)
    .eq("status", "issued")
    .lte("invoice_date", to)
    .order("invoice_date");

  const invoices = invoiceRows ?? [];
  const invoiceIds = invoices.map((i) => i.id as string);

  const { data: paymentRows } = invoiceIds.length
    ? await supabase
        .from("payments")
        .select("id, invoice_id, paid_on, amount, method, reference")
        .in("invoice_id", invoiceIds)
        .lte("paid_on", to)
        .order("paid_on")
    : { data: [] };

  const payments = paymentRows ?? [];
  const numberById = new Map(invoices.map((i) => [i.id as string, i.number as string]));

  // Opening balance: everything that happened strictly before the window.
  let openingBalance = 0;
  for (const inv of invoices) {
    if ((inv.invoice_date as string) < from) openingBalance += Number(inv.total);
  }
  for (const p of payments) {
    if ((p.paid_on as string) < from) openingBalance -= Number(p.amount);
  }
  openingBalance = round2(openingBalance);

  const lines: StatementLine[] = [];

  for (const inv of invoices) {
    const date = inv.invoice_date as string;
    if (date < from || date > to) continue;
    const isCredit = inv.doc_type === "credit_note";
    const amount = Number(inv.total);

    lines.push({
      date,
      kind: isCredit ? "credit_note" : "invoice",
      reference: inv.number as string,
      description: isCredit ? "Credit note" : "Invoice",
      debit: isCredit ? 0 : amount,
      credit: isCredit ? Math.abs(amount) : 0,
      balance: 0,
      invoiceId: inv.id as string,
    });
  }

  for (const p of payments) {
    const date = p.paid_on as string;
    if (date < from || date > to) continue;
    const method = PAYMENT_METHOD_LABELS[p.method as PaymentMethod] ?? "Payment";
    const ref = p.reference ? ` · ${p.reference}` : "";

    lines.push({
      date,
      kind: "payment",
      reference: numberById.get(p.invoice_id as string) ?? "—",
      description: `Payment received (${method})${ref}`,
      debit: 0,
      credit: Number(p.amount),
      balance: 0,
      invoiceId: p.invoice_id as string,
    });
  }

  // Same-day ordering: invoice before the payment that settles it.
  const order = { invoice: 0, credit_note: 1, payment: 2 };
  lines.sort((a, b) => a.date.localeCompare(b.date) || order[a.kind] - order[b.kind]);

  let running = openingBalance;
  let totalInvoiced = 0;
  let totalPaid = 0;

  for (const line of lines) {
    running = round2(running + line.debit - line.credit);
    line.balance = running;
    totalInvoiced = round2(totalInvoiced + line.debit);
    totalPaid = round2(totalPaid + line.credit);
  }

  const { data: ageingRow } = await supabase
    .from("customer_balances")
    .select("*")
    .eq("customer_id", customerId)
    .maybeSingle();

  return {
    customer: customerRow as Customer,
    from,
    to,
    openingBalance,
    lines,
    closingBalance: running,
    totalInvoiced,
    totalPaid,
    ageing: (ageingRow as CustomerBalance | null) ?? null,
  };
}

/** Default window: start of the current year through today. */
export function defaultRange(today: string): { from: string; to: string } {
  return { from: `${today.slice(0, 4)}-01-01`, to: today };
}
