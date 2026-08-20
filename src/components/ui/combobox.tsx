"use client";

import { useId, useMemo, useRef, useState } from "react";
import { Check, ChevronsUpDown, Search } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export type ComboboxOption = {
  value: string;
  label: string;
  hint?: string;
  /** Extra text matched against the search, e.g. a phone number or SKU. */
  keywords?: string;
};

/**
 * Searchable picker. Customer and product lists get long quickly, and a plain
 * <select> becomes unusable well before that — especially one-handed on a
 * phone.
 */
export function Combobox({
  options,
  value,
  onChange,
  placeholder = "Select…",
  searchPlaceholder = "Search…",
  emptyText = "Nothing found.",
  className,
  disabled,
  id,
}: {
  options: ComboboxOption[];
  value: string | null;
  onChange: (value: string, option: ComboboxOption) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  className?: string;
  disabled?: boolean;
  id?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  const selected = options.find((o) => o.value === value) ?? null;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options.slice(0, 200);
    return options
      .filter((o) =>
        `${o.label} ${o.hint ?? ""} ${o.keywords ?? ""}`.toLowerCase().includes(q),
      )
      .slice(0, 200);
  }, [options, query]);

  function pick(option: ComboboxOption) {
    onChange(option.value, option);
    setOpen(false);
    setQuery("");
  }

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setQuery("");
      }}
    >
      <PopoverTrigger asChild>
        <button
          id={id}
          type="button"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-haspopup="listbox"
          disabled={disabled}
          className={cn(
            "flex h-9.5 w-full items-center justify-between gap-2 rounded-md border border-input bg-card px-3 py-2 text-left text-sm shadow-xs transition-colors",
            "focus:outline-none focus:ring-2 focus:ring-ring/50 focus:border-ring",
            "disabled:cursor-not-allowed disabled:opacity-60",
            "text-base md:text-sm",
            className,
          )}
        >
          <span className={cn("truncate", !selected && "text-muted-foreground")}>
            {selected?.label ?? placeholder}
          </span>
          <ChevronsUpDown className="size-4 shrink-0 opacity-60" />
        </button>
      </PopoverTrigger>

      <PopoverContent
        className="w-[var(--radix-popover-trigger-width)] min-w-56 p-0"
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          listRef.current?.querySelector("input")?.focus();
        }}
      >
        <div ref={listRef}>
          <div className="flex items-center gap-2 border-b border-border px-3">
            <Search className="size-4 shrink-0 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && filtered[0]) {
                  e.preventDefault();
                  pick(filtered[0]);
                }
              }}
              placeholder={searchPlaceholder}
              className="h-10 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>

          <div id={listId} role="listbox" className="max-h-64 overflow-y-auto p-1">
            {filtered.length === 0 ? (
              <p className="px-3 py-6 text-center text-sm text-muted-foreground">
                {emptyText}
              </p>
            ) : (
              filtered.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  role="option"
                  aria-selected={o.value === value}
                  onClick={() => pick(o)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-sm px-2 py-2 text-left text-sm transition-colors",
                    "hover:bg-accent hover:text-accent-foreground",
                    o.value === value && "bg-accent/60",
                  )}
                >
                  <Check
                    className={cn(
                      "size-4 shrink-0",
                      o.value === value ? "opacity-100" : "opacity-0",
                    )}
                  />
                  <span className="min-w-0 flex-1 truncate">{o.label}</span>
                  {o.hint && (
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {o.hint}
                    </span>
                  )}
                </button>
              ))
            )}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
