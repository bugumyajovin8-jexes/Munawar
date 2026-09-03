"use client";

import { useId, useMemo, useRef, useState } from "react";
import { Check, ChevronsUpDown, Plus, Search } from "lucide-react";
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
  onCreate,
  createLabel = "Add",
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
  /**
   * Called with whatever has been typed, to create the thing being searched
   * for. Given a name already, because someone who has typed "Salam" and found
   * nothing has told us the name — asking for it again in a blank form is a
   * question they have already answered.
   */
  onCreate?: (typed: string) => void;
  createLabel?: string;
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

  function create() {
    if (!onCreate) return;
    const typed = query.trim();
    setOpen(false);
    setQuery("");
    onCreate(typed);
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
                if (e.key !== "Enter") return;
                e.preventDefault();
                // Enter takes the obvious action: the first match if there is
                // one, and otherwise creating what was typed. Searching for
                // something that is not there and pressing Enter should not be
                // a dead end.
                if (filtered[0]) pick(filtered[0]);
                else if (onCreate) create();
              }}
              placeholder={searchPlaceholder}
              className="h-10 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>

          <div id={listId} role="listbox" className="max-h-64 overflow-y-auto p-1">
            {filtered.length === 0 ? (
              <p className="px-3 py-5 text-center text-sm text-muted-foreground">
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

          {/*
            Creating from inside the picker, rather than sending someone to
            another screen to do it.
            
            Always offered, not only when the search finds nothing: realising
            you need a new customer usually happens while you are looking for
            one, and the moment you leave to add it, the invoice you were
            halfway through is gone.
          */}
          {onCreate && (
            <button
              type="button"
              onClick={create}
              className="flex w-full items-center gap-2 border-t border-border px-3 py-2.5 text-left text-sm font-medium text-primary transition-colors hover:bg-accent"
            >
              <Plus className="size-4 shrink-0" />
              <span className="min-w-0 truncate">
                {query.trim() ? `${createLabel} “${query.trim()}”` : createLabel}
              </span>
            </button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
