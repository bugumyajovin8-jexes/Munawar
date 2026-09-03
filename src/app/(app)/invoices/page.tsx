import { Suspense } from "react";
import Link from "next/link";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import { SearchInput } from "@/components/search-input";
import { InvoicesList } from "./invoices-list";

export const metadata = { title: "Invoices" };

/**
 * A static shell. It reads nothing — no cookies, no search params — because
 * anything read here would make the route dynamic, and a dynamic route cannot
 * be prefetched past its loading boundary. Static, it is fetched ahead of the
 * click and navigating to it touches the network not at all.
 */
export default function InvoicesPage() {
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
        <Suspense>
          <SearchInput placeholder="Invoice number or customer…" />
        </Suspense>
      </div>

      {/* useSearchParams needs a boundary in a static route. On a client
          navigation the router already has the params, so it resolves at once
          and this fallback is never seen. */}
      <Suspense>
        <InvoicesList />
      </Suspense>
    </>
  );
}
