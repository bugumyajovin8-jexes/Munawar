import { getSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { buildWorkbook, xlsxResponse, type ExcelColumn } from "@/lib/excel";
import { formatDate, todayLocal } from "@/lib/format";
import type { Invoice, InvoiceBalance } from "@/lib/types";

export const runtime = "nodejs";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

type Row = Invoice & { customer: { name: string } | null };

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return new Response("Unauthorised", { status: 401 });

  const isAdmin = session.role === "admin";
  const url = new URL(request.url);
  const today = todayLocal();

  const fromParam = url.searchParams.get("from");
  const toParam = url.searchParams.get("to");
  const from = fromParam && DATE_RE.test(fromParam) ? fromParam : `${today.slice(0, 4)}-01-01`;
  const to = toParam && DATE_RE.test(toParam) ? toParam : today;

  const supabase = await createClient();

  const [{ data: invoiceRows }, { data: balanceRows }] = await Promise.all([
    supabase
      .from("invoices")
      .select("*, customer:customers(name)")
      .eq("status", "issued")
      .gte("invoice_date", from)
      .lte("invoice_date", to)
      .order("invoice_date"),
    supabase.from("invoice_balances").select("*"),
  ]);

  const invoices = (invoiceRows ?? []) as unknown as Row[];
  const balances = new Map(
    ((balanceRows ?? []) as InvoiceBalance[]).map((b) => [b.invoice_id, b]),
  );

  // Margin is admin-only. invoice_items_view returns null cost to sales, so
  // for them the columns are simply absent rather than filled with zeroes.
  const profitByInvoice = new Map<string, number>();
  if (isAdmin && invoices.length > 0) {
    const { data: items } = await supabase
      .from("invoice_items_view")
      .select("invoice_id, line_profit")
      .in(
        "invoice_id",
        invoices.map((i) => i.id),
      );
    for (const item of items ?? []) {
      const key = item.invoice_id as string;
      profitByInvoice.set(key, (profitByInvoice.get(key) ?? 0) + Number(item.line_profit ?? 0));
    }
  }

  const rows = invoices.map((inv) => {
    const b = balances.get(inv.id);
    return {
      number: inv.number,
      invoice_date: inv.invoice_date,
      ship_date: inv.ship_date,
      due_date: inv.due_date,
      customer: inv.customer?.name ?? "",
      subtotal: Number(inv.subtotal),
      vat: Number(inv.vat_amount),
      total: Number(inv.total),
      paid: Number(b?.amount_paid ?? 0),
      balance: Number(b?.balance ?? inv.total),
      state: b?.is_overdue ? "Overdue" : (b?.payment_state ?? "unpaid"),
      days_overdue: b?.days_overdue ?? 0,
      profit: profitByInvoice.get(inv.id) ?? 0,
    };
  });

  const columns: ExcelColumn[] = [
    { header: "Invoice", key: "number", width: 16 },
    { header: "Invoice date", key: "invoice_date", format: "date", width: 14 },
    { header: "Shipped", key: "ship_date", format: "date", width: 14 },
    { header: "Due date", key: "due_date", format: "date", width: 14 },
    { header: "Customer", key: "customer", width: 30 },
    { header: "Subtotal", key: "subtotal", format: "money", width: 15 },
    { header: "VAT", key: "vat", format: "money", width: 14 },
    { header: "Total", key: "total", format: "money", width: 16 },
    { header: "Paid", key: "paid", format: "money", width: 15 },
    { header: "Balance", key: "balance", format: "money", width: 15 },
    { header: "Status", key: "state", width: 13 },
    { header: "Days overdue", key: "days_overdue", format: "number", width: 14 },
  ];

  if (isAdmin) {
    columns.push({ header: "Gross profit", key: "profit", format: "money", width: 16 });
  }

  const total = (key: keyof (typeof rows)[number]) =>
    rows.reduce((sum, row) => sum + Number(row[key] ?? 0), 0);

  const workbook = await buildWorkbook([
    {
      name: "Invoices",
      title: "Sales Report",
      subtitle: [
        session.org.legal_name || session.org.name,
        `Issued invoices from ${formatDate(from)} to ${formatDate(to)}`,
        `All amounts in ${session.org.currency}`,
        isAdmin ? "" : "Cost and margin columns are not available to the sales role.",
      ].filter(Boolean),
      columns,
      rows: rows as unknown as Record<string, unknown>[],
      totals: {
        customer: `${rows.length} invoices`,
        subtotal: total("subtotal"),
        vat: total("vat"),
        total: total("total"),
        paid: total("paid"),
        balance: total("balance"),
        ...(isAdmin ? { profit: total("profit") } : {}),
      },
    },
  ]);

  return xlsxResponse(workbook, `sales-${from}-to-${to}`);
}
