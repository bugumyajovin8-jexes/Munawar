"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Copy, FileMinus, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatMoney, formatTZS } from "@/lib/format";
import { round2 } from "@/lib/money";
import { createCreditNote, duplicateInvoice } from "../actions";
import type { InvoiceItem } from "@/lib/types";

export function DuplicateButton({ invoiceId }: { invoiceId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function run() {
    startTransition(async () => {
      const result = await duplicateInvoice(invoiceId);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Copied into a new draft");
      router.push(`/invoices/${result.invoiceId}/edit`);
    });
  }

  return (
    <Button variant="outline" onClick={run} disabled={pending}>
      {pending ? <Loader2 className="size-4 animate-spin" /> : <Copy className="size-4" />}
      Duplicate
    </Button>
  );
}

export function CreditNoteDialog({
  invoiceId,
  invoiceNumber,
  items,
}: {
  invoiceId: string;
  invoiceNumber: string;
  items: InvoiceItem[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [reason, setReason] = useState("");
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(items.map((i) => i.id)),
  );

  const creditTotal = round2(
    items
      .filter((i) => selected.has(i.id))
      .reduce((sum, i) => sum + Number(i.line_total), 0),
  );
  const allSelected = selected.size === items.length;

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function submit() {
    if (!reason.trim()) {
      toast.error("Give a reason for the credit note.");
      return;
    }
    if (selected.size === 0) {
      toast.error("Select at least one line to credit.");
      return;
    }

    startTransition(async () => {
      const result = await createCreditNote(
        invoiceId,
        reason,
        allSelected ? null : [...selected],
      );
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setOpen(false);
      toast.success(`Credit note ${result.number ?? ""} raised`);
      router.push(`/invoices/${result.invoiceId}`);
      router.refresh();
    });
  }

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <FileMinus className="size-4" />
        Credit note
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Credit note against {invoiceNumber}</DialogTitle>
            <DialogDescription>
              The invoice itself stays exactly as issued. This raises a separate
              numbered document that reduces what the customer owes.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">Lines to credit</p>
              <button
                type="button"
                className="text-xs font-medium text-primary hover:underline"
                onClick={() =>
                  setSelected(allSelected ? new Set() : new Set(items.map((i) => i.id)))
                }
              >
                {allSelected ? "Clear all" : "Select all"}
              </button>
            </div>

            <ul className="max-h-56 overflow-y-auto rounded-lg border border-border">
              {items.map((item) => (
                <li
                  key={item.id}
                  className="flex items-center gap-3 border-b border-border px-3 py-2.5 last:border-0"
                >
                  <Checkbox
                    id={`credit-${item.id}`}
                    checked={selected.has(item.id)}
                    onCheckedChange={() => toggle(item.id)}
                  />
                  <Label
                    htmlFor={`credit-${item.id}`}
                    className="min-w-0 flex-1 cursor-pointer font-normal"
                  >
                    <span className="block truncate">{item.description}</span>
                    <span className="block text-xs text-muted-foreground">
                      {formatMoney(item.qty)} {item.unit} ×{" "}
                      {formatMoney(item.unit_price)}
                    </span>
                  </Label>
                  <span className="shrink-0 tabular text-sm">
                    {formatMoney(item.line_total)}
                  </span>
                </li>
              ))}
            </ul>

            <div className="flex items-center justify-between rounded-lg bg-muted px-3 py-2.5">
              <span className="text-sm text-muted-foreground">Credit amount</span>
              <span className="tabular font-semibold">{formatTZS(creditTotal)}</span>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="cn_reason">Reason *</Label>
              <Textarea
                id="cn_reason"
                rows={3}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Goods returned, wrong price charged, agreed discount…"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={pending}>
              {pending && <Loader2 className="size-4 animate-spin" />}
              Raise credit note
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
