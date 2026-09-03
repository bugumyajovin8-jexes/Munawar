"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { attempt } from "@/lib/attempt";
import { useDialogState } from "@/lib/use-dialog";
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
import { formatTZS } from "@/lib/format";
import { useAll, useRelated } from "@/lib/offline/local";
import { removeLocal } from "@/lib/offline/sync";
import { round2, type MirrorPayment } from "@/lib/offline/derive";
import { deleteInvoice } from "../actions";
import type { Invoice } from "@/lib/types";

/**
 * Deleting a document outright — draft, issued or void.
 *
 * One button for all three, because "can I delete this?" should have one
 * answer and one place to look for it. What it asks for scales with what is
 * actually at stake: a draft gets a confirmation, an issued invoice gets the
 * full account of what goes with it, a reason, and the reference typed out.
 *
 * Separate from Void and deliberately harder to reach. Void is the ordinary
 * cancellation: the invoice stays, marked void with a reason, keeping its
 * number and its place in the sequence, which is what lets an auditor see that
 * document 0043 existed and was cancelled. This destroys the document, and a
 * gap between 0042 and 0044 invites exactly the question a void answers.
 *
 * So the dialog is built around telling somebody what they are about to lose,
 * because the honest answer is more than "this invoice": payments recorded
 * against it go with it, every past figure that counted it changes, and the
 * number is never reissued.
 *
 * The consequences are counted from this device's own mirror rather than
 * fetched, which makes the warning specific — "2 payments totalling
 * TSh 450,000" rather than "any related records" — and keeps it specific with
 * no signal. That count is also what decides how much the dialog asks for:
 * see hasPayments.
 */
