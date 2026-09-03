import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth";
import { formatDate } from "@/lib/format";
import { PageHeader } from "@/components/page-header";
import { RecurringBuilder } from "../recurring-builder";
import type {
  Customer,
  Product,
  RecurringInvoice,
  RecurringItem,
} from "@/lib/types";

export const metadata = { title: "Edit schedule" };

export default async function EditRecurringPage(props: PageProps<"/recurring/[id]">) {
  const { id } = await props.params;
  const session = await requireSession();
  const supabase = await createClient();

  const { data: scheduleRow } = await supabase
    .from("recurring_invoices")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (!scheduleRow) notFound();
  const schedule = scheduleRow as RecurringInvoice;

  const [{ data: items }, { data: customers }, { data: products }] = await Promise.all([
    supabase
      .from("recurring_invoice_items")
      .select("*")
      .eq("recurring_id", id)
      .order("line_no"),
    supabase.from("customers").select("*").eq("is_active", true).order("name"),
    supabase.from("products_view").select("*").eq("is_active", true).order("name"),
  ]);

  return (
    <>
      <Link
        href="/recurring"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        Recurring invoices
      </Link>

      <PageHeader
        title={schedule.name}
        description={
          schedule.generated_count > 0
            ? `${schedule.generated_count} invoices raised so far · last on ${formatDate(schedule.last_generated_on)}`
            : "Not yet run"
        }
      />

      <RecurringBuilder
        customers={(customers ?? []) as Customer[]}
        products={(products ?? []) as Product[]}
        defaultTermsDays={session.org.default_terms_days}
        vatRate={Number(session.org.default_vat_rate)}
        schedule={schedule}
        items={(items ?? []) as RecurringItem[]}
      />
    </>
  );
}
