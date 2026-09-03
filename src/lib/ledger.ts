/**
 * The running-balance arithmetic behind a statement.
 *
 * Deliberately free of any import that touches the network or the browser, for
 * the same reason derive.ts is: `npm run test:statement` compiles this file on
 * its own and runs it. A statement is the document a customer checks with a
 * calculator, and the one figure that must never be wrong is the one at the
 * bottom.
 */
import { PAYMENT_METHOD_LABELS, type PaymentMethod } from "./types";

/** Rounded at every step, the way the database and derive.ts both do it. */
function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export type LineStatus = {
  state: "unpaid" | "partial" | "paid";
  /** Still owing on this invoice. Zero once settled. */
  remaining: number;
};

export type StatementLine = {
  date: string;
  kind: "invoice" | "payment" | "credit_note";
  reference: string;
  description: string;
  /**
   * How the money arrived. Only ever set on payment lines.
   *
   * Held separately from `description` rather than parsed back out of it: the
   * statement export shows the method in a column of its own, and recovering
   * "Mobile Money" from "Payment received (Mobile Money) · TX4471" would be a
   * regular expression standing between a customer and a correct document.
   */
  method: string | null;
  /**
   * Only on invoice lines. A payment is not a thing that is itself paid, and a
   * credit note reduces a debt rather than carrying one.
   */
  status: LineStatus | null;
  /** Increases what the customer owes. */
  debit: number;
  /** Reduces what the customer owes. */
  credit: number;
  balance: number;
  invoiceId: string;
  /**
   * Which branch this belongs to. A payment inherits it from the invoice it
   * was recorded against, which is the reason grouping is possible at all: had
   * payments been recorded against the customer, a lump sum covering three
   * branches could not have been attributed to any of them.
   */
  branchId: string | null;
};

/**
 * One branch's own sub-ledger.
 *
 * A statement is a running balance, not a list, so branches cannot simply be
 * sorted together — the balance column would stop meaning anything. Each
 * branch instead gets a ledger of its own: its opening balance, its
 * transactions, its closing balance. The closings add up to the customer's,
 * because every group is built by the same function from a partition of the
 * same rows.
 */
export type StatementGroup = {
  /** Null is the customer's head office — invoices raised for no branch. */
  branchId: string | null;
  branchName: string;
  openingBalance: number;
  lines: StatementLine[];
  closingBalance: number;
  totalInvoiced: number;
  totalPaid: number;
};

export type InvoiceRow = {
  id: string;
  number: string;
  doc_type: string;
  invoice_date: string;
  total: number;
  branch_id: string | null;
};

export type PaymentRow = {
  invoice_id: string;
  paid_on: string;
  amount: number;
  method: string;
  reference: string | null;
};

/**
 * One running ledger, from whatever slice of the account it is handed.
 *
 * Extracted so the customer's statement and each branch's section are built by
 * the same code from a partition of the same rows. That is what guarantees the
 * branch closing balances add up to the customer's — two copies of this,
 * however carefully written, would eventually disagree by a shilling on the
 * one statement somebody checks with a calculator.
 */
export function ledger(
  invoices: InvoiceRow[],
  payments: PaymentRow[],
  from: string,
  to: string,
  numberById: Map<string, string>,
  branchOf: Map<string, string | null>,
): Omit<StatementGroup, "branchId" | "branchName"> {
  // Opening balance: everything that happened strictly before the window.
  let openingBalance = 0;
  for (const inv of invoices) {
    if (inv.invoice_date < from) openingBalance += Number(inv.total);
  }
  for (const p of payments) {
    if (p.paid_on < from) openingBalance -= Number(p.amount);
  }
  openingBalance = round2(openingBalance);

  // What each invoice has received by the end of the period. Payments after
  // `to` are excluded on purpose — see LineStatus.
  const paidByInvoice = new Map<string, number>();
  for (const p of payments) {
    if (p.paid_on > to) continue;
    paidByInvoice.set(
      p.invoice_id,
      round2((paidByInvoice.get(p.invoice_id) ?? 0) + Number(p.amount)),
    );
  }

  const lines: StatementLine[] = [];

  for (const inv of invoices) {
    const date = inv.invoice_date;
    if (date < from || date > to) continue;
    const isCredit = inv.doc_type === "credit_note";
    const amount = Number(inv.total);

    const paid = paidByInvoice.get(inv.id) ?? 0;
    const remaining = round2(amount - paid);

    lines.push({
      date,
      kind: isCredit ? "credit_note" : "invoice",
      reference: inv.number,
      description: isCredit ? "Credit note" : "Invoice",
      // An invoice is not a payment and has no method. Blank rather than a
      // dash, so the column can be filtered to "how were we actually paid".
      method: null,
      // Overpaid counts as paid and reports nothing still owing: the question
      // this column answers is "does the customer still owe on this?".
      status: isCredit
        ? null
        : {
            state: remaining <= 0 ? "paid" : paid > 0 ? "partial" : "unpaid",
            remaining: Math.max(0, remaining),
          },
      debit: isCredit ? 0 : amount,
      credit: isCredit ? Math.abs(amount) : 0,
      balance: 0,
      invoiceId: inv.id,
      branchId: inv.branch_id,
    });
  }

  for (const p of payments) {
    const date = p.paid_on;
    if (date < from || date > to) continue;
    const method = PAYMENT_METHOD_LABELS[p.method as PaymentMethod] ?? "Payment";
    const ref = p.reference ? ` · ${p.reference}` : "";

    lines.push({
      date,
      kind: "payment",
      reference: numberById.get(p.invoice_id) ?? "—",
      description: `Payment received (${method})${ref}`,
      method,
      status: null,
      debit: 0,
      credit: Number(p.amount),
      balance: 0,
      invoiceId: p.invoice_id,
      // Inherited from the invoice it settles, which is what makes a payment
      // groupable at all.
      branchId: branchOf.get(p.invoice_id) ?? null,
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

  return { openingBalance, lines, closingBalance: running, totalInvoiced, totalPaid };
}
