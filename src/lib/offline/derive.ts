/**
 * The figures the database used to compute in a view, computed here instead.
 *
 * invoice_balances and customer_balances are SQL views, which means they exist
 * only where SQL does. A device that has been offline for a month still has to
 * answer "what does this customer owe me?" — so the arithmetic moves to where
 * the data now lives.
 *
 * No browser imports, deliberately: `npm run test:derive` runs this directly.
 * Money is the one thing in this app that must not be quietly wrong, and every
 * rule below (drafts are not debts, voids are not debts, credit notes subtract)
 * is a decision that would be invisible if it were wrong by one row.
 */

export type MirrorInvoice = {
  id: string;
  customer_id: string;
  total: number | string;
  status: string;
  due_date: string | null;
};

export type MirrorPayment = {
  invoice_id: string;
  amount: number | string;
};

function money(value: number | string | null | undefined): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

/** Rounded to the cent at every step, the way the database does it. */
export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * Only issued documents are debts.
 *
 * A draft is something the user is still writing and a void is something they
 * took back; counting either as owed would overstate what the business is due,
 * which is the more dangerous direction to be wrong in.
 */
export function isOwed(invoice: MirrorInvoice): boolean {
  return invoice.status === "issued";
}

export function paidByInvoice(payments: MirrorPayment[]): Map<string, number> {
  const paid = new Map<string, number>();
  for (const payment of payments) {
    const id = payment.invoice_id;
    paid.set(id, round2((paid.get(id) ?? 0) + money(payment.amount)));
  }
  return paid;
}

export type Balance = { balance: number; overdue: number };

/**
 * What each customer owes, and how much of it is late.
 *
 * A credit note is stored as an invoice with a negative total, so it subtracts
 * here simply by being summed — no special case, which is why it cannot be
 * forgotten in one place and applied in another.
 */
export function customerBalances(
  invoices: MirrorInvoice[],
  payments: MirrorPayment[],
  today: string,
): Map<string, Balance> {
  const paid = paidByInvoice(payments);
  const totals = new Map<string, Balance>();

  for (const invoice of invoices) {
    if (!isOwed(invoice)) continue;

    const outstanding = round2(money(invoice.total) - (paid.get(invoice.id) ?? 0));
    // A settled invoice contributes nothing. An overpaid one contributes its
    // negative balance, which is genuinely money held on the customer's behalf.
    if (outstanding === 0) continue;

    const current = totals.get(invoice.customer_id) ?? { balance: 0, overdue: 0 };
    current.balance = round2(current.balance + outstanding);

    // Compared as ISO date strings, which sort correctly and sidestep the
    // timezone question entirely — "due today" must not become "overdue"
    // because the device is three hours ahead of the business.
    if (outstanding > 0 && invoice.due_date && invoice.due_date < today) {
      current.overdue = round2(current.overdue + outstanding);
    }

    totals.set(invoice.customer_id, current);
  }

  return totals;
}

/** One invoice's own position, for the detail screen and the list. */
export function invoiceBalance(
  invoice: MirrorInvoice,
  payments: MirrorPayment[],
): { paid: number; balance: number; settled: boolean } {
  const paid = round2(
    payments
      .filter((payment) => payment.invoice_id === invoice.id)
      .reduce((sum, payment) => sum + money(payment.amount), 0),
  );
  const balance = round2(money(invoice.total) - paid);
  return { paid, balance, settled: balance <= 0 };
}

export function isOverdue(invoice: MirrorInvoice, balance: number, today: string): boolean {
  return balance > 0 && Boolean(invoice.due_date) && invoice.due_date! < today;
}

export type PaymentState = "paid" | "partial" | "unpaid";

/**
 * The word the status badge shows.
 *
 * Overpaid counts as paid rather than as its own state: the balance goes
 * negative and the invoice is certainly not still owing, which is the question
 * the badge is answering.
 */
export function paymentState(total: number, paid: number): PaymentState {
  if (round2(total - paid) <= 0) return "paid";
  return paid > 0 ? "partial" : "unpaid";
}

/**
 * Whole days a due date has been missed by, counting from dates rather than
 * from timestamps.
 *
 * Both sides are plain ISO dates, so this cannot drift by a day because the
 * device is in a different timezone than the business — which is the same
 * reason today_local() exists on the server.
 */
export function daysLate(dueDate: string | null, today: string): number {
  if (!dueDate || dueDate >= today) return 0;
  const due = Date.parse(`${dueDate}T00:00:00Z`);
  const now = Date.parse(`${today}T00:00:00Z`);
  if (Number.isNaN(due) || Number.isNaN(now)) return 0;
  return Math.round((now - due) / 86_400_000);
}

export type Ageing = {
  current: number;
  d1_30: number;
  d31_60: number;
  d61_90: number;
  d90plus: number;
  overdueCount: number;
};

/**
 * How old a customer's debt is, in the buckets an accountant expects.
 *
 * "Current" is everything not yet late, which includes an invoice due
 * tomorrow — it is not a debt problem until the date passes. The boundaries
 * are inclusive at the bottom and exclusive at the top so no amount can land
 * in two buckets or fall between them, which is the mistake that makes an
 * ageing report quietly fail to add up to the balance above it.
 */
function emptyAgeing(): Ageing {
  return { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90plus: 0, overdueCount: 0 };
}

