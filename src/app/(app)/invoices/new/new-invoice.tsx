"use client";

import { useSearchParams } from "next/navigation";
import { useAppSession } from "@/lib/offline/local";
import { PageSkeleton } from "@/components/page-skeleton";
import { InvoiceBuilder } from "../invoice-builder";

/**
 * Everything /invoices/new used to ask the server for.
 *
 * The page fetched every active customer and every active product on each
 * visit, and read the org's VAT rate and payment terms out of the session.
 * All four are already on the device — the builder has read customers and
 * products from the mirror for a while now and only used the server's copies
 * as a first-paint fallback, and /api/session carries the org defaults.
 *
 * Reading them here instead is what makes the route static. That matters more
 * than the queries it saves: a static route is prefetched whole, so the screen
 * paints on click instead of after a round trip to Vercel and two to Supabase
 * — and it opens with no signal at all, which is when somebody standing in a
 * shop most needs to write an invoice.
 *
 * The builder is mounted rather than rendered-and-guarded. Its state
 * initialisers read the VAT rate and the terms once, at mount, so starting it
 * before those are known would leave the first invoice computing VAT at
 * whatever a missing value coerces to.
 */
export function NewInvoice() {
  const session = useAppSession();
  const params = useSearchParams();

  // Null only until /api/session answers — from the device on every visit
  // after the first, so this is a flash rather than a wait.
  if (!session) return <PageSkeleton />;

  return (
    <InvoiceBuilder
      defaultTermsDays={session.defaultTermsDays}
      vatRate={session.defaultVatRate}
      initialCustomerId={params.get("customer") ?? undefined}
    />
  );
}
