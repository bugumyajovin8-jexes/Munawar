"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Ban, Loader2, Pencil, Printer, Send, Truck } from "lucide-react";
import { toast } from "sonner";
import { attempt } from "@/lib/attempt";
import { useDialogState } from "@/lib/use-dialog";
import { Button } from "@/components/ui/button";
import { ReasonPresets } from "@/components/reason-presets";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DateInput } from "@/components/ui/date-input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { addDays, formatDate, todayLocal } from "@/lib/format";
import { applyLocal } from "@/lib/offline/sync";
import type { Row } from "@/lib/offline/db";
import { issueInvoice, voidInvoice } from "../actions";
import type { Invoice } from "@/lib/types";

export function DraftActions({ invoice }: { invoice: Invoice }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [shipOpen, setShipOpen] = useState(false);
  const [shipDate, setShipDate] = useState(todayLocal());
  const [shipped, setShipped] = useState(true);

  function onIssue() {
    startTransition(async () => {
      const result = await attempt("issuing this invoice", () =>
        issueInvoice(invoice.id, shipped ? shipDate : null),
      );
      // Genuinely unknown whether the number was spent, so nothing here
      // pretends otherwise — attempt() says so and this stops.
      if (!result) return;
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      /*
       * The server's own row, straight into the mirror.
       *
       * This screen reads the mirror, not the server, so router.refresh() does
       * nothing for it — the shell it re-renders holds no figures. Without
       * this the invoice was issued, the toast named its new number, and the
       * screen went on showing an undated draft until the next scheduled pull
       * came round, up to ninety seconds later. issue_invoice() already
       * returns the whole updated row, so this costs nothing.
       */
      if (result.row) await applyLocal("invoices", [result.row as Row]);

      setShipOpen(false);
      toast.success(`Issued as ${result.number}`);
      router.replace(`/invoices/${invoice.id}?issued=1`);
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
                <DateInput
                  id="ship_date"
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

    </>
  );
}

export function PrintButton({ invoiceId }: { invoiceId: string }) {
  return (
    <Button variant="outline" asChild>
      {/*
        `auto=1` opens the print dialog as soon as the document has laid out,
        so this is one click rather than two. PrintControls has supported it
        all along — nothing linking here ever asked for it, so every print
        went through a page whose only purpose was to hold another button.

        The page still has that button, and it still matters: the dialog can
        be dismissed, and a browser that blocks the automatic call leaves the
        manual one as the way through.
      */}
      <Link href={`/invoices/${invoiceId}/print?auto=1`} target="_blank">
        <Printer className="size-4" />
        Print / PDF
      </Link>
    </Button>
  );
}

/**
 * What actually happens, in the order it happens.
 *
 * Cancelling and changing an order are far and away the common two — a
 * customer says no, or says "not those, the other ones" — so they lead. The
 * rest are the mistakes: the wrong customer picked from a list, prices that
 * were wrong, the same invoice raised twice.
 *
 * Deliberately short. A list long enough to need reading is a list nobody
 * reads, and the box underneath is still there for anything else.
 */
const VOID_REASONS = [
  "Customer cancelled the order",
  "Customer changed the order",
  "Wrong customer",
  "Wrong amount or prices",
  "Duplicate invoice",
] as const;

export function VoidButton({
  invoice,
  open: controlledOpen,
  onOpenChange,
}: {
  invoice: Invoice;
  /** Pass these to drive it from a menu; see useDialogState. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const router = useRouter();
  const { open, setOpen, showTrigger } = useDialogState(controlledOpen, onOpenChange);
  const [reason, setReason] = useState("");
  const [pending, startTransition] = useTransition();

  function onVoid() {
    if (!reason.trim()) return toast.error("Give a reason for voiding.");
    startTransition(async () => {
      const result = await attempt("voiding this invoice", () =>
        voidInvoice(invoice.id, reason.trim()),
      );
      if (!result) return;
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
      {showTrigger && (
        <Button variant="outline" onClick={() => setOpen(true)}>
          <Ban className="size-4" />
          Void
        </Button>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Void {invoice.number}?</DialogTitle>
            <DialogDescription>
              The number stays used, so your sequence keeps no gaps. If money has
              already been received against it, raise a credit note instead.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-2">
            <Label htmlFor="void_reason">Reason *</Label>

            {/* Tap one, or write your own underneath. */}
            <ReasonPresets
              presets={VOID_REASONS}
              value={reason}
              onSelect={setReason}
            />

            <Textarea
              id="void_reason"
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Or describe what happened…"
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
