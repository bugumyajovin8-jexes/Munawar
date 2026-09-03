import { getSession } from "@/lib/auth";
import { selectIn } from "@/lib/supabase/chunked";
import { createClient } from "@/lib/supabase/server";
import { buildWorkbook, xlsxResponse, TONE, type ExcelColumn } from "@/lib/excel";
import { formatDate, todayLocal } from "@/lib/format";
import {
  PAYMENT_STATE_LABELS,
  type Invoice,
  type InvoiceBalance,
  type PaymentStateKey,
} from "@/lib/types";

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
    /*
     * Chunked, and a failure stops the export rather than quietly zeroing it.
     *
     * A year of invoices is several hundred uuids, which used to go into the
     * URL in one filter and could be refused for length alone. The error was
     * never read, so the spreadsheet was written anyway — with a margin column
     * of zeros, filed or forwarded by somebody with no reason to doubt it.
     */
    const { rows: items, error } = await selectIn(
      invoices.map((i) => i.id),
      (ids) =>
        supabase
          .from("invoice_items_view")
          .select("invoice_id, line_profit")
          .in("invoice_id", ids),
    );

    if (error) {
      return new Response(`Could not read the cost figures: ${error}`, { status: 500 });
    }

    for (const item of items) {
      const key = item.invoice_id as string;
      profitByInvoice.set(key, (profitByInvoice.get(key) ?? 0) + Number(item.line_profit ?? 0));
    }

    /*
     * Then the whole-invoice discounts, which sit on no line and would
     * otherwise leave every discounted sale overstating its margin in a
     * spreadsheet somebody files and forwards.
     */
    for (const invoice of invoices) {
      const given = Number(invoice.discount_amount ?? 0);
      if (given <= 0) continue;
      const id = invoice.id as string;
      const margin = profitByInvoice.get(id);
      if (margin != null) profitByInvoice.set(id, margin - given);
    }
  }

  const rows = invoices.map((inv) => {
    const b = balances.get(inv.id);
    return {
      number: inv.number,
      branch: inv.branch_name ?? "",
      invoice_date: inv.invoice_date,
      ship_date: inv.ship_date,
      due_date: inv.due_date,
      customer: inv.customer?.name ?? "",
      subtotal: Number(inv.subtotal),
      vat: Number(inv.vat_amount),
      total: Number(inv.total),
      paid: Number(b?.amount_paid ?? 0),
      balance: Number(b?.balance ?? inv.total),
      /*
       * Payment state and lateness are two different questions, and this
       * column used to answer both badly: an overdue invoice printed
       * "Overdue", hiding whether any of it had been paid. An invoice can be
       * half paid and three weeks late, and both facts matter when you are
       * deciding who to chase. Lateness has its own column already.
       */
      state: PAYMENT_STATE_LABELS[
        (b?.payment_state ?? "unpaid") as PaymentStateKey
      ],
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
    // Blank on a head-office invoice rather than filled in, so the column can
    // be filtered to "which of these went through a branch".
    { header: "Branch", key: "branch", width: 18 },
    { header: "Subtotal", key: "subtotal", format: "money", width: 15 },
    { header: "VAT", key: "vat", format: "money", width: 14 },
    { header: "Total", key: "total", format: "money", width: 16 },
    { header: "Paid", key: "paid", format: "money", width: 15 },
    { header: "Days overdue", key: "days_overdue", format: "number", width: 14 },
  ];

  if (isAdmin) {
    columns.push({ header: "Gross profit", key: "profit", format: "money", width: 16 });
  }

  /*
   * Last two, always — and in this order on every export.
   *
   * These are the two columns somebody actually goes to the sheet to read, and
   * putting them at the end means they stay together however many columns are
   * added in front of them. Gross profit is appended above rather than below
   * so the admin and sales versions still end the same way.
   */
  columns.push(
    {
      header: "Payment status",
      key: "state",
      width: 16,
      // The same three colours the app uses on screen, so somebody moving
      // between the two is not relearning what green means.
      tones: {
        [PAYMENT_STATE_LABELS.paid]: TONE.good,
        [PAYMENT_STATE_LABELS.partial]: TONE.warn,
        [PAYMENT_STATE_LABELS.unpaid]: TONE.bad,
      },
    },
    // Named to match the statement export, where the same figure appears.
    { header: "Still owing", key: "balance", format: "money", width: 15 },
  );

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
      // Overdue rows tint red, so the problems in a 400-row sheet surface
      // without anybody having to sort or filter to find them.
      rowTone: (row) => (Number(row.days_overdue ?? 0) > 0 ? "danger" : null),
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