/** Shared by the total and the per-customer breakdown, so they cannot disagree. */
function addToBucket(out: Ageing, late: number, balance: number): void {
  if (late > 0) out.overdueCount += 1;

  if (late <= 0) out.current = round2(out.current + balance);
  else if (late <= 30) out.d1_30 = round2(out.d1_30 + balance);
  else if (late <= 60) out.d31_60 = round2(out.d31_60 + balance);
  else if (late <= 90) out.d61_90 = round2(out.d61_90 + balance);
  else out.d90plus = round2(out.d90plus + balance);
}

export function ageing(
  invoices: MirrorInvoice[],
  payments: MirrorPayment[],
  today: string,
): Ageing {
  const paid = paidByInvoice(payments);
  const out = emptyAgeing();

  for (const invoice of invoices) {
    if (!isOwed(invoice)) continue;

    const balance = round2(money(invoice.total) - (paid.get(invoice.id) ?? 0));
    if (balance <= 0) continue;

    addToBucket(out, daysLate(invoice.due_date, today), balance);
  }

  return out;
}

export type CustomerAgeing = Ageing & { customerId: string; balance: number };

/**
 * The same buckets, split by who owes them.
 *
 * This is the aged-receivables table, which used to come from the
 * customer_balances view — SQL, and therefore only available with a
 * connection. It shares addToBucket with the total above deliberately: an
 * ageing report whose rows do not add up to the figure printed above them is
 * worse than no report, and that is exactly what two copies of the boundary
 * conditions would eventually produce.
 */
export function ageingByCustomer(
  invoices: MirrorInvoice[],
  payments: MirrorPayment[],
  today: string,
): CustomerAgeing[] {
  const paid = paidByInvoice(payments);
  const out = new Map<string, CustomerAgeing>();

  for (const invoice of invoices) {
    if (!isOwed(invoice)) continue;

    const balance = round2(money(invoice.total) - (paid.get(invoice.id) ?? 0));
    if (balance === 0) continue;

    let row = out.get(invoice.customer_id);
    if (!row) {
      row = { customerId: invoice.customer_id, balance: 0, ...emptyAgeing() };
      out.set(invoice.customer_id, row);
    }

    row.balance = round2(row.balance + balance);
    // An overpayment is money held on their behalf, not debt of an age.
    if (balance > 0) addToBucket(row, daysLate(invoice.due_date, today), balance);
  }

  return [...out.values()].sort((a, b) => b.balance - a.balance);
}

/**
 * The document number as a string, built exactly as the database builds it.
 *
 * A duplicate of format_document_number() in 0008, and duplicated on purpose:
 * an invoice issued offline has to show its number before the server has ever
 * seen it, and it must be the same string the server will store — otherwise
 * the customer's copy and the ledger's copy disagree over a document nobody
 * can reissue. `npm run test:derive` pins the two together.
 */
export function formatDocumentNumber(
  docType: string,
  year: number,
  num: number,
): string {
  const prefix =
    docType === "invoice"
      ? "INV"
      : docType === "credit_note"
        ? "CN"
        : docType === "proforma"
          ? "PRO"
          : "DOC";

  return `${prefix}-${year}-${String(num).padStart(4, "0")}`;
}

export type MirrorItem = {
  invoice_id: string;
  /** NULL for a sales role, and absent entirely on an unsynced local row. */
  line_profit?: number | null;
};

export type GrossProfit =
  | { value: number }
  /** Nothing to measure, and the reason matters — see below. */
  | { value: null; reason: "no-invoices" | "not-synced" | "no-cost-prices" };

/**
 * Gross profit across a set of invoices.
 *
 * Returns null rather than zero when it cannot be computed, and says why.
 * Zero is a real and meaningful answer — you sold at cost — so showing it for
 * "there is nothing to add up" tells the owner their month was worthless when
 * in fact the app simply has no figures. The three causes are genuinely
 * different problems and each needs different words on screen:
 *
 *   no-invoices     nothing was issued in the period. Not a fault.
 *   not-synced      invoices are here but their lines are not, so the cost
 *                   side is missing. Fixed by syncing.
 *   no-cost-prices  the lines are here and carry no profit — either the
 *                   products have no buying price, or the caller is a sales
 *                   role, for whom the view returns NULL by design.
 */
export function grossProfit(
  items: MirrorItem[],
  invoiceIds: Set<string>,
  /**
   * Invoice id to the discount given on it, for the invoices in scope.
   *
   * line_profit is a line's own margin at the price on the line, and a
   * whole-invoice discount is not on any line — so without this every
   * discounted sale reports the margin somebody would have made if they had
   * not discounted it. Optional because a caller with no discounted invoices
   * in range has nothing to pass, and omitting it is the pre-discount
   * behaviour exactly.
   */
  discountByInvoice?: Map<string, number>,
): GrossProfit {
  if (invoiceIds.size === 0) return { value: null, reason: "no-invoices" };

  const relevant = items.filter((item) => invoiceIds.has(item.invoice_id));
  if (relevant.length === 0) return { value: null, reason: "not-synced" };

  // `!= null` on purpose: a row that has never reached the server has no
  // line_profit key at all, and `!== null` would wave undefined through and
  // quietly count it as zero.
  const known = relevant.filter((item) => item.line_profit != null);
  if (known.length === 0) return { value: null, reason: "no-cost-prices" };

  const gross = known.reduce((sum, item) => sum + Number(item.line_profit), 0);

  /*
   * Only the invoices that actually contributed a margin. Subtracting the
   * discount of an invoice whose lines came back without cost prices would
   * take money off a figure that never included the sale.
   */
  let given = 0;
  if (discountByInvoice) {
    for (const id of new Set(known.map((item) => item.invoice_id))) {
      given += discountByInvoice.get(id) ?? 0;
    }
  }

  return { value: round2(gross - given) };
}
