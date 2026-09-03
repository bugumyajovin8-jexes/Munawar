import { getSession } from "@/lib/auth";
import { buildStatement, defaultRange } from "@/lib/statement";
import { buildWorkbook, xlsxResponse, TONE } from "@/lib/excel";
import { formatDate, todayLocal } from "@/lib/format";
import { PAYMENT_STATE_LABELS } from "@/lib/types";

export const runtime = "nodejs";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ customerId: string }> },
) {
  const session = await getSession();
  if (!session) return new Response("Unauthorised", { status: 401 });

  const { customerId } = await params;
  const url = new URL(request.url);
  const fallback = defaultRange(todayLocal());
  const fromParam = url.searchParams.get("from");
  const toParam = url.searchParams.get("to");
  const from = fromParam && DATE_RE.test(fromParam) ? fromParam : fallback.from;
  const to = toParam && DATE_RE.test(toParam) ? toParam : fallback.to;

  /*
   * Narrowed the same way the screen is, so the spreadsheet somebody downloads
   * is the statement they were looking at. Exporting the whole account from a
   * page showing one branch would be a quiet substitution of one document for
   * another.
   */
  const branch = url.searchParams.get("branch");
  const statement = await buildStatement(customerId, from, to, branch || null);
  if (!statement) return new Response("Customer not found", { status: 404 });

  /*
   * Status is written as words rather than a code, and left blank on rows
   * where it would be meaningless.
   *
   * A payment is not itself paid, and a credit note reduces a debt rather than
   * carrying one — writing "Unpaid" against either would be read as a customer
   * owing money they do not. An empty cell says "this question does not apply"
   * far more clearly than any label would.
   */
  const nameById = new Map(statement.branches.map((b) => [b.id, b.name]));
  const branchName = (id: string | null) => (id ? (nameById.get(id) ?? "") : "Head office");

  const rows = [
    {
      date: from,
      // The opening and closing labels move into Reference now that there is
      // no Description column to hold them. Shortened to fit the narrower
      // column: the dates they used to repeat are already in the period line
      // under the title.
      reference: "Opening balance",
      branch: "",
      method: "",
      status: "",
      remaining: null,
      debit: null,
      credit: null,
      balance: statement.openingBalance,
    },
    ...statement.lines.map((line) => ({
      date: line.date,
      reference: line.reference,
      // A column rather than sections: a spreadsheet is sorted and filtered by
      // whoever opens it, and a branch column is what lets them do that. The
      // sectioning belongs to the printed document.
      branch: branchName(line.branchId),
      // Just the method — "Payment received (Mobile Money)" said the obvious
      // three times over in a column that had to be 44 characters wide to
      // hold it.
      method: line.method ?? "",
      status: line.status ? PAYMENT_STATE_LABELS[line.status.state] : "",
      // Zero on a settled invoice would be indistinguishable from a blank on a
      // payment row once the sheet is sorted or filtered, so only rows that
      // genuinely still owe something carry a figure.
      remaining: line.status && line.status.remaining > 0 ? line.status.remaining : null,
      debit: line.debit || null,
      credit: line.credit || null,
      balance: line.balance,
    })),
  ];

  const data = await buildWorkbook([
    {
      name: "Statement",
      title: `Statement of Account — ${statement.customer.name}`,
      subtitle: [
        session.org.legal_name || session.org.name,
        session.org.tin ? `TIN: ${session.org.tin}` : "",
        `Period: ${formatDate(from)} to ${formatDate(to)}`,
        `All amounts in ${session.org.currency}`,
      ].filter(Boolean),
      /*
       * Every width here is deliberate: the whole sheet has to be readable
       * without scrolling sideways, and the old Description column was 44
       * characters wide on its own — a third of the page spent on the words
       * "Invoice" and "Payment received (Mobile Money)".
       *
       * The method it carried is worth keeping and is now a column of its own,
       * narrow because "Mobile Money" is the longest thing it will ever hold.
       */
      columns: [
        { header: "Date", key: "date", format: "date", width: 12 },
        { header: "Reference", key: "reference", width: 16 },
        /*
         * Only for a customer who is invoiced through branches. A column of
         * "Head office" repeated four hundred times is a column somebody has
         * to hide before the sheet is readable.
         */
        ...(statement.branches.length > 0
          ? [{ header: "Branch", key: "branch", width: 18 }]
          : []),
        { header: "Payment method", key: "method", width: 15 },
        { header: "Debit", key: "debit", format: "money", width: 14 },
        { header: "Credit", key: "credit", format: "money", width: 14 },
        { header: "Balance", key: "balance", format: "money", width: 15 },
        // Last two on every export, so they sit in the same place wherever
        // somebody looks. "Balance" above is the running ledger total;
        // "Still owing" is what remains on that one invoice.
        {
          header: "Payment status",
          key: "status",
          width: 15,
          tones: {
            [PAYMENT_STATE_LABELS.paid]: TONE.good,
            [PAYMENT_STATE_LABELS.partial]: TONE.warn,
            [PAYMENT_STATE_LABELS.unpaid]: TONE.bad,
          },
        },
        { header: "Still owing", key: "remaining", format: "money", width: 14 },
      ],
      rows,
      totals: {
        reference: "Closing balance",
        debit: statement.totalInvoiced,
        credit: statement.totalPaid,
        balance: statement.closingBalance,
      },
    },
  ]);

  return xlsxResponse(data, `statement-${statement.customer.name}-${from}-to-${to}`);
}
