"use client";

import { useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Download, Loader2, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DateInput } from "@/components/ui/date-input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { HEAD_OFFICE } from "@/lib/statement-scope";

type Preset = { label: string; from: (today: string) => string };

const PRESETS: Preset[] = [
  { label: "This month", from: (t) => `${t.slice(0, 7)}-01` },
  {
    label: "Last 3 months",
    from: (t) => {
      const d = new Date(`${t}T00:00:00`);
      d.setMonth(d.getMonth() - 3);
      return d.toISOString().slice(0, 10);
    },
  },
  { label: "This year", from: (t) => `${t.slice(0, 4)}-01-01` },
  { label: "All time", from: () => "2000-01-01" },
];

export function StatementControls({
  customerId,
  from,
  to,
  today,
  branches,
  branchFilter,
}: {
  customerId: string;
  from: string;
  to: string;
  today: string;
  branches: { id: string; name: string }[];
  /** A branch id, HEAD_OFFICE, or null for the whole account. */
  branchFilter: string | null;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [localFrom, setLocalFrom] = useState(from);
  const [localTo, setLocalTo] = useState(to);

  function apply(nextFrom: string, nextTo: string) {
    setLocalFrom(nextFrom);
    setLocalTo(nextTo);
    const params = new URLSearchParams(searchParams.toString());
    params.set("from", nextFrom);
    params.set("to", nextTo);
    startTransition(() => {
      router.replace(
        `/customers/${customerId}/statement?${params.toString()}` as never,
        { scroll: false },
      );
    });
  }

  function applyBranch(next: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (next) params.set("branch", next);
    else params.delete("branch");
    startTransition(() => {
      router.replace(
        `/customers/${customerId}/statement?${params.toString()}` as never,
        { scroll: false },
      );
    });
  }

  const exportHref =
    `/api/export/statement/${customerId}?from=${from}&to=${to}` +
    (branchFilter ? `&branch=${encodeURIComponent(branchFilter)}` : "");

  return (
    <div className="mb-5 flex flex-col gap-3 rounded-xl border border-border bg-card p-4 print:hidden">
      <div className="flex flex-wrap gap-1.5">
        {PRESETS.map((p) => {
          const presetFrom = p.from(today);
          const active = localFrom === presetFrom && localTo === today;
          return (
            <button
              key={p.label}
              type="button"
              onClick={() => apply(presetFrom, today)}
              className={cn(
                "rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors",
                active
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-card hover:bg-accent",
              )}
            >
              {p.label}
            </button>
          );
        })}
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex flex-1 gap-3">
          <div className="flex flex-1 flex-col gap-1.5">
            <Label htmlFor="from">From</Label>
            <DateInput
              id="from"
              value={localFrom}
              max={localTo}
              onChange={(e) => apply(e.target.value, localTo)}
            />
          </div>
          <div className="flex flex-1 flex-col gap-1.5">
            <Label htmlFor="to">To</Label>
            <DateInput
              id="to"
              value={localTo}
              min={localFrom}
              onChange={(e) => apply(localFrom, e.target.value)}
            />
          </div>
        </div>

        {/*
          Only for a customer who has branches. Everyone else gets the controls
          exactly as they were — the same rule the branch picker on the invoice
          follows.
        */}
        {branches.length > 0 && (
          <div className="flex flex-col gap-1.5 sm:w-56">
            <Label htmlFor="branch-filter">Branch</Label>
            <select
              id="branch-filter"
              value={branchFilter ?? ""}
              onChange={(e) => applyBranch(e.target.value)}
              className="h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              <option value="">All branches</option>
              <option value={HEAD_OFFICE}>Head office only</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="flex gap-2">
          <Button variant="outline" onClick={() => window.print()}>
            <Printer className="size-4" />
            Print
          </Button>
          <Button variant="outline" asChild>
            <a href={exportHref}>
              <Download className="size-4" />
              Excel
            </a>
          </Button>
          {pending && (
            <span className="flex items-center px-1 text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
