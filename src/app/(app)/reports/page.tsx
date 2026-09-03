import { Suspense } from "react";
import { PageSkeleton } from "@/components/page-skeleton";
import { ReportsBody } from "./reports-body";

export const metadata = { title: "Reports" };

/**
 * A static shell.
 *
 * The header lives inside ReportsBody rather than here, because its
 * description names the date range and the range comes from the query string
 * — reading that on the server is one of the things that kept this route
 * rendering on demand.
 */
export default function ReportsPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <ReportsBody />
    </Suspense>
  );
}
