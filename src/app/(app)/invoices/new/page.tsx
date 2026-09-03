import { Suspense } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { PageSkeleton } from "@/components/page-skeleton";
import { NewInvoice } from "./new-invoice";

export const metadata = { title: "New invoice" };

/**
 * Static, and deliberately so.
 *
 * It used to call requireSession(), read searchParams and run two unbounded
 * Supabase queries, any one of which is enough to make Next render on demand.
 * A dynamic route cannot be prefetched past its loading boundary, so every
 * click cost a full round trip before anything appeared — and with no signal
 * there was nothing to fall back on but whatever the service worker happened
 * to have cached.
 *
 * Nothing here touches the network now. See NewInvoice for where the data
 * comes from instead.
 */
export default function NewInvoicePage() {
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
        useSearchParams() suspends, and a statically rendered route needs a
        boundary for it — without this the whole page would be forced back to
        rendering on demand, which is the thing being fixed.
      */}
      <Suspense fallback={<PageSkeleton />}>
        <NewInvoice />
      </Suspense>
    </>
  );
}
