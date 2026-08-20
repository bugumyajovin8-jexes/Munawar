import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth";
import { PageHeader } from "@/components/page-header";
import { InvoiceBuilder } from "../../invoice-builder";
import type { Customer, Invoice, InvoiceItem, Product } from "@/lib/types";

export const metadata = { title: "Edit draft" };

export default async function EditInvoicePage(
  props: PageProps<"/invoices/[id]/edit">,
) {
  const { id } = await props.params;
  const session = await requireSession();
  const supabase = await createClient();

  const { data: invoiceRow } = await supabase
    .from("invoices")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (!invoiceRow) notFound();

  const invoice = invoiceRow as Invoice;
  // Issued documents are immutable — the DB would reject the write anyway,
  // so don't even show the form.
  if (invoice.status !== "draft") redirect(`/invoices/${id}`);

  const [{ data: items }, { data: customers }, { data: products }] = await Promise.all([
    supabase.from("invoice_items_view").select("*").eq("invoice_id", id).order("line_no"),
    supabase.from("customers").select("*").eq("is_active", true).order("name"),
    supabase.from("products_view").select("*").eq("is_active", true).order("name"),
  ]);

  return (
    <>
      <Link
        href={`/invoices/${id}`}
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        Back to {invoice.draft_ref}
      </Link>

      <PageHeader
        title="Edit draft"
        description="Still unnumbered — change anything you like before issuing."
      />

      <InvoiceBuilder
        customers={(customers ?? []) as Customer[]}
        products={(products ?? []) as Product[]}
        defaultTermsDays={session.org.default_terms_days}
        vatRate={Number(session.org.default_vat_rate)}
        invoice={invoice}
        items={(items ?? []) as InvoiceItem[]}
      />
    </>
  );
}
