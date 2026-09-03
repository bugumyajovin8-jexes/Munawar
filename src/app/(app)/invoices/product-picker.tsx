"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Check,
  Minus,
  Package,
  Plus,
  Search,
  ShoppingBag,
  Trash2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatMoney } from "@/lib/format";
import { lineTotal, num } from "@/lib/money";
import { cn } from "@/lib/utils";
import type { Product } from "@/lib/types";

export type PickerLine = {
  key: string;
  product_id: string | null;
  description: string;
  unit: string;
  qty: number;
  unit_price: number;
  vat_applicable: boolean;
};

const ALPHABET = ["#", ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("")];

/** "#" collects everything that does not start with a letter. */
function initial(name: string): string {
  const first = name.trim().charAt(0).toUpperCase();
  return /[A-Z]/.test(first) ? first : "#";
}

/**
 * Choosing what goes on an invoice, as a screen of its own.
 *
 * The line-item table it replaces asked the user to fill a row before they
 * could see what they were buying — a form pretending to be a catalogue. This
 * is the other way round: the products are the page, tapping one puts it on
 * the invoice, and the running list sits beside them so the total is never a
 * surprise at the end.
 *
 * Layout splits at `md`. On a wide screen the catalogue and the selection sit
 * side by side, because there is room and glancing between them costs nothing.
 * On a phone the selection rides at the top as a summary and the catalogue
 * fills the rest, because side-by-side at 375px gives neither enough space.
 */
