"use client";

import { useState } from "react";
import { Check, Copy, Link2, MessageCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { buildShareMessage, reminderProvider } from "@/lib/whatsapp";
import type { ReminderLanguage } from "@/lib/whatsapp";

/**
 * Sends a link, not a PDF attachment. The customer opens it on their phone,
 * sees the live balance, and downloads the PDF themselves if they want one.
 */
export function ShareInvoice({
  url,
  invoiceNumber,
  customerName,
  customerPhone,
  orgName,
  language,
  total,
  dueDate,
}: {
  url: string;
  invoiceNumber: string;
  customerName: string;
  customerPhone: string | null;
  orgName: string;
  language: ReminderLanguage;
  total: number;
  dueDate: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const message = buildShareMessage({
    customerName,
    orgName,
    language,
    invoiceNumber,
    total,
    dueDate,
    url,
  });

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast.success("Link copied");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Could not copy — select the link and copy it manually.");
    }
  }

  function sendWhatsApp() {
    const prepared = reminderProvider.prepare(customerPhone, message);
    if (!prepared) {
      toast.error("This customer has no valid WhatsApp number.");
      return;
    }
    window.open(prepared.url, "_blank", "noopener,noreferrer");
    setOpen(false);
  }

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <Link2 className="size-4" />
        Share
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Share {invoiceNumber}</DialogTitle>
            <DialogDescription>
              Anyone with this link can view the invoice and its payment status.
              It is not listed anywhere and search engines are told to ignore it.
            </DialogDescription>
          </DialogHeader>

          <div className="flex gap-2">
            <Input readOnly value={url} className="font-mono text-xs" onFocus={(e) => e.target.select()} />
            <Button variant="outline" size="icon" onClick={copy} aria-label="Copy link">
              {copied ? <Check className="size-4 text-success" /> : <Copy className="size-4" />}
            </Button>
          </div>

          <div className="rounded-lg bg-muted p-3">
            <p className="mb-1.5 text-xs font-medium text-muted-foreground">
              WhatsApp message
            </p>
            <pre className="whitespace-pre-wrap font-mono text-xs leading-relaxed text-foreground">
              {message}
            </pre>
          </div>

          <Button onClick={sendWhatsApp} disabled={!customerPhone}>
            <MessageCircle className="size-4" />
            {customerPhone ? "Open WhatsApp" : "No phone number on file"}
          </Button>
        </DialogContent>
      </Dialog>
    </>
  );
}
