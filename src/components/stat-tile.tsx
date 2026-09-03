import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export function StatTile({
  label,
  value,
  hint,
  icon,
  tone = "default",
  className,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon?: ReactNode;
  tone?: "default" | "success" | "warning" | "destructive";
  className?: string;
}) {
  const toneText = {
    default: "text-foreground",
    success: "text-success",
    warning: "text-warning-foreground dark:text-warning",
    destructive: "text-destructive",
  }[tone];

  return (
    <Card className={cn("p-4", className)}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </p>
        {icon && <span className="shrink-0 text-muted-foreground">{icon}</span>}
      </div>
      <p className={cn("mt-2 text-2xl font-semibold tabular tracking-tight", toneText)}>
        {value}
      </p>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </Card>
  );
}

/** The ageing strip: Current / 1–30 / 31–60 / 61–90 / 90+. */
export function AgeingBar({
  buckets,
  format,
}: {
  buckets: { label: string; amount: number }[];
  format: (n: number) => string;
}) {
  const total = buckets.reduce((sum, b) => sum + Math.max(0, b.amount), 0);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex h-2 overflow-hidden rounded-full bg-muted">
        {total > 0 &&
          buckets.map((b, i) => (
            <div
              key={b.label}
              style={{ width: `${(Math.max(0, b.amount) / total) * 100}%` }}
              className={
                ["bg-success", "bg-warning", "bg-warning/80", "bg-destructive/70", "bg-destructive"][i]
              }
              title={`${b.label}: ${format(b.amount)}`}
            />
          ))}
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-5">
        {buckets.map((b) => (
          <div key={b.label} className="flex items-baseline justify-between gap-2 sm:flex-col sm:items-start sm:gap-0.5">
            <span className="text-xs text-muted-foreground">{b.label}</span>
            <span className="tabular text-sm font-medium">{format(b.amount)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
