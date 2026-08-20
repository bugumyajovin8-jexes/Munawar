import { getSession } from "@/lib/auth";
import { buildStatement, defaultRange } from "@/lib/statement";
import { buildWorkbook, xlsxResponse } from "@/lib/excel";
import { formatDate, todayLocal } from "@/lib/format";

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

  const statement = await buildStatement(customerId, from, to);
  if (!statement) return new Response("Customer not found", { status: 404 });

  const rows = [
    {
      date: from,
      reference: "",
      description: "Balance brought forward",
      debit: null,
      credit: null,
      balance: statement.openingBalance,
    },
    ...statement.lines.map((line) => ({
      date: line.date,
      reference: line.reference,
      description: line.description,
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
      columns: [
        { header: "Date", key: "date", format: "date", width: 14 },
        { header: "Reference", key: "reference", width: 18 },
        { header: "Description", key: "description", width: 44 },
        { header: "Debit", key: "debit", format: "money", width: 16 },
        { header: "Credit", key: "credit", format: "money", width: 16 },
        { header: "Balance", key: "balance", format: "money", width: 18 },
      ],
      rows,
      totals: {
        description: `Closing balance ${formatDate(to)}`,
        debit: statement.totalInvoiced,
        credit: statement.totalPaid,
        balance: statement.closingBalance,
      },
    },
  ]);

  return xlsxResponse(data, `statement-${statement.customer.name}-${from}-to-${to}`);
}