export function ProductPicker({
  onClose,
  products,
  lines,
  vatRate,
  vatApplies,
  onAdd,
  onUpdate,
  onRemove,
  onClear,
  onCreateProduct,
}: {
  onClose: () => void;
  products: Product[];
  lines: PickerLine[];
  vatRate: number;
  vatApplies: boolean;
  onAdd: (product: Product) => void;
  onUpdate: (key: string, patch: Partial<PickerLine>) => void;
  onRemove: (key: string) => void;
  onClear: () => void;
  /** Create a product that does not exist yet, without leaving this screen. */
  onCreateProduct: (typed: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [letter, setLetter] = useState<string | null>(null);

  /*
   * Escape closes, as it would for any dialog. Done and Escape do the same
   * thing here — nothing is discarded, the invoice already has the lines.
   *
   * There is no effect resetting the search when this closes, because the
   * parent only mounts this while it is open: arriving fresh is what mounting
   * already means. Clearing state from an effect would be the same result by a
   * worse route, and React rightly complains about it.
   */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return products
      .filter((p) => {
        if (letter && initial(p.name) !== letter) return false;
        if (!needle) return true;
        return (
          p.name.toLowerCase().includes(needle) ||
          (p.sku ?? "").toLowerCase().includes(needle)
        );
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [products, search, letter]);

  const chosen = useMemo(
    () => new Map(lines.filter((l) => l.product_id).map((l) => [l.product_id!, l])),
    [lines],
  );

  /*
   * What is on the invoice, as opposed to what is in the form's state.
   *
   * A new invoice starts life holding one blank line — a placeholder the form
   * needs, not something anybody chose. Listing the raw lines rendered that
   * placeholder as a row, and since it has no description it was labelled
   * "One-off item": a phantom entry on an empty invoice, contradicting the
   * total beside it, which had always filtered it out.
   */
  const visible = lines.filter((l) => l.description.trim());

  // Quantity as well, for the money: a line someone has momentarily cleared
  // the quantity of should stay on screen while contributing nothing.
  const filled = visible.filter((l) => num(l.qty) > 0);
  const runningTotal = filled.reduce(
    (sum, l) =>
      sum + lineTotal(num(l.qty), num(l.unit_price), l.vat_applicable && vatApplies, vatRate),
    0,
  );
  const itemCount = filled.reduce((sum, l) => sum + num(l.qty), 0);

  const catalogue = (
    <>
      <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            autoFocus
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search products…"
            className="h-10 pl-9"
          />
        </div>
      </div>

      {/* Jump straight to a letter — faster than typing when you know the
          name, and the whole point on a phone keyboard. */}
      <div className="no-scrollbar flex items-center gap-1 overflow-x-auto border-b border-border px-3 py-1.5">
        <button
          type="button"
          onClick={() => setLetter(null)}
          className={cn(
            "shrink-0 rounded-md px-2.5 py-1 text-[10px] font-bold transition-colors",
            letter === null
              ? "bg-primary text-primary-foreground"
              : "bg-muted text-muted-foreground hover:bg-accent",
          )}
        >
          All
        </button>
        {ALPHABET.map((l) => (
          <button
            key={l}
            type="button"
            onClick={() => setLetter(l === letter ? null : l)}
            className={cn(
              "flex size-7 shrink-0 items-center justify-center rounded-md text-[10px] font-bold transition-colors",
              letter === l
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:bg-accent",
            )}
          >
            {l}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto bg-muted/30 p-2 sm:p-3">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center py-16 text-center">
            <div className="mb-3 rounded-full bg-muted p-4">
              <Package className="size-7 text-muted-foreground" />
            </div>
            <p className="text-sm font-semibold">No product found</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {search.trim()
                ? "Add it to your products, or put it on this invoice only."
                : "Add products and they become one-tap invoice lines."}
            </p>

            {/*
              Offered right where the search failed. Realising a product is
              missing happens while looking for it, and sending someone to the
              products screen would lose the invoice they are part-way through.
            */}
            {search.trim() && (
              <Button
                variant="outline"
                size="sm"
                className="mt-4"
                onClick={() => onCreateProduct(search.trim())}
              >
                <Plus className="size-4" />
                New product “{search.trim()}”
              </Button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-2 items-start gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 sm:gap-3">
            {filtered.map((product) => {
              const line = chosen.get(product.id);
              const inInvoice = Boolean(line);

              return (
                <button
                  key={product.id}
                  type="button"
                  onClick={() => onAdd(product)}
                  className={cn(
                    "group relative flex h-full min-h-[104px] flex-col rounded-xl border bg-card p-3 text-left transition-all sm:p-4",
                    inInvoice
                      ? "border-primary shadow-md ring-2 ring-primary/20"
                      : "border-border shadow-xs hover:border-primary hover:shadow-md",
                  )}
                >
                  <span className="absolute right-1.5 top-1.5 rounded-lg bg-primary p-1 text-primary-foreground opacity-0 transition-opacity group-hover:opacity-100">
                    <Plus className="size-3.5" />
                  </span>

                  <span className="line-clamp-2 pr-5 text-xs font-semibold leading-tight sm:text-sm">
                    {product.name}
                  </span>
                  <span className="mt-auto pt-2 text-base font-bold text-primary sm:text-lg">
                    {formatMoney(product.selling_price)}
                  </span>

                  {/* The count, not a tick: tapping again adds another, so
                      knowing how many are already on is the useful fact. */}
                  {line && (
                    <span className="mt-2 flex items-center gap-1.5 border-t border-border pt-2 text-[10px] font-bold uppercase tracking-wider text-primary">
                      <span className="flex size-1.5 rounded-full bg-primary" />
                      {num(line.qty)} on invoice
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </>
  );

  const selection = (
    <div className="flex flex-col gap-2">
      {visible.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 py-10 text-muted-foreground">
          <span className="flex size-16 items-center justify-center rounded-full bg-muted">
            <ShoppingBag className="size-7" />
          </span>
          <p className="text-sm font-semibold">Nothing on this invoice yet</p>
        </div>
      ) : (
        visible.map((line) => (
          <div
            key={line.key}
            className="flex items-center gap-2 rounded-xl border border-border bg-card p-2.5 sm:gap-3 sm:p-3"
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-semibold sm:text-sm">
                {line.description}
              </p>
              <div className="mt-1 flex items-center gap-1.5">
                {/* Editable, because a price agreed at the counter is a
                    normal thing and should not send anyone back a screen. */}
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  inputMode="decimal"
                  value={line.unit_price || ""}
                  onChange={(e) =>
                    onUpdate(line.key, { unit_price: Number(e.target.value) || 0 })
                  }
                  className="tabular h-7 w-24 px-2 text-xs"
                  aria-label={`Unit price for ${line.description}`}
                />
                <span className="text-[10px] text-muted-foreground">per {line.unit}</span>
              </div>
            </div>

            <div className="flex shrink-0 items-center rounded-lg bg-muted p-0.5">
              <button
                type="button"
                aria-label="One fewer"
                onClick={() =>
                  num(line.qty) > 1
                    ? onUpdate(line.key, { qty: num(line.qty) - 1 })
                    : onRemove(line.key)
                }
                className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-card"
              >
                <Minus className="size-3.5" />
              </button>
              <input
                type="number"
                min={1}
                value={line.qty || ""}
                onChange={(e) => onUpdate(line.key, { qty: Number(e.target.value) || 0 })}
                onFocus={(e) => e.target.select()}
                aria-label={`Quantity of ${line.description || "item"}`}
                className="tabular w-9 border-none bg-transparent p-0 text-center text-xs font-bold outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
              />
              <button
                type="button"
                aria-label="One more"
                onClick={() => onUpdate(line.key, { qty: num(line.qty) + 1 })}
                className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-card"
              >
                <Plus className="size-3.5" />
              </button>
            </div>

            <button
              type="button"
              aria-label={`Remove ${line.description || "item"}`}
              onClick={() => onRemove(line.key)}
              className="shrink-0 rounded-lg p-1.5 text-destructive transition-colors hover:bg-destructive/10"
            >
              <Trash2 className="size-4" />
            </button>
          </div>
        ))
      )}
    </div>
  );

  const summary = (
    <div className="flex flex-col gap-3 border-t border-border bg-card p-4">
      <div className="flex items-end justify-between">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            Invoice total
          </p>
          <p className="tabular text-2xl font-bold">{formatMoney(runningTotal)}</p>
        </div>
        <p className="text-xs font-medium text-muted-foreground">
          {itemCount} {itemCount === 1 ? "item" : "items"}
        </p>
      </div>

      {/* Nothing to submit — the lines are already on the invoice. This just
          says "I have finished choosing" and gets out of the way. */}
      <Button onClick={onClose} className="w-full">
        <Check className="size-4" />
        Done
      </Button>
    </div>
  );

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Choose products"
      className="fixed inset-0 z-50 flex flex-col bg-background"
    >
      <div className="flex shrink-0 items-center justify-between border-b border-border bg-card px-4 py-3">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <ShoppingBag className="size-5 text-primary" />
          Choose products
        </h2>
        <div className="flex items-center gap-2">
          {lines.length > 0 && (
            <button
              type="button"
              onClick={onClear}
              className="text-xs font-semibold text-destructive hover:underline"
            >
              Clear all
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-accent"
          >
            <X className="size-5" />
          </button>
        </div>
      </div>

      {/* Phone: the selection rides above the catalogue as a summary. */}
      <div className="flex min-h-0 flex-1 flex-col md:hidden">
        {lines.length > 0 && (
          <div className="max-h-[38%] shrink-0 overflow-y-auto border-b border-border bg-muted/40 p-3">
            {selection}
          </div>
        )}
        <div className="flex min-h-0 flex-1 flex-col">{catalogue}</div>
        {summary}
      </div>

      {/* Desktop: side by side, because there is room to glance between them. */}
      <div className="hidden min-h-0 flex-1 md:flex">
        <div className="flex min-w-0 flex-1 flex-col border-r border-border">
          {catalogue}
        </div>
        <aside className="flex w-[380px] shrink-0 flex-col bg-muted/40 lg:w-[440px]">
          <div className="flex-1 overflow-y-auto p-4">{selection}</div>
          {summary}
        </aside>
      </div>
    </div>
  );
}
