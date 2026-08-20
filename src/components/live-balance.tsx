"use client";

import { StatTile } from "@/components/stat-tile";
import { formatTZS, formatDate } from "@/lib/format";
import { round2 } from "@/lib/money";
import { useRelated } from "@/lib/offline/local";

type MirrorPayment = { id: string; amount: number | string; _pending?: boolean };

/**
 * The money on an invoice, counted from this device rather than the server.
 *
 * This is the screen the original complaint was about. A payment taken in a
 * shop with no signal was safe in the queue and completely invisible here —
 * the tiles came from a server render, so the invoice went on insisting it was
 * unpaid while the cash was in the till. An app that takes your input and
 * shows no sign of it is one you stop trusting.
 *
 * Payments are summed from the mirror, which holds both what the server has
 * confirmed and what this device has recorded but not yet sent. The two cannot
 * be double-counted: an optimistic row carries the same id the server will
 * eventually store it under, so when it comes back in a pull it replaces the
 * local copy rather than joining it.
 *
 * The server's own figures are still passed in, and still used until the
 * mirror has been filled — a first-ever load has nothing local to count.
 */
export function LiveBalance({
  invoiceId,
  total,
  serverPaid,
  isOverdue,
  daysOverdue,
  dueDate,
  mirrorReady,
}: {
  invoiceId: string;
  total: number;
  serverPaid: number;
  isOverdue: boolean;
  daysOverdue: number;
  dueDate: string | null;
  /** False before the first sync, when the mirror cannot be trusted as empty. */
  mirrorReady: boolean;
}) {
  const payments = useRelated<MirrorPayment>("payments", "invoice_id", invoiceId);

  const localPaid = round2(
    payments.reduce((sum, payment) => sum + Number(payment.amount ?? 0), 0),
  );

  // No payments in the mirror is ambiguous before the first sync: it could mean
  // "none taken" or "not downloaded yet". The server's number is the safer read
  // until there is something local to believe.
  const paid = mirrorReady || payments.length > 0 ? localPaid : serverPaid;
  const balance = round2(total - paid);

  const unsent = payments.some((payment) => payment._pending);

  return (
    <>
      <StatTile label="Invoice total" value={formatTZS(total)} />
      <StatTile
        label="Paid"
        value={formatTZS(paid)}
        tone={paid > 0 ? "success" : "default"}
        hint={unsent ? "Includes a payment not yet sent" : undefined}
      />
      <StatTile
        label="Balance"
        value={formatTZS(balance)}
        tone={balance > 0 && isOverdue ? "destructive" : "default"}
        hint={
          balance <= 0
            ? "Settled"
            : isOverdue
              ? `${daysOverdue} days past due`
              : dueDate
                ? `Due ${formatDate(dueDate)}`
                : undefined
        }
      />
    </>
  );
}
