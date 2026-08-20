"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import {
  BellRing,
  FileText,
  Loader2,
  Package,
  Plus,
  Search,
  Users,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { globalSearch, type SearchHit } from "@/app/(app)/search-actions";
import type { UserRole } from "@/lib/types";

export const OPEN_PALETTE_EVENT = "munawar:open-command-palette";

export function openCommandPalette() {
  window.dispatchEvent(new Event(OPEN_PALETTE_EVENT));
}

type Action = {
  id: string;
  title: string;
  subtitle: string;
  href: string;
  icon: LucideIcon;
  adminOnly?: boolean;
};

const QUICK_ACTIONS: Action[] = [
  { id: "new-invoice", title: "New invoice", subtitle: "Start a fresh invoice", href: "/invoices/new", icon: Plus },
  { id: "customers", title: "Customers", subtitle: "Browse and add customers", href: "/customers", icon: Users },
  { id: "reminders", title: "Reminders", subtitle: "Chase overdue invoices", href: "/reminders", icon: BellRing },
  { id: "invoices", title: "All invoices", subtitle: "Search and filter", href: "/invoices", icon: FileText },
  { id: "products", title: "Products", subtitle: "Prices and margins", href: "/products", icon: Package },
];

const KIND_ICON: Record<SearchHit["kind"], LucideIcon> = {
  customer: Users,
  invoice: FileText,
  product: Package,
};

const KIND_LABEL: Record<SearchHit["kind"], string> = {
  customer: "Customer",
  invoice: "Invoice",
  product: "Product",
};

export function CommandPalette({ role }: { role: UserRole }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  // Results carry the query they belong to, so "is this stale?" is derived
  // rather than something an effect has to clear.
  const [result, setResult] = useState<{ query: string; hits: SearchHit[] }>({
    query: "",
    hits: [],
  });
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const requestId = useRef(0);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    }
    // Phones have no Ctrl+K, so the mobile top bar opens it by event instead.
    function onOpenRequest() {
      setOpen(true);
    }

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener(OPEN_PALETTE_EVENT, onOpenRequest);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener(OPEN_PALETTE_EVENT, onOpenRequest);
    };
  }, []);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) return;

    const id = ++requestId.current;
    const timer = setTimeout(async () => {
      const results = await globalSearch(trimmed);
      // Drop responses that arrived out of order.
      if (id !== requestId.current) return;
      setResult({ query: trimmed, hits: results });
      setCursor(0);
    }, 200);

    return () => clearTimeout(timer);
  }, [query]);

  const trimmedQuery = query.trim();
  const actions = QUICK_ACTIONS.filter((a) => !a.adminOnly || role === "admin");
  const showingActions = trimmedQuery.length < 2;
  const hits = result.query === trimmedQuery ? result.hits : [];
  const loading = !showingActions && result.query !== trimmedQuery;
  const rows: { key: string; href: string }[] = showingActions
    ? actions.map((a) => ({ key: a.id, href: a.href }))
    : hits.map((h) => ({ key: `${h.kind}-${h.id}`, href: h.href }));

  const go = useCallback(
    (href: string) => {
      setOpen(false);
      setQuery("");
      setResult({ query: "", hits: [] });
      router.push(href as never);
    },
    [router],
  );

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setCursor((c) => (rows.length === 0 ? 0 : (c + 1) % rows.length));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor((c) => (rows.length === 0 ? 0 : (c - 1 + rows.length) % rows.length));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const row = rows[cursor];
      if (row) go(row.href);
    }
  }

  return (
    <>
      {/* Desktop affordance — the shortcut is useless if nobody knows it exists */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="hidden w-full items-center gap-2 rounded-lg border border-sidebar-border bg-sidebar-accent/40 px-3 py-2 text-sm text-sidebar-muted transition-colors hover:bg-sidebar-accent lg:flex"
      >
        <Search className="size-4 shrink-0" />
        <span className="flex-1 text-left">Search…</span>
        <kbd className="rounded border border-sidebar-border px-1.5 py-0.5 font-mono text-[10px]">
          Ctrl K
        </kbd>
      </button>

      <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/45 backdrop-blur-[2px] data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0" />
          <DialogPrimitive.Content
            onOpenAutoFocus={(e) => {
              e.preventDefault();
              inputRef.current?.focus();
            }}
            className="fixed left-1/2 top-4 z-50 w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 overflow-hidden rounded-xl border border-border bg-popover shadow-2xl data-[state=open]:animate-in data-[state=open]:zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:zoom-out-95 sm:top-[12vh]"
          >
            <DialogPrimitive.Title className="sr-only">Search</DialogPrimitive.Title>
            <DialogPrimitive.Description className="sr-only">
              Search customers, invoices and products, or jump to a section.
            </DialogPrimitive.Description>

            <div className="flex items-center gap-2 border-b border-border px-4">
              <Search className="size-4 shrink-0 text-muted-foreground" />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder="Invoice number, customer, product…"
                className="h-12 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              />
              {loading && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
            </div>

            <div className="max-h-[60vh] overflow-y-auto p-2">
              {showingActions ? (
                <>
                  <p className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">
                    Jump to
                  </p>
                  {actions.map((action, index) => {
                    const Icon = action.icon;
                    return (
                      <button
                        key={action.id}
                        type="button"
                        onClick={() => go(action.href)}
                        onMouseEnter={() => setCursor(index)}
                        className={cn(
                          "flex w-full items-center gap-3 rounded-lg px-2 py-2.5 text-left transition-colors",
                          cursor === index ? "bg-accent" : "hover:bg-accent/60",
                        )}
                      >
                        <Icon className="size-4 shrink-0 text-muted-foreground" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">
                            {action.title}
                          </span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {action.subtitle}
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </>
              ) : hits.length === 0 ? (
                <p className="px-2 py-10 text-center text-sm text-muted-foreground">
                  {loading ? "Searching…" : `Nothing matches “${trimmedQuery}”.`}
                </p>
              ) : (
                hits.map((hit, index) => {
                  const Icon = KIND_ICON[hit.kind];
                  return (
                    <button
                      key={`${hit.kind}-${hit.id}`}
                      type="button"
                      onClick={() => go(hit.href)}
                      onMouseEnter={() => setCursor(index)}
                      className={cn(
                        "flex w-full items-center gap-3 rounded-lg px-2 py-2.5 text-left transition-colors",
                        cursor === index ? "bg-accent" : "hover:bg-accent/60",
                      )}
                    >
                      <Icon className="size-4 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">
                          {hit.title}
                        </span>
                        {hit.subtitle && (
                          <span className="block truncate text-xs text-muted-foreground">
                            {hit.subtitle}
                          </span>
                        )}
                      </span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {KIND_LABEL[hit.kind]}
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    </>
  );
}