export function DeleteInvoiceButton({
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
  const [confirmation, setConfirmation] = useState("");
  const [pending, startTransition] = useTransition();

  const reference = invoice.number ?? invoice.draft_ref;

  const isDraft = invoice.status === "draft";
  const payments = useRelated<MirrorPayment & { id: string }>(
    "payments",
    "invoice_id",
    invoice.id,
  );
  const items = useRelated<{ id: string }>("invoiceItems", "invoice_id", invoice.id);
  const allInvoices = useAll<Invoice>("invoices");

  const received = round2(payments.reduce((sum, p) => sum + Number(p.amount ?? 0), 0));

  /*
   * How much this asks for follows the money, not the status word.
   *
   * A draft has no number, can hold no payment — record_payment refuses one
   * against a draft — and is in nobody's statement or ageing. An issued
   * invoice nobody has paid costs a number and shifts some figures; that is
   * worth stating, and not worth a paragraph about. Both are one click.
   *
   * A paid one is different in kind rather than degree: deleting it erases the
   * record that the customer handed money over. That earns the reference typed
   * out and a reason for the archive — and it only earns them because the
   * other two cases no longer ask. Friction that fires every time stops being
   * read, and then it is not there for the case it was built for.
   */
  const hasPayments = payments.length > 0;

  /*
   * A credit note pointing at this invoice blocks deletion in the database —
   * the reference is ON DELETE RESTRICT. Saying so up front means finding out
   * before typing a reason and a reference rather than after.
   */
  const creditNote = allInvoices.find((i) => i.parent_invoice_id === invoice.id);

  // Typing the reference is the safeguard against deleting the invoice you
  // happen to have open rather than the one you meant.
  const confirmed =
    !hasPayments || confirmation.trim().toUpperCase() === reference.toUpperCase();

  function onDelete() {
    if (hasPayments && !reason.trim()) return toast.error("Give a reason for deleting.");
    if (!confirmed) return toast.error(`Type ${reference} to confirm.`);

    startTransition(async () => {
      const result = await attempt(
        isDraft ? "deleting this draft" : "deleting this invoice",
        () => deleteInvoice(invoice.id, reason.trim()),
      );
      if (!result) return;
      if (!result.ok) {
        toast.error(result.error);
        return;
      }

      /*
       * Leave first, then forget — and the order is not cosmetic.
       *
       * This screen reads the invoice out of the mirror, so dropping the row
       * while still standing on it renders the one thing this page has to say
       * when an invoice is missing: "That invoice is not on this device." The
       * user has just deleted it deliberately and is told, in effect, that
       * something has gone wrong. Starting the navigation first means the row
       * disappears from a screen nobody is looking at any more.
       *
       * replace, not push. The address of a document that no longer exists has
       * no business in the back stack — pressing Back would land on that same
       * dead end, which is exactly how somebody ends up stuck on it.
       */
      router.replace("/invoices");

      /*
       * Off this device now, rather than waiting for the tombstone on the next
       * pull. Every screen reads the mirror, so without this the list it
       * returns to still shows the invoice it has just deleted.
       */
      await removeLocal(
        "invoiceItems",
        items.map((i) => i.id),
      );
      await removeLocal(
        "payments",
        payments.map((p) => p.id),
      );
      await removeLocal("invoices", invoice.id);

      toast.success(isDraft ? "Draft deleted" : `${reference} deleted`, {
        description: isDraft
          ? undefined
          : "Archived in the audit log. The number stays used.",
      });
    });
  }

  return (
    <>
      {showTrigger && (
        <Button variant="ghost" className="text-destructive" onClick={() => setOpen(true)}>
          <Trash2 className="size-4" />
          Delete
        </Button>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {isDraft ? "Delete this draft?" : `Delete ${reference}?`}
            </DialogTitle>
            <DialogDescription>
              {isDraft
                ? "It was never issued, so it has no number and appears in none of your figures. This cannot be undone."
                : hasPayments
                  ? "Voiding is usually what you want: it cancels the invoice and keeps the paperwork. This removes the document itself."
                  : "Nothing has been paid against it. Voiding would cancel it and keep the paperwork; this removes the document itself."}
            </DialogDescription>
          </DialogHeader>

          {creditNote ? (
            <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm">
              <p className="font-medium text-destructive">This one cannot be deleted</p>
              <p className="mt-1 text-muted-foreground">
                Credit note {creditNote.number ?? creditNote.draft_ref} was raised
                against it, and would be left describing a document that no longer
                exists. Delete the credit note first, or void this invoice instead.
              </p>
            </div>
          ) : isDraft ? null : !hasPayments ? (
            /*
              Unpaid: worth telling, not worth interrogating.

              The gap in the numbering is the one consequence somebody could
              be surprised by later, so it is stated — but there is nothing
              here to type and nothing to justify, because nothing is being
              unsaid about money.
            */
            <div className="rounded-lg border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
              {invoice.number ? (
                <>
                  <span className="font-medium text-foreground">
                    {invoice.number} is never reused
                  </span>{" "}
                  — it stays a gap in your numbering, and any figures that counted
                  it change to match.
                </>
              ) : (
                <>Any figures that counted it change to match.</>
              )}{" "}
              The whole document is completely deleted.
            </div>
          ) : (
            <>
              <div className="rounded-lg border border-border bg-muted/40 p-3">
                <p className="text-sm font-medium">What goes with it</p>
                <ul className="mt-2 flex flex-col gap-1.5 text-sm text-muted-foreground">
                  <li>
                    <span className="font-medium text-foreground">
                      {items.length} {items.length === 1 ? "line" : "lines"}
                    </span>{" "}
                    on the invoice
                  </li>

                  {/* Always present in this branch — it is what defines it. */}
                  <li className="text-destructive">
                    <span className="font-medium">
                      {payments.length}{" "}
                      {payments.length === 1 ? "payment" : "payments"} totalling{" "}
                      {formatTZS(received)}
                    </span>{" "}
                    — the record that this money was received is destroyed with it
                  </li>

                  <li>
                    Any reminders sent about it, and the shared link the customer may
                    already have
                  </li>
                  <li>
                    Every past figure that counted it — statements, ageing, monthly
                    sales, gross profit — changes to match
                  </li>

                  {invoice.number && (
                    <li>
                      <span className="font-medium text-foreground">
                        {invoice.number} is never reused
                      </span>{" "}
                      — it stays a gap in your numbering
                    </li>
                  )}
                </ul>

                <p className="mt-2.5 border-t border-border pt-2.5 text-xs text-muted-foreground">
                  The whole document is archived to the audit log first, so it can
                  still be read back — but it leaves your books.
                </p>
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="delete_reason">Reason *</Label>
                <Textarea
                  id="delete_reason"
                  rows={2}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Raised in error, duplicate of another invoice…"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="delete_confirm">
                  Type <span className="font-mono">{reference}</span> to confirm
                </Label>
                <Input
                  id="delete_confirm"
                  value={confirmation}
                  onChange={(e) => setConfirmation(e.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                />
              </div>
            </>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              {isDraft ? "Keep it" : "Cancel"}
            </Button>
            {!creditNote && (
              <Button
                variant="destructive"
                onClick={onDelete}
                disabled={pending || !confirmed || (hasPayments && !reason.trim())}
              >
                {pending && <Loader2 className="size-4 animate-spin" />}
                {isDraft ? "Delete draft" : hasPayments ? "Delete permanently" : "Delete"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
