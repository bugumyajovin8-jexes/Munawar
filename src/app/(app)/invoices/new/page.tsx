import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth";
import { PageHeader } from "@/components/page-header";
import { InvoiceBuilder } from "../invoice-builder";
import type { Customer, Product } from "@/lib/types";

export const metadata = { title: "New invoice" };

export default async function NewInvoicePage(props: PageProps<"/invoices/new">) {
  const session = await requireSession();
  const supabase = await createClient();
  const params = await props.searchParams;
  const preselect = typeof params.customer === "string" ? params.customer : undefined;

  const [{ data: customers }, { data: products }] = await Promise.all([
    supabase.from("customers").select("*").eq("is_active", true).order("name"),
    supabase.from("products_view").select("*").eq("is_active", true).order("name"),
  ]);

  const customerList = (customers ?? []) as Customer[];

  return (
    <>
      <Link
        href="/invoices"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        Invoices
      </Link>

      <PageHeader
        title="New invoice"
        description="Nothing is numbered until you issue it."
      />

      {/*
        No "add a customer first" gate here any more.

        It was a server-side check against a server-side list, which meant that
        offline — where the page comes off the service worker cache — it could
        insist there were no customers while the device's own mirror held one
        added ten minutes earlier. The builder reads the mirror and shows its
        own empty text when there genuinely is nobody.
      */}
      <InvoiceBuilder
        customers={customerList}
        products={(products ?? []) as Product[]}
        defaultTermsDays={session.org.default_terms_days}
        vatRate={Number(session.org.default_vat_rate)}
        initialCustomerId={preselect}
      />
    </>
  );
}
