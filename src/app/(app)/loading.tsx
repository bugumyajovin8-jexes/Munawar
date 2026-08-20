import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Shown the instant you click a link or a row, while the server fetches.
 *
 * Without this, Next has nothing to render during navigation and the browser
 * sits on the previous page — the click appears to do nothing, which reads as
 * "the app is broken" rather than "the app is loading".
 *
 * Deliberately shown immediately with no fade-in. An earlier version delayed
 * it to avoid flashing on fast navigations, but a placeholder you can barely
 * see is worse than none: the whole job here is to prove the click landed.
 */
export default function Loading() {
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

      <Skeleton className="mb-4 h-9.5 w-full max-w-md" />

      <Card className="overflow-hidden p-0">
        <div className="flex items-center gap-6 border-b border-border bg-muted/40 px-4 py-3">
          <Skeleton className="h-3.5 w-24" />
          <Skeleton className="h-3.5 w-32" />
          <Skeleton className="hidden h-3.5 w-24 sm:block" />
          <Skeleton className="ml-auto h-3.5 w-20" />
        </div>

        {Array.from({ length: 8 }).map((_, i) => (
          <div
            key={i}
            className="flex items-center gap-6 border-b border-border px-4 py-4 last:border-0"
          >
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-4 w-44" />
            <Skeleton className="hidden h-4 w-24 sm:block" />
            <Skeleton className="ml-auto h-4 w-20" />
          </div>
        ))}
      </Card>
    </div>
  );
}
