/**
 * The shape of work queued on a device while it has no connection.
 *
 * Shared by the browser (which writes the queue) and /api/sync (which drains
 * it), so the two can never drift apart. Types only — no runtime imports, so
 * this file is safe on both sides of the client/server line.
 */
import type { DraftPayload } from "@/app/(app)/invoices/actions";

export type OutboxKind =
  | "customer.save"
  | "product.save"
  | "payment.record"
  | "invoice.draft"
  | "reminder.log"
  | "invoice.issue";

export type PaymentOpBody = {
  invoiceId: string;
  amount: number;
  paidOn: string;
  method: string;
  reference: string | null;
  note: string | null;
};

export type ReminderOpBody = {
  invoiceIds: string[];
  message: string;
  daysOverdue: number;
};

/**
 * An invoice issued with no signal, using a number this device was lent.
 *
 * The device id travels with it because the server verifies the number against
 * the range granted to that specific device — without it there would be
 * nothing to check the number against, and "the client picks the number" would
 * just be trusting the client.
 */
export type IssueOpBody = {
  invoiceId: string;
  deviceId: string;
  number: number;
  shipDate: string | null;
};

/** Forms are queued as plain key/value pairs and rebuilt into FormData server-side. */
export type FormOpBody = Record<string, string>;

export type OutboxBody =
  | { kind: "customer.save"; body: FormOpBody }
  | { kind: "product.save"; body: FormOpBody }
  | { kind: "payment.record"; body: PaymentOpBody }
  | { kind: "invoice.draft"; body: DraftPayload }
  | { kind: "reminder.log"; body: ReminderOpBody }
  | { kind: "invoice.issue"; body: IssueOpBody };

export type OutboxItem = OutboxBody & {
  /** Client-generated uuid. Doubles as the idempotency key in client_ops. */
  id: string;
  /**
   * Who queued it. A shared device can change hands during an outage, and
   * work must be applied under the session that created it, never under
   * whoever happens to be signed in when the signal returns.
   */
  userId: string;
  /** Human summary shown in the pending list — "Payment TSh 50,000 · INV-000123". */
  label: string;
  createdAt: number;
  attempts: number;
  lastError: string | null;
};

/** What /api/sync reports back for each operation it was handed. */
export type SyncResult =
  /**
   * `data` carries whatever the write produced — currently the id of a newly
   * saved draft, so a device that was online can open it immediately. It is
   * absent on a replay, since the original request already consumed it.
   */
  | { id: string; status: "applied"; data?: { invoiceId?: string } }
  /** Already in the ledger — a replay of something that landed the first time. */
  | { id: string; status: "duplicate" }
  /** Rejected by validation or the database. Retrying unchanged will not help. */
  | { id: string; status: "rejected"; error: string }
  /** Not attempted, because an earlier operation in the batch failed. */
  | { id: string; status: "skipped" };

export type SyncResponse = { results: SyncResult[] };

/** Applied and duplicate both mean "the server has it" — clear it from the queue. */
export function isSettled(result: SyncResult): boolean {
  return result.status === "applied" || result.status === "duplicate";
}
