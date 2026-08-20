"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, Save, Send, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { addDays, formatDate, formatMoney, todayLocal } from "@/lib/format";
import { invoiceTotals, lineTotal, num } from "@/lib/money";
import { cn } from "@/lib/utils";
import { submit } from "@/lib/offline/outbox";
import { mergeById, useAll } from "@/lib/offline/local";
import { newId } from "@/lib/offline/outbox";
import { deviceId, returnNumber, takeNumber } from "@/lib/offline/numbers";
import { useOnline } from "@/lib/offline/hooks";
import { getCustomerPrices, saveAndIssue } from "./actions";
import type { Customer, Invoice, InvoiceItem, Product, VatMode } from "@/lib/types";

type Line = {
  key: string;
  product_id: string | null;
  description: string;
  unit: string;
  qty: number;
  unit_price: number;
  vat_applicable: boolean;
};

const TERM_PRESETS = [15, 30, 60, 90];

function blankLine(): Line {
  return {
    key: crypto.randomUUID(),
    product_id: null,
    description: "",
    unit: "pcs",
    qty: 1,
    unit_price: 0,
    vat_applicable: true,
  };
}

export function InvoiceBuilder({
  customers: serverCustomers,
  products: serverProducts,
  defaultTermsDays,
  vatRate,
  invoice,
  items,
  initialCustomerId,
}: {
  customers: Customer[];
  products: Product[];
  defaultTermsDays: number;
  vatRate: number;
  invoice?: Invoice;
  items?: InvoiceItem[];
  initialCustomerId?: string;
}) {

  /*
   * Pickers read this device's mirror, not the props.
   *
   * The props come from a server render, which means a customer added with no
   * signal was invisible here until it synced — you could create someone and
   * then be unable to invoice them, which is exactly the complaint this whole
   * piece of work started from. The mirror has them the moment the dialog
   * closes, because the customer dialog writes there before it even attempts
   * the network.
   *
   * The server lists remain the fallback for the one case the mirror cannot
   * cover: a first-ever load, before the first sync has finished.
   */
  const mirrorCustomers = useAll<Customer>("customers");
  const mirrorProducts = useAll<Product>("products");

  const customers = useMemo(
    () =>
      mergeById(serverCustomers, mirrorCustomers)
        .filter((c) => c.is_active !== false)
        .sort((a, b) => a.name.localeCompare(b.name)),
    [mirrorCustomers, serverCustomers],
  );

  const products = useMemo(
    () =>
      mergeById(serverProducts, mirrorProducts)
        .filter((p) => p.is_active !== false)
        .sort((a, b) => a.name.localeCompare(b.name)),
    [mirrorProducts, serverProducts],
  );

  const router = useRouter();
  const online = useOnline();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<"draft" | "issue" | null>(null);

  const [customerId, setCustomerId] = useState<string | null>(
    invoice?.customer_id ?? initialCustomerId ?? null,
  );
  const [orderDate, setOrderDate] = useState(invoice?.order_date ?? todayLocal());
  const [termsDays, setTermsDays] = useState(invoice?.terms_days ?? defaultTermsDays);
  const [vatMode, setVatMode] = useState<VatMode>(invoice?.vat_mode ?? "exclusive");
  const [customerNotes, setCustomerNotes] = useState(invoice?.customer_notes ?? "");
  const [internalNotes, setInternalNotes] = useState(invoice?.internal_notes ?? "");
  const [priceBook, setPriceBook] = useState<{
    customerId: string | null;
    prices: Record<string, number>;
  }>({ customerId: null, prices: {} });

  const [lines, setLines] = useState<Line[]>(() =>
    items?.length
      ? items.map((i) => ({
          key: crypto.randomUUID(),
          product_id: i.product_id,
          description: i.description,
          unit: i.unit,
          qty: Number(i.qty),
          unit_price: Number(i.unit_price),
          vat_applicable: i.vat_applicable,
        }))
      : [blankLine()],
  );

  const customerOptions: ComboboxOption[] = useMemo(
    () =>
      customers.map((c) => ({
        value: c.id,
        label: c.name,
        hint: c.phone_e164 ?? undefined,
        keywords: `${c.phone_e164 ?? ""} ${c.contact_person ?? ""}`,
      })),
    [customers],
  );

  const productOptions: ComboboxOption[] = useMemo(
    () =>
      products
        .filter((p) => p.is_active)
        .map((p) => ({
          value: p.id,
          label: p.name,
          hint: formatMoney(p.selling_price),
          keywords: p.sku ?? "",
        })),
    [products],
  );

  const selectedCustomer = customers.find((c) => c.id === customerId) ?? null;

  // Pull this customer's previously agreed prices so lines added from here on
  // are offered at the price they actually pay, not the list price.
  useEffect(() => {
    if (!customerId) return;
    let cancelled = false;
    getCustomerPrices(customerId).then((prices) => {
      if (!cancelled) setPriceBook({ customerId, prices });
    });
    return () => {
      cancelled = true;
    };
  }, [customerId]);

  // Tagged with the customer it was fetched for. Switching customers mid-fetch
  // therefore falls back to list prices rather than briefly offering the
  // previous customer's negotiated ones.
  const agreedPrices =
    priceBook.customerId === customerId ? priceBook.prices : {};

  function handleCustomerChange(id: string) {
    setCustomerId(id);
    const c = customers.find((x) => x.id === id);
    // Only adopt their terms on a fresh invoice, never overwrite a deliberate
    // choice on one already being edited.
    if (c && !invoice) setTermsDays(c.payment_terms_days);
  }

  function updateLine(key: string, patch: Partial<Line>) {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  function pickProduct(key: string, productId: string) {
    const p = products.find((x) => x.id === productId);
    if (!p) return;
    updateLine(key, {
      product_id: p.id,
      description: p.description?.trim() || p.name,
      unit: p.unit,
      unit_price: agreedPrices[p.id] ?? Number(p.selling_price),
      vat_applicable: p.vat_applicable,
    });
  }

  const totals = useMemo(
    () => invoiceTotals(lines, vatMode, vatRate),
    [lines, vatMode, vatRate],
  );

  const dueIfIssuedToday = addDays(todayLocal(), termsDays);

  function buildPayload() {
    return {
      invoice_id: invoice?.id ?? null,
      customer_id: customerId ?? "",
      order_date: orderDate,
      terms_days: termsDays,
      vat_mode: vatMode,
      customer_notes: customerNotes.trim() || null,
      internal_notes: internalNotes.trim() || null,
      items: lines
        .filter((l) => l.description.trim() && num(l.qty) > 0)
        .map((l) => ({
          product_id: l.product_id,
          description: l.description.trim(),
          unit: l.unit || "pcs",
          qty: num(l.qty),
          unit_price: num(l.unit_price),
          vat_applicable: l.vat_applicable,
        })),
    };
  }

  function validate(): string | null {
    if (!customerId) return "Choose a customer first.";
    const usable = lines.filter((l) => l.description.trim() && num(l.qty) > 0);
    if (usable.length === 0) return "Add at least one line with a description and quantity.";
    return null;
  }

  function onSaveDraft() {
    const problem = validate();
    if (problem) return toast.error(problem);

    const customerName =
      customers.find((c) => c.id === customerId)?.name ?? "invoice";

    setBusy("draft");
    startTransition(async () => {
      const result = await submit({
        kind: "invoice.draft",
        label: `Draft · ${customerName} · TSh ${formatMoney(totals.total)}`,
        body: buildPayload(),
      });
      setBusy(null);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }

      if (result.queued) {
        // No id to open — the database has not seen it yet. The sync panel is
        // where the user can confirm it is safe in the meantime.
        toast.success("Draft saved on this device", {
          description: "It uploads itself as soon as you are back online.",
        });
        router.push("/invoices");
        return;
      }

      toast.success("Saved as draft", {
        description: "Issue it when the goods actually ship.",
      });
      router.push(
        result.data?.invoiceId ? `/invoices/${result.data.invoiceId}` : "/invoices",
      );
    });
  }

  /**
   * Issue with no signal: save the draft under an id this device chose, spend
   * one of its own numbers, and queue both for the server to confirm.
   */
  async function issueFromBlock() {
    const taken = await takeNumber();
    if (!taken) {
      toast.error("No invoice numbers left on this device", {
        description:
          "Save it as a draft — it takes its number the moment you are back online.",
      });
      return;
    }

    const invoiceId = invoice?.id ?? newId();
    const payload = { ...buildPayload(), invoice_id: invoiceId };

    const draft = await submit({
      kind: "invoice.draft",
      label: `Draft · ${customers.find((c) => c.id === customerId)?.name ?? "invoice"}`,
      body: payload,
    });

    if (!draft.ok) {
      // Nothing was issued, so the number was never used. Putting it back
      // keeps the sequence tight instead of leaving a hole for a failed save.
      await returnNumber(taken.number);
      toast.error(draft.error);
      return;
    }

    const issued = await submit({
      kind: "invoice.issue",
      label: `Issue invoice · ${String(taken.number).padStart(4, "0")}`,
      body: {
        invoiceId,
        deviceId: await deviceId(),
        number: taken.number,
        shipDate: null,
      },
    });

    if (!issued.ok) {
      await returnNumber(taken.number);
      toast.error(issued.error);
      return;
    }

    toast.success(`Invoice ${String(taken.number).padStart(4, "0")} issued`, {
      description: "Saved on this device — it uploads itself when you have signal.",
    });
    router.push("/invoices");
  }

  function onIssueNow() {
    const problem = validate();
    if (problem) return toast.error(problem);

    /*
     * Offline, the number comes from the block this device was lent in advance.
     *
     * It is still the server that decides: the range was granted by the same
     * row lock that hands out numbers online, and when this reaches /api/sync
     * the number is checked against that grant before anything is booked. So
     * the phone is not minting numbers, it is spending ones already set aside
     * for it — which is what keeps them unique across every device.
     *
     * A device that has run out falls back to a draft. Inventing one would
     * eventually hand two customers the same invoice number.
     */
    if (!online) {
      setBusy("issue");
      void issueFromBlock().finally(() => setBusy(null));
      return;
    }

    setBusy("issue");
    startTransition(async () => {
      const result = await saveAndIssue(buildPayload(), null);
      setBusy(null);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(`Invoice ${result.number ?? ""} issued`);
      router.push(`/invoices/${result.invoiceId}?issued=1`);
    });
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
      <div className="flex flex-col gap-5">
        <Card>
          <CardHeader>
            <CardTitle>Customer &amp; dates</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <Label htmlFor="customer">Customer *</Label>
              <Combobox
                id="customer"
                options={customerOptions}
                value={customerId}
                onChange={handleCustomerChange}
                placeholder="Choose a customer"
                searchPlaceholder="Search name or phone…"
                emptyText="No customers yet — add one first."
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="order_date">Order date</Label>
              <Input
                id="order_date"
                type="date"
                value={orderDate}
                onChange={(e) => setOrderDate(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                When they ordered. The invoice date is stamped when you issue it.
              </p>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="terms">Payment terms</Label>
              <div className="flex flex-wrap gap-1.5">
                {TERM_PRESETS.map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setTermsDays(d)}
                    className={cn(
                      "rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors",
                      termsDays === d
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border bg-card hover:bg-accent",
                    )}
                  >
                    {d} days
                  </button>
                ))}
                <Input
                  id="terms"
                  type="number"
                  min={0}
                  max={365}
                  inputMode="numeric"
                  value={termsDays}
                  onChange={(e) => setTermsDays(Math.max(0, Number(e.target.value) || 0))}
                  className="h-8 w-20 text-xs"
                  aria-label="Custom payment terms in days"
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Issued today → due {formatDate(dueIfIssuedToday)}
              </p>
            </div>

            <label className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5 sm:col-span-2">
              <span className="text-sm">
                <span className="font-medium">Add VAT at {vatRate}%</span>
                <span className="block text-xs text-muted-foreground">
                  Charged on top of your prices — the customer pays it
                </span>
              </span>
              <Switch
                checked={vatMode === "exclusive"}
                onCheckedChange={(on) => setVatMode(on ? "exclusive" : "none")}
              />
            </label>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>Items</CardTitle>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setLines((prev) => [...prev, blankLine()])}
            >
              <Plus className="size-4" />
              Add line
            </Button>
          </CardHeader>

          <CardContent className="flex flex-col gap-3">
            {/* Desktop: a compact grid that reads like a spreadsheet row. */}
            <div className="hidden lg:block">
              <div className="grid grid-cols-[minmax(0,2.2fr)_80px_120px_60px_110px_36px] gap-2 pb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <span>Item</span>
                <span className="text-right">Qty</span>
                <span className="text-right">Unit price</span>
                <span className="text-center">VAT</span>
                <span className="text-right">Total</span>
                <span />
              </div>

              <div className="flex flex-col gap-2">
                {lines.map((line) => (
                  <div
                    key={line.key}
                    className="grid grid-cols-[minmax(0,2.2fr)_80px_120px_60px_110px_36px] items-center gap-2"
                  >
                    <div className="flex flex-col gap-1.5">
                      <Combobox
                        options={productOptions}
                        value={line.product_id}
                        onChange={(id) => pickProduct(line.key, id)}
                        placeholder="Pick a product…"
                        searchPlaceholder="Search products…"
                      />
                      <Input
                        value={line.description}
                        onChange={(e) =>
                          updateLine(line.key, { description: e.target.value })
                        }
                        placeholder="Description on the invoice"
                        className="h-8 text-xs"
                      />
                    </div>

                    <Input
                      type="number"
                      min={0}
                      step="0.001"
                      inputMode="decimal"
                      value={line.qty || ""}
                      onChange={(e) =>
                        updateLine(line.key, { qty: Number(e.target.value) || 0 })
                      }
                      className="text-right tabular"
                      aria-label="Quantity"
                    />

                    <Input
                      type="number"
                      min={0}
                      step="0.01"
                      inputMode="decimal"
                      value={line.unit_price || ""}
                      onChange={(e) =>
                        updateLine(line.key, { unit_price: Number(e.target.value) || 0 })
                      }
                      className="text-right tabular"
                      aria-label="Unit price"
                    />

                    <div className="flex justify-center">
                      <Switch
                        checked={vatMode === "exclusive" && line.vat_applicable}
                        disabled={vatMode === "none"}
                        onCheckedChange={(on) =>
                          updateLine(line.key, { vat_applicable: on })
                        }
                        aria-label="VAT on this line"
                      />
                    </div>

                    <span className="text-right tabular text-sm font-medium">
                      {formatMoney(
                        lineTotal(
                          line.qty,
                          line.unit_price,
                          vatMode === "exclusive" && line.vat_applicable,
                          vatRate,
                        ),
                      )}
                    </span>

                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      onClick={() =>
                        setLines((prev) =>
                          prev.length === 1
                            ? [blankLine()]
                            : prev.filter((l) => l.key !== line.key),
                        )
                      }
                      aria-label="Remove line"
                    >
                      <Trash2 className="size-4 text-muted-foreground" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>

            {/* Phone: one card per line — the grid above is unusable at 375px. */}
            <div className="flex flex-col gap-3 lg:hidden">
              {lines.map((line, index) => (
                <div
                  key={line.key}
                  className="flex flex-col gap-3 rounded-lg border border-border p-3"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Line {index + 1}
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      onClick={() =>
                        setLines((prev) =>
                          prev.length === 1
                            ? [blankLine()]
                            : prev.filter((l) => l.key !== line.key),
                        )
                      }
                      aria-label="Remove line"
                    >
                      <Trash2 className="size-4 text-muted-foreground" />
                    </Button>
                  </div>

                  <Combobox
                    options={productOptions}
                    value={line.product_id}
                    onChange={(id) => pickProduct(line.key, id)}
                    placeholder="Pick a product…"
                    searchPlaceholder="Search products…"
                  />

                  <Input
                    value={line.description}
                    onChange={(e) => updateLine(line.key, { description: e.target.value })}
                    placeholder="Description"
                  />

                  <div className="grid grid-cols-2 gap-2">
                    <div className="flex flex-col gap-1">
                      <Label className="text-xs">Quantity</Label>
                      <Input
                        type="number"
                        min={0}
                        step="0.001"
                        inputMode="decimal"
                        value={line.qty || ""}
                        onChange={(e) =>
                          updateLine(line.key, { qty: Number(e.target.value) || 0 })
                        }
                        className="text-right tabular"
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <Label className="text-xs">Unit price</Label>
                      <Input
                        type="number"
                        min={0}
                        step="0.01"
                        inputMode="decimal"
                        value={line.unit_price || ""}
                        onChange={(e) =>
                          updateLine(line.key, {
                            unit_price: Number(e.target.value) || 0,
                          })
                        }
                        className="text-right tabular"
                      />
                    </div>
                  </div>

                  <div className="flex items-center justify-between border-t border-border pt-2.5">
                    <label className="flex items-center gap-2 text-sm">
                      <Switch
                        checked={vatMode === "exclusive" && line.vat_applicable}
                        disabled={vatMode === "none"}
                        onCheckedChange={(on) =>
                          updateLine(line.key, { vat_applicable: on })
                        }
                      />
                      VAT
                    </label>
                    <span className="tabular font-medium">
                      {formatMoney(
                        lineTotal(
                          line.qty,
                          line.unit_price,
                          vatMode === "exclusive" && line.vat_applicable,
                          vatRate,
                        ),
                      )}
                    </span>
                  </div>
                </div>
              ))}
            </div>

            <Button
              type="button"
              variant="outline"
              onClick={() => setLines((prev) => [...prev, blankLine()])}
              className="lg:hidden"
            >
              <Plus className="size-4" />
              Add line
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Notes</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="customer_notes">Note on the invoice</Label>
              <Textarea
                id="customer_notes"
                rows={3}
                value={customerNotes}
                onChange={(e) => setCustomerNotes(e.target.value)}
                placeholder="Delivery details, payment instructions…"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="internal_notes">Private note</Label>
              <Textarea
                id="internal_notes"
                rows={3}
                value={internalNotes}
                onChange={(e) => setInternalNotes(e.target.value)}
                placeholder="Only you and your team see this"
              />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Summary rail: sticky beside the form on desktop, inline on phones. */}
      <Card className="lg:sticky lg:top-6">
        <CardHeader>
          <CardTitle>Summary</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <dl className="flex flex-col gap-2 text-sm">
            <div className="flex items-center justify-between">
              <dt className="text-muted-foreground">Customer</dt>
              <dd className="max-w-[60%] truncate font-medium">
                {selectedCustomer?.name ?? "—"}
              </dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-muted-foreground">Subtotal</dt>
              <dd className="tabular font-medium">{formatMoney(totals.subtotal)}</dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-muted-foreground">
                VAT {vatMode === "exclusive" ? `(${vatRate}%)` : "(not charged)"}
              </dt>
              <dd className="tabular font-medium">{formatMoney(totals.vat)}</dd>
            </div>
            <div className="flex items-center justify-between border-t border-border pt-2.5">
              <dt className="font-medium">Total</dt>
              <dd className="tabular text-lg font-semibold">
                TSh {formatMoney(totals.total)}
              </dd>
            </div>
          </dl>

          <div className="flex flex-col gap-2 pt-1">
            <Button
              type="button"
              onClick={onIssueNow}
              disabled={pending || !online}
              className="w-full"
            >
              {busy === "issue" ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Send className="size-4" />
              )}
              Issue invoice now
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={onSaveDraft}
              disabled={pending}
              className="w-full"
            >
              {busy === "draft" ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Save className="size-4" />
              )}
              Save as draft
            </Button>
            <p className="text-xs text-muted-foreground">
              {online
                ? "Drafts get no invoice number. Issue it on the day you ship and the number, invoice date and due date are all stamped then."
                : "You are offline. Save it as a draft — it is kept on this device and uploaded automatically. Issuing needs a connection, because the invoice number comes from the server."}
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
