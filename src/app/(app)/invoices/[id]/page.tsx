import { Suspense } from "react";
import { PageSkeleton } from "@/components/page-skeleton";
import { InvoiceDetail } from "./invoice-detail";

/**
 * A static shell for any invoice.
 *
 * The id is read from the URL on the client rather than from `params` here,
 * exactly as the customer screen already does — touching `params` renders on
 * demand, and this was the last screen in daily use still doing so. It was
 * also the costly one: five Supabase queries and an auth check every time it
 * opened, and roughly thirty of them fetched again by the offline warm run
 * after every fresh sign-in.
 *
 * One shell serves every invoice. Which one it shows is decided on the device,
 * from data the device already has — so it opens instantly, and it opens with
 * no signal at all.
 */
export default function InvoiceDetailPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <InvoiceDetail />
    </Suspense>
  );
}
