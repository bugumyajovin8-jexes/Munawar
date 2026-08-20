import Link from "next/link";
import { Plus } from "lucide-react";
import { requireSession } from "@/lib/auth";
import { todayLocal } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import { SearchInput } from "@/components/search-input";
import { InvoicesList } from "./invoices-list";
import type { InvoiceFilter } from "./filter-tabs";

export const metadata = { title: "Invoices" };

/**
 * Auth and layout only.
 *
 * The list, its balances and its filter counts are all worked out on the
 * device from the mirror, so this screen no longer waits on Supabase — which
 * is what makes moving to it instant, and what makes it work with no signal.
 */
export default async function InvoicesPage(props: PageProps<"/invoices">) {
  await requireSession();
  const params = await props.searchParams;

  const filter = (
    typeof params.status === "string" ? params.status : "all"
  ) as InvoiceFilter;
  const q = typeof params.q === "string" ? params.q : "";

  return (
    <>
      <PageHeader
        title="Invoices"
        description="Search by invoice number to answer a customer on the spot."
        actions={
          <Button asChild>
            <Link href="/invoices/new">
              <Plus className="size-4" />
              New invoice
            </Link>
          </Button>
        }
      />

      <div className="mb-4 sm:ml-auto sm:w-72">
        <SearchInput placeholder="Invoice number or customer…" />
      </div>

      <InvoicesList filter={filter} query={q} today={todayLocal()} />
    </>
  );
}
