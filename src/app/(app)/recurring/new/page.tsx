import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth";
import { PageHeader } from "@/components/page-header";
import { RecurringBuilder } from "../recurring-builder";
import type { Customer, Product } from "@/lib/types";

export const metadata = { title: "New schedule" };

export default async function NewRecurringPage() {
  const session = await requireSession();
  const supabase = await createClient();

  const [{ data: customers }, { data: products }] = await Promise.all([
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
        title="New recurring invoice"
        description="Set it once and the invoices raise themselves."
      />

      <RecurringBuilder
        customers={(customers ?? []) as Customer[]}
        products={(products ?? []) as Product[]}
        defaultTermsDays={session.org.default_terms_days}
        vatRate={Number(session.org.default_vat_rate)}
      />
    </>
  );
}
