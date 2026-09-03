"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { attempt } from "@/lib/attempt";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { DateInput } from "@/components/ui/date-input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { formatDate, formatMoney, todayLocal } from "@/lib/format";
import { invoiceTotals, lineTotal, num } from "@/lib/money";
import { FREQUENCY_LABELS } from "@/lib/types";
import type {
  Customer,
  Product,
  RecurringFrequency,
  RecurringInvoice,
  RecurringItem,
  VatMode,
} from "@/lib/types";
import { saveRecurring } from "./actions";

type Line = {
  key: string;
  product_id: string | null;
  description: string;
  unit: string;
  qty: number;
  unit_price: number;
  vat_applicable: boolean;
};

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

export function RecurringBuilder({
  customers,
  products,
  defaultTermsDays,
  vatRate,
  schedule,
  items,
}: {
  customers: Customer[];
  products: Product[];
  defaultTermsDays: number;
  vatRate: number;
  schedule?: RecurringInvoice;
  items?: RecurringItem[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [name, setName] = useState(schedule?.name ?? "");
  const [customerId, setCustomerId] = useState<string | null>(
    schedule?.customer_id ?? null,
  );
  const [frequency, setFrequency] = useState<RecurringFrequency>(
    schedule?.frequency ?? "monthly",
  );
  const [intervalCount, setIntervalCount] = useState(schedule?.interval_count ?? 1);
  const [nextRunOn, setNextRunOn] = useState(schedule?.next_run_on ?? todayLocal());
  const [endOn, setEndOn] = useState(schedule?.end_on ?? "");
  const [termsDays, setTermsDays] = useState(schedule?.terms_days ?? defaultTermsDays);
  const [vatMode, setVatMode] = useState<VatMode>(schedule?.vat_mode ?? "exclusive");
  const [autoIssue, setAutoIssue] = useState(schedule?.auto_issue ?? false);
  const [notes, setNotes] = useState(schedule?.customer_notes ?? "");

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
      unit_price: Number(p.selling_price),
      vat_applicable: p.vat_applicable,
    });
  }

  const totals = useMemo(
    () => invoiceTotals(lines, vatMode, vatRate),
    [lines, vatMode, vatRate],
  );

  function submit() {
    if (!customerId) {
      toast.error("Choose a customer first.");
      return;
    }
    const usable = lines.filter((l) => l.description.trim() && num(l.qty) > 0);
    if (usable.length === 0) {
      toast.error("Add at least one line with a description and quantity.");
      return;
    }

    startTransition(async () => {
      const result = await attempt("saving this schedule", () =>
        saveRecurring({
          id: schedule?.id ?? null,
          customer_id: customerId,
          name: name.trim(),
          frequency,
          interval_count: intervalCount,
          next_run_on: nextRunOn,
          end_on: endOn || null,
          terms_days: termsDays,
          vat_mode: vatMode,
          customer_notes: notes.trim() || null,
          auto_issue: autoIssue,
          items: usable.map((l) => ({
            product_id: l.product_id,
            description: l.description.trim(),
            unit: l.unit || "pcs",
            qty: num(l.qty),
            unit_price: num(l.unit_price),
            vat_applicable: l.vat_applicable,
          })),
        }),
      );

      if (!result) return;
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(schedule ? "Schedule updated" : "Schedule created");
      router.push("/recurring");
      router.refresh();
    });
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
      <div className="flex flex-col gap-5">
        <Card>
          <CardHeader>
            <CardTitle>Schedule</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <Label htmlFor="name">Name *</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Monthly water delivery — Ali Hassan"
              />
            </div>

            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <Label htmlFor="customer">Customer *</Label>
              <Combobox
                id="customer"
                options={customerOptions}
                value={customerId}
                onChange={(id) => {
                  setCustomerId(id);
                  const c = customers.find((x) => x.id === id);
                  if (c && !schedule) setTermsDays(c.payment_terms_days);
                }}
                placeholder="Choose a customer"
                searchPlaceholder="Search name or phone…"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="frequency">How often</Label>
              <Select
                value={frequency}
                onValueChange={(v) => setFrequency(v as RecurringFrequency)}
              >
                <SelectTrigger id="frequency">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(FREQUENCY_LABELS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="interval">Repeat every</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="interval"
                  type="number"
                  min={1}
                  max={12}
                  inputMode="numeric"
                  value={intervalCount}
                  onChange={(e) =>
                    setIntervalCount(Math.min(12, Math.max(1, Number(e.target.value) || 1)))
                  }
                  className="w-20"
                />
                <span className="text-sm text-muted-foreground">
                  {frequency === "weekly"
                    ? "week(s)"
                    : frequency === "yearly"
                      ? "year(s)"
                      : frequency === "quarterly"
                        ? "quarter(s)"
                        : "month(s)"}
                </span>
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="next_run">First / next run *</Label>
              <DateInput
                id="next_run"
                value={nextRunOn}
                onChange={(e) => setNextRunOn(e.target.value)}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="end_on">Stop after (optional)</Label>
              <DateInput
                id="end_on"
                value={endOn}
                min={nextRunOn}
                onChange={(e) => setEndOn(e.target.value)}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="terms">Payment terms (days)</Label>
              <Input
                id="terms"
                type="number"
                min={0}
                max={365}
                inputMode="numeric"
                value={termsDays}
                onChange={(e) => setTermsDays(Math.max(0, Number(e.target.value) || 0))}
              />
            </div>

            <label className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5">
              <span className="text-sm">
                <span className="font-medium">Add VAT at {vatRate}%</span>
              </span>
              <Switch
                checked={vatMode === "exclusive"}
                onCheckedChange={(on) => setVatMode(on ? "exclusive" : "none")}
              />
            </label>

            <label className="flex items-start justify-between gap-3 rounded-lg border border-border px-3 py-2.5 sm:col-span-2">
              <span className="text-sm">
                <span className="font-medium">Issue automatically</span>
                <span className="block text-xs text-muted-foreground">
                  {autoIssue
                    ? "Numbered and locked the moment it generates — nobody checks it first."
                    : "Leaves a draft for you to review, then you issue it yourself."}
                </span>
              </span>
              <Switch checked={autoIssue} onCheckedChange={setAutoIssue} />
            </label>

            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <Label htmlFor="notes">Note on every invoice</Label>
              <Textarea
                id="notes"
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>
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
            {lines.map((line, index) => (
              <div
                key={line.key}
                className="flex flex-col gap-3 rounded-lg border border-border p-3 lg:grid lg:grid-cols-[minmax(0,2.2fr)_80px_120px_60px_110px_36px] lg:items-center lg:gap-2 lg:border-0 lg:p-0"
              >
                <div className="flex items-center justify-between lg:hidden">
                  <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Line {index + 1}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    onClick={() =>
                      setLines((prev) =>
                        prev.length === 1 ? [blankLine()] : prev.filter((l) => l.key !== line.key),
                      )
                    }
                    aria-label="Remove line"
                  >
                    <Trash2 className="size-4 text-muted-foreground" />
                  </Button>
                </div>

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
                    onChange={(e) => updateLine(line.key, { description: e.target.value })}
                    placeholder="Description on the invoice"
                    className="h-8 text-xs"
                  />
                </div>

                <div className="grid grid-cols-2 gap-2 lg:contents">
                  <div className="flex flex-col gap-1 lg:contents">
                    <Label className="text-xs lg:hidden">Quantity</Label>
                    <Input
                      type="number"
                      min={0}
                      step="0.001"
                      inputMode="decimal"
                      value={line.qty || ""}
                      onChange={(e) => updateLine(line.key, { qty: Number(e.target.value) || 0 })}
                      className="text-right tabular"
                      aria-label="Quantity"
                    />
                  </div>
                  <div className="flex flex-col gap-1 lg:contents">
                    <Label className="text-xs lg:hidden">Unit price</Label>
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
                  </div>
                </div>

                <div className="flex items-center justify-between border-t border-border pt-2.5 lg:contents">
                  <div className="flex items-center gap-2 lg:justify-center">
                    <Switch
                      checked={vatMode === "exclusive" && line.vat_applicable}
                      disabled={vatMode === "none"}
                      onCheckedChange={(on) => updateLine(line.key, { vat_applicable: on })}
                      aria-label="VAT on this line"
                    />
                    <span className="text-sm lg:hidden">VAT</span>
                  </div>
                  <span className="tabular text-sm font-medium lg:text-right">
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

                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  onClick={() =>
                    setLines((prev) =>
                      prev.length === 1 ? [blankLine()] : prev.filter((l) => l.key !== line.key),
                    )
                  }
                  aria-label="Remove line"
                  className="hidden lg:inline-flex"
                >
                  <Trash2 className="size-4 text-muted-foreground" />
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card className="lg:sticky lg:top-6">
        <CardHeader>
          <CardTitle>Each invoice</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <dl className="flex flex-col gap-2 text-sm">
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
            <div className="flex items-center justify-between pt-1">
              <dt className="text-muted-foreground">First run</dt>
              <dd className="tabular">{formatDate(nextRunOn)}</dd>
            </div>
          </dl>

          <Button onClick={submit} disabled={pending} className="w-full">
            {pending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Save className="size-4" />
            )}
            {schedule ? "Save schedule" : "Create schedule"}
          </Button>
          <p className="text-xs text-muted-foreground">
            Runs shortly after midnight East Africa time. If the app has been
            asleep for a while it catches up on the runs it missed.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
