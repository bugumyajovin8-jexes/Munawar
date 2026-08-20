import { getSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { buildWorkbook, xlsxResponse, type ExcelSheet } from "@/lib/excel";
import { formatDate, todayLocal } from "@/lib/format";
import { PAYMENT_METHOD_LABELS, type PaymentMethod } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_ROWS = 20000;

/**
 * Everything you have, in one workbook. Admin only.
 *
 * The point is that you are never locked in: if you stop using this, your
 * customers, prices, invoices and payment history leave with you in a format
 * anyone can open.
 */
export async function GET() {
  const session = await getSession();
  if (!session) return new Response("Unauthorised", { status: 401 });
  if (session.role !== "admin") {
    return new Response("Only an administrator can export a full backup", {
      status: 403,
    });
  }

  const supabase = await createClient();
  const today = todayLocal();

  const [customers, products, invoices, items, payments, recurring, reminders] =
    await Promise.all([
      supabase.from("customers").select("*").order("name").limit(MAX_ROWS),
      supabase.from("products_view").select("*").order("name").limit(MAX_ROWS),
      supabase
        .from("invoices")
        .select("*, customer:customers(name)")
        .order("created_at")
        .limit(MAX_ROWS),
      supabase
        .from("invoice_items_view")
        .select("*, invoice:invoices(number, draft_ref)")
        .limit(MAX_ROWS),
      supabase
        .from("payments")
        .select("*, invoice:invoices(number, customer:customers(name))")
        .order("paid_on")
        .limit(MAX_ROWS),
      supabase
        .from("recurring_invoices")
        .select("*, customer:customers(name)")
        .order("name")
        .limit(MAX_ROWS),
      supabase
        .from("reminders_log")
        .select("*, invoice:invoices(number, customer:customers(name))")
        .order("sent_at")
        .limit(MAX_ROWS),
    ]);

  const subtitle = [
    session.org.legal_name || session.org.name,
    `Full data export as at ${formatDate(today)}`,
    `All amounts in ${session.org.currency}`,
  ];

  const sheets: ExcelSheet[] = [
    {
      name: "Customers",
      title: "Customers",
      subtitle,
      columns: [
        { header: "Name", key: "name", width: 30 },
        { header: "Contact", key: "contact_person", width: 22 },
        { header: "Phone", key: "phone_e164", width: 18 },
        { header: "Email", key: "email", width: 26 },
        { header: "Address", key: "address", width: 32 },
        { header: "City", key: "city", width: 16 },
        { header: "TIN", key: "tin", width: 16 },
        { header: "VRN", key: "vrn", width: 16 },
        { header: "Terms (days)", key: "payment_terms_days", format: "number", width: 14 },
        { header: "Credit limit", key: "credit_limit", format: "money", width: 16 },
        { header: "Active", key: "is_active", width: 10 },
        { header: "Notes", key: "notes", width: 30 },
      ],
      rows: (customers.data ?? []) as Record<string, unknown>[],
    },
    {
      name: "Products",
      title: "Products",
      subtitle,
      columns: [
        { header: "Name", key: "name", width: 30 },
        { header: "SKU", key: "sku", width: 16 },
        { header: "Unit", key: "unit", width: 12 },
        { header: "Buying price", key: "buying_price", format: "money", width: 16 },
        { header: "Selling price", key: "selling_price", format: "money", width: 16 },
        { header: "Margin %", key: "margin_pct", format: "number", width: 12 },
        { header: "VAT applies", key: "vat_applicable", width: 12 },
        { header: "Active", key: "is_active", width: 10 },
        { header: "Description", key: "description", width: 34 },
      ],
      rows: (products.data ?? []) as Record<string, unknown>[],
    },
    {
      name: "Invoices",
      title: "Invoices and credit notes",
      subtitle,
      columns: [
        { header: "Number", key: "number", width: 16 },
        { header: "Draft ref", key: "draft_ref", width: 16 },
        { header: "Type", key: "doc_type", width: 14 },
        { header: "Status", key: "status", width: 12 },
        { header: "Customer", key: "customer_name", width: 30 },
        { header: "Order date", key: "order_date", format: "date", width: 14 },
        { header: "Invoice date", key: "invoice_date", format: "date", width: 14 },
        { header: "Ship date", key: "ship_date", format: "date", width: 14 },
        { header: "Due date", key: "due_date", format: "date", width: 14 },
        { header: "Terms", key: "terms_days", format: "number", width: 10 },
        { header: "VAT mode", key: "vat_mode", width: 14 },
        { header: "VAT rate", key: "vat_rate", format: "number", width: 10 },
        { header: "Subtotal", key: "subtotal", format: "money", width: 16 },
        { header: "VAT", key: "vat_amount", format: "money", width: 14 },
        { header: "Total", key: "total", format: "money", width: 16 },
        { header: "Notes", key: "customer_notes", width: 30 },
      ],
      rows: (invoices.data ?? []).map((row) => ({
        ...row,
        customer_name:
          (row.customer as { name?: string } | null)?.name ?? "",
      })) as Record<string, unknown>[],
    },
    {
      name: "Invoice lines",
      title: "Invoice line items",
      subtitle,
      columns: [
        { header: "Invoice", key: "invoice_number", width: 16 },
        { header: "Line", key: "line_no", format: "number", width: 8 },
        { header: "Description", key: "description", width: 36 },
        { header: "Unit", key: "unit", width: 10 },
        { header: "Qty", key: "qty", format: "number", width: 12 },
        { header: "Unit price", key: "unit_price", format: "money", width: 15 },
        { header: "Unit cost", key: "unit_cost", format: "money", width: 15 },
        { header: "Subtotal", key: "line_subtotal", format: "money", width: 15 },
        { header: "VAT", key: "line_vat", format: "money", width: 14 },
        { header: "Total", key: "line_total", format: "money", width: 15 },
        { header: "Profit", key: "line_profit", format: "money", width: 15 },
      ],
      rows: (items.data ?? []).map((row) => {
        const invoice = row.invoice as { number?: string; draft_ref?: string } | null;
        return { ...row, invoice_number: invoice?.number ?? invoice?.draft_ref ?? "" };
      }) as Record<string, unknown>[],
    },
    {
      name: "Payments",
      title: "Payments received",
      subtitle,
      columns: [
        { header: "Date", key: "paid_on", format: "date", width: 14 },
        { header: "Invoice", key: "invoice_number", width: 16 },
        { header: "Customer", key: "customer_name", width: 30 },
        { header: "Method", key: "method_label", width: 22 },
        { header: "Reference", key: "reference", width: 22 },
        { header: "Amount", key: "amount", format: "money", width: 16 },
        { header: "Note", key: "note", width: 30 },
      ],
      rows: (payments.data ?? []).map((row) => {
        const invoice = row.invoice as
          | { number?: string; customer?: { name?: string } }
          | null;
        return {
          ...row,
          invoice_number: invoice?.number ?? "",
          customer_name: invoice?.customer?.name ?? "",
          method_label:
            PAYMENT_METHOD_LABELS[row.method as PaymentMethod] ?? row.method,
        };
      }) as Record<string, unknown>[],
    },
    {
      name: "Recurring",
      title: "Recurring invoice schedules",
      subtitle,
      columns: [
        { header: "Name", key: "name", width: 32 },
        { header: "Customer", key: "customer_name", width: 28 },
        { header: "Frequency", key: "frequency", width: 14 },
        { header: "Every", key: "interval_count", format: "number", width: 10 },
        { header: "Next run", key: "next_run_on", format: "date", width: 14 },
        { header: "Ends", key: "end_on", format: "date", width: 14 },
        { header: "Auto issue", key: "auto_issue", width: 12 },
        { header: "Active", key: "is_active", width: 10 },
        { header: "Raised so far", key: "generated_count", format: "number", width: 14 },
      ],
      rows: (recurring.data ?? []).map((row) => ({
        ...row,
        customer_name: (row.customer as { name?: string } | null)?.name ?? "",
      })) as Record<string, unknown>[],
    },
    {
      name: "Reminders",
      title: "Reminder log",
      subtitle,
      columns: [
        { header: "Sent at", key: "sent_at", format: "date", width: 16 },
        { header: "Invoice", key: "invoice_number", width: 16 },
        { header: "Customer", key: "customer_name", width: 28 },
        { header: "Channel", key: "channel", width: 12 },
        { header: "Days overdue", key: "days_overdue", format: "number", width: 14 },
        { header: "Message", key: "message_snapshot", width: 60 },
      ],
      rows: (reminders.data ?? []).map((row) => {
        const invoice = row.invoice as
          | { number?: string; customer?: { name?: string } }
          | null;
        return {
          ...row,
          sent_at: String(row.sent_at).slice(0, 10),
          invoice_number: invoice?.number ?? "",
          customer_name: invoice?.customer?.name ?? "",
        };
      }) as Record<string, unknown>[],
    },
  ];

  const workbook = await buildWorkbook(sheets);
  return xlsxResponse(workbook, `munawar-backup-${today}`);
}
