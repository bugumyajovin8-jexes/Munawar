import { getSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { buildWorkbook, xlsxResponse } from "@/lib/excel";
import { formatDate, todayLocal } from "@/lib/format";
import { PAYMENT_METHOD_LABELS, type PaymentMethod } from "@/lib/types";

export const runtime = "nodejs";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

type PaymentRow = {
  paid_on: string;
  amount: number;
  method: PaymentMethod;
  reference: string | null;
  note: string | null;
  invoice: {
    number: string | null;
    customer: { name: string } | null;
  } | null;
};

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return new Response("Unauthorised", { status: 401 });

  const url = new URL(request.url);
  const today = todayLocal();
  const fromParam = url.searchParams.get("from");
  const toParam = url.searchParams.get("to");
  const from = fromParam && DATE_RE.test(fromParam) ? fromParam : `${today.slice(0, 4)}-01-01`;
  const to = toParam && DATE_RE.test(toParam) ? toParam : today;

  const supabase = await createClient();
  const { data } = await supabase
    .from("payments")
    .select("paid_on, amount, method, reference, note, invoice:invoices(number, customer:customers(name))")
    .gte("paid_on", from)
    .lte("paid_on", to)
    .order("paid_on");

  const payments = (data ?? []) as unknown as PaymentRow[];

  const rows = payments.map((p) => ({
    paid_on: p.paid_on,
    invoice: p.invoice?.number ?? "",
    customer: p.invoice?.customer?.name ?? "",
    method: PAYMENT_METHOD_LABELS[p.method] ?? p.method,
    reference: p.reference ?? "",
    note: p.note ?? "",
    amount: Number(p.amount),
  }));

  const workbook = await buildWorkbook([
    {
      name: "Payments",
      title: "Payments Received",
      subtitle: [
        session.org.legal_name || session.org.name,
        `From ${formatDate(from)} to ${formatDate(to)}`,
        `All amounts in ${session.org.currency}`,
      ],
      columns: [
        { header: "Date", key: "paid_on", format: "date", width: 14 },
        { header: "Invoice", key: "invoice", width: 16 },
        { header: "Customer", key: "customer", width: 30 },
        { header: "Method", key: "method", width: 22 },
        { header: "Reference", key: "reference", width: 22 },
        { header: "Note", key: "note", width: 30 },
        { header: "Amount", key: "amount", format: "money", width: 16 },
      ],
      rows,
      totals: {
        customer: `${rows.length} payments`,
        amount: rows.reduce((sum, r) => sum + r.amount, 0),
      },
    },
  ]);

  return xlsxResponse(workbook, `payments-${from}-to-${to}`);
}
