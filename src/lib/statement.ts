import "server-only";
import { createClient } from "./supabase/server";
import { selectIn } from "./supabase/chunked";
import type { Customer, CustomerBalance } from "./types";
import { HEAD_OFFICE } from "./statement-scope";
import {
  ledger,
  type InvoiceRow,
  type PaymentRow,
  type StatementGroup,
  type StatementLine,
} from "./ledger";

// Re-exported so callers need only this module, as they did before the
// arithmetic moved out into a file that can be tested on its own.
export type { LineStatus, StatementLine, StatementGroup } from "./ledger";

// Re-exported so a server caller needs only this module.
export { HEAD_OFFICE };

/**
 * A statement of account: what they owed at the start of the period, every
 * invoice and payment since, and what they owe now.
 *
 * Built here rather than in the page so the screen, the print view and the
 * Excel export are all guaranteed to show identical figures.
 */

/**
 * Where one invoice stands, as at the end of the statement period.
 *
 * Deliberately "as at `to`" rather than as of today: a statement is a claim
 * about a period, and a line that says "paid" using money received after the
 * period closed would not reconcile with the closing balance printed beneath
 * it.
 */
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
  /**
   * One group per branch that actually appears on this statement.
   *
   * Empty when the customer has never been invoiced through a branch, which is
   * how a business that does not use them never sees the word — the same rule
   * the discount follows.
   */
  groups: StatementGroup[];
  /** Every branch this customer has, for the filter control. */
  branches: { id: string; name: string }[];
  /** Which branch this statement was narrowed to, if any. */
  branchFilter: string | null;
};



export async function buildStatement(
  customerId: string,
  from: string,
  to: string,
  /**
   * A branch id, HEAD_OFFICE for invoices raised for no branch, or null for
   * the whole account. Narrowing recomputes the opening balance too — a branch
   * statement that opened with the customer's total would be worse than none.
   */
  branchFilter: string | null = null,
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
    .select("id, number, doc_type, invoice_date, total, branch_id")
    .eq("customer_id", customerId)
    .eq("status", "issued")
    .lte("invoice_date", to)
    .order("invoice_date");

  const allInvoices = (invoiceRows ?? []) as unknown as InvoiceRow[];
  const invoiceIds = allInvoices.map((i) => i.id);

  /*
   * Chunked, and the error is not swallowed.
   *
   * invoiceIds is every issued invoice for this customer since they started
   * trading — the opening balance needs all of it — so a long-standing
   * customer put hundreds of uuids into a URL. When that failed, the old code
   * read the empty result as "no payments" and produced a statement showing
   * the customer owing every shilling they had ever been invoiced. There is no
   * worse way for this particular document to be wrong.
   */
  const { rows: paymentRows, error: paymentsError } = await selectIn(
    invoiceIds,
    (ids) =>
      supabase
        .from("payments")
        .select("id, invoice_id, paid_on, amount, method, reference")
        .in("invoice_id", ids)
        .lte("paid_on", to),
  );

  if (paymentsError) {
    throw new Error(`Could not read this customer's payments: ${paymentsError}`);
  }

  const allPayments = paymentRows as unknown as PaymentRow[];
  const numberById = new Map(allInvoices.map((i) => [i.id, i.number]));
  const branchOf = new Map<string, string | null>(
    allInvoices.map((i) => [i.id, i.branch_id]),
  );

  const { data: branchRows } = await supabase
    .from("customer_branches")
    .select("id, name")
    .eq("customer_id", customerId)
    .order("name");
  const branches = (branchRows ?? []) as { id: string; name: string }[];
  const nameById = new Map(branches.map((b) => [b.id, b.name]));

  /*
   * The scope this statement covers. Filtered here rather than in the query so
   * there is one code path: the opening balance, the lines and the groups are
   * all built from the same set.
   */
  const wanted = (branchId: string | null) =>
    branchFilter === null ||
    (branchFilter === HEAD_OFFICE ? branchId === null : branchId === branchFilter);

  const invoices = allInvoices.filter((i) => wanted(i.branch_id));
  const payments = allPayments.filter((p) => wanted(branchOf.get(p.invoice_id) ?? null));

  const whole = ledger(invoices, payments, from, to, numberById, branchOf);

  /*
   * Sections, but only where they say something.
   *
   * A customer with no branch-tagged invoices gets none, so a business that
   * does not use branches sees exactly the statement it saw before branches
   * existed. Neither does one already narrowed to a single branch — that is
   * that branch's ledger, and wrapping it in a section headed with its own
   * name would only repeat the filter back.
   */
  const groups: StatementGroup[] = [];
  const usesBranches = allInvoices.some((i) => i.branch_id !== null);

  if (branchFilter === null && usesBranches) {
    // Head office first, then branches by name: the account's own transactions
    // before the places it delegates to.
    const ids: (string | null)[] = [
      ...(invoices.some((i) => i.branch_id === null) ? [null] : []),
      ...branches
        .map((b) => b.id)
        .filter((id) => invoices.some((i) => i.branch_id === id)),
    ];

    for (const branchId of ids) {
      groups.push({
        branchId,
        branchName: branchId === null ? "Head office" : (nameById.get(branchId) ?? "Branch"),
        ...ledger(
          invoices.filter((i) => i.branch_id === branchId),
          payments.filter((p) => (branchOf.get(p.invoice_id) ?? null) === branchId),
          from,
          to,
          numberById,
          branchOf,
        ),
      });
    }
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
    ...whole,
    ageing: (ageingRow as CustomerBalance | null) ?? null,
    groups,
    branches,
    branchFilter,
  };
}

/** Default window: start of the current year through today. */
export function defaultRange(today: string): { from: string; to: string } {
  return { from: `${today.slice(0, 4)}-01-01`, to: today };
}
