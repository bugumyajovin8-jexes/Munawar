import { getSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { buildWorkbook, xlsxResponse } from "@/lib/excel";
import { formatDate, todayLocal } from "@/lib/format";
import type { CustomerBalance } from "@/lib/types";

export const runtime = "nodejs";

export async function GET() {
  const session = await getSession();
  if (!session) return new Response("Unauthorised", { status: 401 });

  const supabase = await createClient();
  const { data } = await supabase
    .from("customer_balances")
    .select("*")
    .order("name");

  const rows = ((data ?? []) as CustomerBalance[]).filter((c) => c.balance !== 0);
  const today = todayLocal();

  const sum = (key: keyof CustomerBalance) =>
    rows.reduce((total, row) => total + Number(row[key] ?? 0), 0);

  const workbook = await buildWorkbook([
    {
      name: "Ageing",
      title: "Aged Receivables",
      subtitle: [
        session.org.legal_name || session.org.name,
        `As at ${formatDate(today)}`,
        `All amounts in ${session.org.currency}`,
      ],
      columns: [
        { header: "Customer", key: "name", width: 34 },
        { header: "Total owing", key: "balance", format: "money", width: 16 },
        { header: "Current", key: "bucket_current", format: "money", width: 14 },
        { header: "1-30 days", key: "bucket_1_30", format: "money", width: 14 },
        { header: "31-60 days", key: "bucket_31_60", format: "money", width: 14 },
        { header: "61-90 days", key: "bucket_61_90", format: "money", width: 14 },
        { header: "90+ days", key: "bucket_90_plus", format: "money", width: 14 },
        { header: "Overdue invoices", key: "overdue_count", format: "number", width: 16 },
      ],
      rows: rows as unknown as Record<string, unknown>[],
      totals: {
        name: `${rows.length} customers`,
        balance: sum("balance"),
        bucket_current: sum("bucket_current"),
        bucket_1_30: sum("bucket_1_30"),
        bucket_31_60: sum("bucket_31_60"),
        bucket_61_90: sum("bucket_61_90"),
        bucket_90_plus: sum("bucket_90_plus"),
        overdue_count: sum("overdue_count"),
      },
    },
  ]);

  return xlsxResponse(workbook, `aged-receivables-${today}`);
}
