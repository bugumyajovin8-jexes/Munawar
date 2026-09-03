"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, Wallet } from "lucide-react";
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
import { DateInput } from "@/components/ui/date-input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatMoney, formatTZS, todayLocal } from "@/lib/format";
import { round2 } from "@/lib/money";
import { cn } from "@/lib/utils";
import {
  PAYMENT_METHOD_CHOICES,
  PAYMENT_METHOD_LABELS,
  type PaymentMethod,
} from "@/lib/types";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/**
 * What the method starts as, in both modes.
 *
 * Cash, because that is what a settled invoice overwhelmingly is when somebody
 * is standing in front of you — so the common case needs no interaction at all
 * and the picker is only touched when the answer is something else.
 */
const DEFAULT_METHOD: PaymentMethod = "cash";
import { newId, submit } from "@/lib/offline/outbox";
import { applyLocal, removeLocal } from "@/lib/offline/sync";
import { paymentRow } from "@/lib/offline/optimistic";

export function PaymentDialog({
  invoiceId,
  invoiceNumber,
  total,
  amountPaid,
  balance,
  open: controlledOpen,
  onOpenChange,
  initialMode = "full",
}: {
  invoiceId: string;
  invoiceNumber: string;
  total: number;
  amountPaid: number;
  balance: number;
  /** Drive the dialog from outside — e.g. the Full/Partial buttons on a row. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  initialMode?: "full" | "partial";
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : uncontrolledOpen;

  const setOpen = (next: boolean) => {
    if (isControlled) onOpenChange?.(next);
    else setUncontrolledOpen(next);
  };

  // When driven from outside, the caller mounts this fresh (keyed on mode), so
  // the initialisers below are what set the starting state — no effect needed.
  const [mode, setMode] = useState<"full" | "partial">(initialMode);
  const [amount, setAmount] = useState<number>(
    initialMode === "full" ? round2(balance) : 0,
  );
  const [paidOn, setPaidOn] = useState(todayLocal());
  const [method, setMethod] = useState<PaymentMethod>(DEFAULT_METHOD);
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");

  function reset() {
    setMode(initialMode);
    setAmount(initialMode === "full" ? round2(balance) : 0);
    setPaidOn(todayLocal());
    setMethod(DEFAULT_METHOD);
    setReference("");
    setNote("");
  }

  function choose(next: "full" | "partial") {
    setMode(next);
    if (next === "full") setAmount(round2(balance));
    else setAmount(0);
  }

  function onSubmit() {
    if (!Number.isFinite(amount) || amount <= 0) {
      return toast.error("Enter an amount greater than zero.");
    }

    // Through the outbox rather than straight to the server. Cash collected in
    // a shop with no signal is still cash collected; it must not depend on the
    // network to be recorded.
    const body = {
      invoiceId,
      amount: round2(amount),
      paidOn,
      method,
      reference: reference.trim() || null,
      note: note.trim() || null,
    };
    const id = newId();

    startTransition(async () => {
      /*
       * Into the mirror first. This is the change the user is actually looking
       * for: the balance on the invoice they are standing in front of must
       * come down the moment they press the button, with or without a signal.
       * Every screen reads the mirror, so recording it here updates the
       * invoice, the customer's balance and the dashboard at once.
       */
      await applyLocal("payments", [paymentRow(id, body)]);

      const result = await submit({
        kind: "payment.record",
        label: `Payment ${formatTZS(round2(amount))} · ${invoiceNumber}`,
        body,
      });
      if (!result.ok) {
        // The server looked at it and said no, so the optimistic row is a lie
        // and has to go. Leaving it would show money that was never taken.
        await removeLocal("payments", id);
        toast.error(result.error);
        return;
      }

      setOpen(false);
      reset();

      if (result.queued) {
        toast.success("Payment recorded", {
          description: `${invoiceNumber} — saved on this device, sends itself when you are back online.`,
        });
        // No refresh: the mirror already has it, and refetching offline would
        // only fail and bounce the browser through a full reload.
        return;
      }

      const remaining = round2(balance - amount);
      toast.success(
        remaining <= 0
          ? `${invoiceNumber} is fully paid`
          : `Payment recorded · ${formatTZS(remaining)} still owing`,
      );
      router.refresh();
    });
  }

  const remaining = round2(balance - (Number.isFinite(amount) ? amount : 0));

  /**
   * The one question full payment does ask.
   *
   * Everything else about a settled invoice is already known — the amount is
   * the balance and the date is today — but how the money arrived is not, and
   * it is the detail somebody comes back for when reconciling a bank statement
   * or answering "are you sure they paid?". Defined once and rendered in both
   * modes so the two cannot drift apart.
   */
  const methodField = (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor="method">How were you paid?</Label>
      <Select value={method} onValueChange={(v) => setMethod(v as PaymentMethod)}>
        <SelectTrigger id="method">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {PAYMENT_METHOD_CHOICES.map((value) => (
            <SelectItem key={value} value={value}>
              {PAYMENT_METHOD_LABELS[value]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );

  return (
    <>
      {/* Controlled usage always has its own trigger, so don't render a second. */}
      {!isControlled && (
        <Button
          onClick={() => {
            reset();
            setOpen(true);
          }}
        >
          <Wallet className="size-4" />
          Record payment
        </Button>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        {/*
          The body scrolls, the footer does not.

          "Record payment" used to sit below the fold on a phone, so the last
          step of the task was the one you had to go looking for. Capping the
          height and letting only the middle scroll keeps the button in view
          whatever is above it.
        */}
        <DialogContent className="flex max-h-[85dvh] flex-col sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Payment for {invoiceNumber}</DialogTitle>
            <DialogDescription>
              Payments always attach to one invoice, so you can always answer
              &ldquo;which one did they pay?&rdquo;
            </DialogDescription>
          </DialogHeader>

          <div className="-mx-1 flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-1">
            <dl className="grid grid-cols-3 gap-2 rounded-lg bg-muted px-3 py-2.5 text-sm">
              <div>
                <dt className="text-xs text-muted-foreground">Invoice total</dt>
                <dd className="tabular font-medium">{formatMoney(total)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Already paid</dt>
                <dd className="tabular font-medium">{formatMoney(amountPaid)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Balance</dt>
                <dd className="tabular font-semibold">{formatMoney(balance)}</dd>
              </div>
            </dl>

            <div className="grid grid-cols-2 gap-2">
              {(["full", "partial"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => choose(m)}
                  className={cn(
                    "rounded-lg border px-3 py-2.5 text-left text-sm transition-colors",
                    mode === m
                      ? "border-primary bg-primary/8 ring-1 ring-primary"
                      : "border-border hover:bg-accent",
                  )}
                >
                  <span className="block font-medium">
                    {m === "full" ? "Full payment" : "Partial payment"}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {m === "full" ? formatTZS(balance) : "Enter the amount"}
                  </span>
                </button>
              ))}
            </div>

            {/*
              Full payment asks nothing.

              The amount is the balance, the date is today and there is nothing
              to type — so putting a form in front of someone who has just said
              "they paid it all" is four fields of friction between them and
              the one thing they came to do. Partial is the only case where the
              app genuinely does not know the answer.
            */}
            {mode === "full" ? (
              <>
                <p className="flex items-start gap-2 rounded-md bg-success/10 px-3 py-2.5 text-sm text-success">
                  <Check className="mt-0.5 size-4 shrink-0" />
                  Recording {formatTZS(balance)} — this settles {invoiceNumber} in
                  full, dated today.
                </p>

                {methodField}
              </>
            ) : (
              <>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="amount">Amount received (TSh) *</Label>
                  <Input
                    id="amount"
                    type="number"
                    min={0}
                    step="0.01"
                    inputMode="decimal"
                    value={amount || ""}
                    onChange={(e) => {
                      setAmount(Number(e.target.value) || 0);
                      setMode("partial");
                    }}
                    className="tabular"
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="paid_on">Date received</Label>
                  <DateInput
                    id="paid_on"
                    value={paidOn}
                    onChange={(e) => setPaidOn(e.target.value)}
                  />
                </div>


                {methodField}

                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="reference">Reference</Label>
                  <Input
                    id="reference"
                    value={reference}
                    onChange={(e) => setReference(e.target.value)}
                    placeholder="Transaction ID, cheque no."
                  />
                </div>

                <div className="flex flex-col gap-1.5 sm:col-span-2">
                  <Label htmlFor="note">Note</Label>
                  <Textarea
                    id="note"
                    rows={2}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                  />
                </div>
              </div>

              {amount > 0 && (
                <p
                  className={cn(
                    "rounded-md px-3 py-2 text-sm",
                    remaining < 0
                      ? "bg-warning/15 text-warning-foreground dark:text-warning"
                      : remaining === 0
                        ? "bg-success/10 text-success"
                        : "bg-muted text-muted-foreground",
                  )}
                >
                  {remaining < 0
                    ? `Overpayment of ${formatTZS(Math.abs(remaining))} — recorded as a credit on this invoice.`
                    : remaining === 0
                      ? "This settles the invoice in full."
                      : `${formatTZS(remaining)} will still be owing.`}
                </p>
              )}
              </>
            )}
          </div>

          <DialogFooter className="shrink-0">
            <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button onClick={onSubmit} disabled={pending}>
              {pending && <Loader2 className="size-4 animate-spin" />}
              Record payment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
