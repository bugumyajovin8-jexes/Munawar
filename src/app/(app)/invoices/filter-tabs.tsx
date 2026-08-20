"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";

export const INVOICE_FILTERS = [
  { value: "all", label: "All" },
  { value: "draft", label: "Drafts" },
  { value: "unpaid", label: "Unpaid" },
  { value: "overdue", label: "Overdue" },
  { value: "paid", label: "Paid" },
] as const;

export type InvoiceFilter = (typeof INVOICE_FILTERS)[number]["value"];

export function FilterTabs({
  active,
  counts,
}: {
  active: InvoiceFilter;
  counts?: Partial<Record<InvoiceFilter, number>>;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  return (
    <div className="flex gap-1 overflow-x-auto rounded-lg bg-muted p-1 no-scrollbar">
      {INVOICE_FILTERS.map((f) => {
        const params = new URLSearchParams(searchParams.toString());
        if (f.value === "all") params.delete("status");
        else params.set("status", f.value);
        const query = params.toString();
        const count = counts?.[f.value];

        return (
          <Link
            key={f.value}
            href={`${pathname}${query ? `?${query}` : ""}` as never}
            scroll={false}
            className={cn(
              "flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
              active === f.value
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {f.label}
            {count !== undefined && count > 0 && (
              <span
                className={cn(
                  "rounded-full px-1.5 text-xs tabular",
                  f.value === "overdue"
                    ? "bg-destructive/15 text-destructive"
                    : "bg-muted-foreground/15",
                )}
              >
                {count}
              </span>
            )}
          </Link>
        );
      })}
    </div>
  );
}
