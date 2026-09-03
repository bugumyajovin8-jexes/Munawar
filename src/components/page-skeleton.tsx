import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * The loading state for routes that still render on the server.
 *
 * Its presence is not only cosmetic. Next will not prefetch a dynamic route at
 * all unless it has a loading boundary, so a route without one is fetched
 * entirely after the click. The group-level version of this was deleted on
 * purpose — a boundary above the static screens would have capped what could
 * be prefetched for them — so it lives in each dynamic segment instead.
 */
export function PageSkeleton() {
  return (
    <div aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading…</span>

      <div className="mb-6 flex items-start justify-between gap-3">
        <div className="flex flex-col gap-2.5">
          <Skeleton className="h-7 w-56" />
          <Skeleton className="h-4 w-72" />
        </div>
        <Skeleton className="h-9.5 w-32 shrink-0" />
      </div>

      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <Skeleton className="h-[92px] rounded-xl" />
        <Skeleton className="h-[92px] rounded-xl" />
        <Skeleton className="h-[92px] rounded-xl" />
      </div>

      <Card className="p-4">
        <div className="flex flex-col gap-3">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-2/3" />
        </div>
      </Card>
    </div>
  );
}
