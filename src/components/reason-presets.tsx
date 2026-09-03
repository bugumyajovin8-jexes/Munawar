"use client";

import { cn } from "@/lib/utils";

/**
 * The handful of reasons that account for almost every case, one tap each.
 *
 * A required free-text box is how you end up with an audit trail of "x" and
 * "asdf". Not because people are careless, but because they are standing at a
 * counter with a customer waiting, and the field is between them and the thing
 * they are trying to do. Offer the real answers and the common case becomes a
 * tap, which is both faster and more truthful than what gets typed under
 * pressure.
 *
 * It fills the box rather than replacing it: the text stays editable, so a
 * preset is a starting point — "Customer cancelled the order — changed to the
 * 50kg bags" — and anything genuinely unusual can still be written out.
 */
export function ReasonPresets({
  presets,
  value,
  onSelect,
  className,
}: {
  presets: readonly string[];
  /** The current text, so the matching chip can show as chosen. */
  value: string;
  onSelect: (reason: string) => void;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap gap-1.5", className)}>
      {presets.map((preset) => {
        const chosen = value.trim() === preset;
        return (
          <button
            key={preset}
            type="button"
            aria-pressed={chosen}
            onClick={() => onSelect(chosen ? "" : preset)}
            className={cn(
              "rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
              chosen
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-card text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            {preset}
          </button>
        );
      })}
    </div>
  );
}
