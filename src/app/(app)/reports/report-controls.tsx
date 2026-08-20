"use client";

import { useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Download, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

const PRESETS = [
  { label: "This month", from: (t: string) => `${t.slice(0, 7)}-01` },
  {
    label: "Last 3 months",
    from: (t: string) => {
      const d = new Date(`${t}T00:00:00`);
      d.setMonth(d.getMonth() - 3);
      return d.toISOString().slice(0, 10);
    },
  },
  { label: "This year", from: (t: string) => `${t.slice(0, 4)}-01-01` },
  { label: "Last year", from: (t: string) => `${Number(t.slice(0, 4)) - 1}-01-01` },
];

export function ReportControls({
  from,
  to,
  today,
}: {
  from: string;
  to: string;
  today: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
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
      router.replace(`${pathname}?${params.toString()}` as never, { scroll: false });
    });
  }

  return (
    <div className="mb-5 flex flex-col gap-3 rounded-xl border border-border bg-card p-4 print:hidden">
      <div className="flex flex-wrap gap-1.5">
        {PRESETS.map((preset) => {
          const presetFrom = preset.from(today);
          const active = localFrom === presetFrom;
          return (
            <button
              key={preset.label}
              type="button"
              onClick={() => apply(presetFrom, today)}
              className={cn(
                "rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors",
                active
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-card hover:bg-accent",
              )}
            >
              {preset.label}
            </button>
          );
        })}
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex flex-1 gap-3">
          <div className="flex flex-1 flex-col gap-1.5">
            <Label htmlFor="report_from">From</Label>
            <Input
              id="report_from"
              type="date"
              value={localFrom}
              max={localTo}
              onChange={(e) => apply(e.target.value, localTo)}
            />
          </div>
          <div className="flex flex-1 flex-col gap-1.5">
            <Label htmlFor="report_to">To</Label>
            <Input
              id="report_to"
              type="date"
              value={localTo}
              min={localFrom}
              onChange={(e) => apply(localFrom, e.target.value)}
            />
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button variant="outline" asChild>
            <a href={`/api/export/invoices?from=${from}&to=${to}`}>
              <Download className="size-4" />
              Sales
            </a>
          </Button>
          <Button variant="outline" asChild>
            <a href={`/api/export/payments?from=${from}&to=${to}`}>
              <Download className="size-4" />
              Payments
            </a>
          </Button>
          <Button variant="outline" asChild>
            <a href="/api/export/ageing">
              <Download className="size-4" />
              Ageing
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
