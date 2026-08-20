"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { formatMoney } from "@/lib/format";
import { newId, submit } from "@/lib/offline/outbox";
import { applyLocal } from "@/lib/offline/sync";
import { productRow } from "@/lib/offline/optimistic";
import { formFields } from "@/lib/offline/form";
import type { Product } from "@/lib/types";

const UNITS = ["pcs", "box", "carton", "kg", "litre", "metre", "bag", "set", "hour"];

export function ProductDialog({
  product,
  trigger,
  open: controlledOpen,
  onOpenChange,
}: {
  product?: Product;
  /** Omit when the dialog is driven from outside, e.g. by a clickable row. */
  trigger?: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : uncontrolledOpen;

  const setOpen = (next: boolean) => {
    if (isControlled) onOpenChange?.(next);
    else setUncontrolledOpen(next);
  };

  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [selling, setSelling] = useState(product?.selling_price ?? 0);
  const [buying, setBuying] = useState(product?.buying_price ?? 0);
  const [vatApplicable, setVatApplicable] = useState(product?.vat_applicable ?? true);

  function onSubmit(formData: FormData) {
    const name = String(formData.get("name") ?? "").trim() || "Product";

    // Its own id, so a product added with no signal can be put on an invoice
    // straight away rather than waiting for the database to name it.
    const fields = formFields(formData);
    const id = product?.id ?? newId();
    if (!product) fields.client_id = id;

    startTransition(async () => {
      await applyLocal("products", [productRow(id, fields)]);

      const result = await submit({
        kind: "product.save",
        label: product ? `Edit product · ${name}` : `New product · ${name}`,
        body: fields,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setError(null);
      setOpen(false);

      if (result.queued) {
        toast.success("Saved on this device", {
          description: `${name} is ready to use now and will sync when you are back online.`,
        });
        return;
      }

      toast.success(product ? "Product updated" : "Product added");
      router.refresh();
    });
  }

  const profit = selling - buying;
  const margin = selling > 0 ? (profit / selling) * 100 : 0;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{product ? "Edit product" : "New product"}</DialogTitle>
          <DialogDescription>
            Stock is not tracked. The buying price is only used to work out your
            margin — customers never see it.
          </DialogDescription>
        </DialogHeader>

        <form action={onSubmit} className="flex flex-col gap-4">
          {product && <input type="hidden" name="id" value={product.id} />}
          <input
            type="hidden"
            name="vat_applicable"
            value={vatApplicable ? "true" : "false"}
          />

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <Label htmlFor="name">Product name *</Label>
              <Input
                id="name"
                name="name"
                required
                defaultValue={product?.name ?? ""}
                placeholder="Cement 50kg"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="sku">SKU</Label>
              <Input id="sku" name="sku" defaultValue={product?.sku ?? ""} />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="unit">Unit</Label>
              <Input
                id="unit"
                name="unit"
                list="unit-options"
                defaultValue={product?.unit ?? "pcs"}
              />
              <datalist id="unit-options">
                {UNITS.map((u) => (
                  <option key={u} value={u} />
                ))}
              </datalist>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="buying_price">Buying price (TSh)</Label>
              <Input
                id="buying_price"
                name="buying_price"
                type="number"
                min={0}
                step="0.01"
                inputMode="decimal"
                value={buying || ""}
                onChange={(e) => setBuying(Number(e.target.value) || 0)}
                placeholder="0"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="selling_price">Selling price (TSh) *</Label>
              <Input
                id="selling_price"
                name="selling_price"
                type="number"
                min={0}
                step="0.01"
                inputMode="decimal"
                required
                value={selling || ""}
                onChange={(e) => setSelling(Number(e.target.value) || 0)}
                placeholder="0"
              />
            </div>

            <div className="flex flex-col gap-1.5 sm:col-span-3">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                name="description"
                rows={2}
                defaultValue={product?.description ?? ""}
                placeholder="Appears on the invoice line if filled in"
              />
            </div>
          </div>

          {selling > 0 && buying > 0 && (
            <div className="flex items-center justify-between rounded-lg bg-muted px-3 py-2.5 text-sm">
              <span className="text-muted-foreground">Margin on each unit</span>
              <span
                className={`tabular font-medium ${profit < 0 ? "text-destructive" : "text-success"}`}
              >
                TSh {formatMoney(profit)} · {margin.toFixed(1)}%
              </span>
            </div>
          )}

          <label className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5">
            <span className="text-sm">
              <span className="font-medium">VAT applies</span>
              <span className="block text-xs text-muted-foreground">
                Turn off for zero-rated or exempt items
              </span>
            </span>
            <Switch checked={vatApplicable} onCheckedChange={setVatApplicable} />
          </label>

          {error && (
            <p
              role="alert"
              className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              {error}
            </p>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending && <Loader2 className="size-4 animate-spin" />}
              {product ? "Save changes" : "Add product"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
