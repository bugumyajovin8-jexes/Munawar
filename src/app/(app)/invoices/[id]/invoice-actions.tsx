"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Ban, Loader2, Pencil, Printer, Send, Trash2, Truck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { addDays, formatDate, todayLocal } from "@/lib/format";
import { deleteDraft, issueInvoice, voidInvoice } from "../actions";
import type { Invoice } from "@/lib/types";

export function DraftActions({ invoice }: { invoice: Invoice }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [shipOpen, setShipOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [shipDate, setShipDate] = useState(todayLocal());
  const [shipped, setShipped] = useState(true);

  function onIssue() {
    startTransition(async () => {
      const result = await issueInvoice(invoice.id, shipped ? shipDate : null);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setShipOpen(false);
      toast.success(`Issued as ${result.number}`);
      router.replace(`/invoices/${invoice.id}?issued=1`);
      router.refresh();
    });
  }

  function onDelete() {
    startTransition(async () => {
      const result = await deleteDraft(invoice.id);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Draft deleted");
      router.push("/invoices");
    });
  }

  const effectiveDate = shipped ? shipDate : todayLocal();

  return (
    <>
      <Button variant="outline" asChild>
        <Link href={`/invoices/${invoice.id}/edit`}>
          <Pencil className="size-4" />
          Edit
        </Link>
      </Button>

      <Button variant="outline" onClick={() => setDeleteOpen(true)}>
        <Trash2 className="size-4" />
        Delete
      </Button>

      <Button onClick={() => setShipOpen(true)}>
        <Truck className="size-4" />
        Ship &amp; issue
      </Button>

      <Dialog open={shipOpen} onOpenChange={setShipOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Issue this invoice</DialogTitle>
            <DialogDescription>
              The invoice number, invoice date and due date are all stamped now.
              After this the document is locked.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4">
            <label className="flex items-start gap-3 rounded-lg border border-border p-3">
              <input
                type="checkbox"
                checked={shipped}
                onChange={(e) => setShipped(e.target.checked)}
                className="mt-0.5 size-4 accent-[var(--primary)]"
              />
              <span className="text-sm">
                <span className="font-medium">Goods have shipped</span>
                <span className="block text-xs text-muted-foreground">
                  Dates the invoice on the shipping day rather than today
                </span>
              </span>
            </label>

            {shipped && (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="ship_date">Ship date</Label>
                <Input
                  id="ship_date"
                  type="date"
                  value={shipDate}
                  onChange={(e) => setShipDate(e.target.value)}
                />
              </div>
            )}

            <div className="rounded-lg bg-muted px-3 py-2.5 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Ordered</span>
                <span className="tabular">{formatDate(invoice.order_date)}</span>
              </div>
              <div className="mt-1 flex justify-between">
                <span className="text-muted-foreground">Invoice date</span>
                <span className="tabular font-medium">{formatDate(effectiveDate)}</span>
              </div>
              <div className="mt-1 flex justify-between">
                <span className="text-muted-foreground">
                  Due ({invoice.terms_days} days)
                </span>
                <span className="tabular font-medium">
                  {formatDate(addDays(effectiveDate, invoice.terms_days))}
                </span>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShipOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button onClick={onIssue} disabled={pending}>
              {pending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Send className="size-4" />
              )}
              Issue invoice
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete this draft?</DialogTitle>
            <DialogDescription>
              It has no invoice number yet, so nothing is lost from your
              numbering. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)} disabled={pending}>
              Keep it
            </Button>
            <Button variant="destructive" onClick={onDelete} disabled={pending}>
              {pending && <Loader2 className="size-4 animate-spin" />}
              Delete draft
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function PrintButton({ invoiceId }: { invoiceId: string }) {
  return (
    <Button variant="outline" asChild>
      <Link href={`/invoices/${invoiceId}/print`} target="_blank">
        <Printer className="size-4" />
        Print / PDF
      </Link>
    </Button>
  );
}

export function VoidButton({ invoice }: { invoice: Invoice }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [pending, startTransition] = useTransition();

  function onVoid() {
    if (!reason.trim()) return toast.error("Give a reason for voiding.");
    startTransition(async () => {
      const result = await voidInvoice(invoice.id, reason.trim());
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setOpen(false);
      toast.success(`${invoice.number} voided`);
      router.refresh();
    });
  }

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <Ban className="size-4" />
        Void
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Void {invoice.number}?</DialogTitle>
            <DialogDescription>
              The number stays used, so your sequence keeps no gaps. If money has
              already been received against it, raise a credit note instead.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="void_reason">Reason *</Label>
            <Textarea
              id="void_reason"
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Wrong customer, duplicate, order cancelled…"
            />
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={onVoid} disabled={pending}>
              {pending && <Loader2 className="size-4 animate-spin" />}
              Void invoice
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
