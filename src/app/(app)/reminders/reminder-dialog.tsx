"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ExternalLink, Loader2, MessageCircle } from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";
import { displayPhone } from "@/lib/phone";
import {
  buildReminderMessage,
  reminderProvider,
  type InvoiceRef,
  type ReminderKind,
  type ReminderLanguage,
} from "@/lib/whatsapp";
import { submit } from "@/lib/offline/outbox";

export function ReminderButton({
  kind,
  customerName,
  customerPhone,
  orgName,
  language,
  invoices,
  invoiceIds,
  label,
  variant = "default",
  size = "sm",
}: {
  kind: ReminderKind;
  customerName: string;
  customerPhone: string | null;
  orgName: string;
  language: ReminderLanguage;
  invoices: InvoiceRef[];
  invoiceIds: string[];
  label: string;
  variant?: "default" | "outline" | "ghost";
  size?: "sm" | "default";
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState("");

  const hasPhone = Boolean(customerPhone);

  function openDialog() {
    setMessage(
      buildReminderMessage(kind, { customerName, orgName, language, invoices }),
    );
    setOpen(true);
  }

  function send() {
    const prepared = reminderProvider.prepare(customerPhone, message);
    if (!prepared) {
      toast.error("This customer has no valid WhatsApp number.");
      return;
    }

    // Open WhatsApp first — browsers only honour window.open inside the click
    // gesture, so awaiting the log call first would get it blocked.
    window.open(prepared.url, "_blank", "noopener,noreferrer");

    startTransition(async () => {
      const maxDays = invoices.reduce((m, i) => Math.max(m, i.daysOverdue), 0);
      const result = await submit({
        kind: "reminder.log",
        label: `Reminder logged · ${customerName}`,
        body: { invoiceIds, message, daysOverdue: maxDays },
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setOpen(false);
      toast.success(result.queued ? "Reminder saved on this device" : "Reminder logged", {
        description: result.queued
          ? "The chase history updates when you are back online."
          : "Press send in WhatsApp to deliver it.",
      });
      if (!result.queued) router.refresh();
    });
  }

  return (
    <>
      <Button
        variant={hasPhone ? variant : "outline"}
        size={size}
        onClick={openDialog}
        disabled={!hasPhone}
        title={hasPhone ? undefined : "Add a phone number to this customer first"}
      >
        <MessageCircle className="size-4" />
        {hasPhone ? label : "No phone"}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Remind {customerName}</DialogTitle>
            <DialogDescription>
              Edit the message if you want, then open WhatsApp and press send.
              {customerPhone && (
                <span className="mt-1 block font-medium text-foreground">
                  {displayPhone(customerPhone)}
                </span>
              )}
            </DialogDescription>
          </DialogHeader>

          <Textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={12}
            className="font-mono text-xs leading-relaxed"
            aria-label="Reminder message"
          />

          <p className="text-xs text-muted-foreground">
            Click-to-chat cannot confirm delivery. This is logged as sent the
            moment WhatsApp opens with the message prepared.
          </p>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button onClick={send} disabled={pending || !message.trim()}>
              {pending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <ExternalLink className="size-4" />
              )}
              Open WhatsApp
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
