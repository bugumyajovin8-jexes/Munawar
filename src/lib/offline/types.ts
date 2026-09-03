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
  | "branch.save"
  | "product.save"
  | "payment.record"
  | "invoice.draft"
  | "reminder.log"
  | "invoice.issue"
  | "customer.tin";

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
/** Keeping a TIN against a customer, captured while raising an invoice. */
export type CustomerTinOpBody = {
  customerId: string;
  tin: string | null;
};

export type IssueOpBody = {
  invoiceId: string;
  deviceId: string;
  number: number;
  /**
   * The day it was actually issued, carried rather than left to the server.
   *
   * Without this the server stamps its own clock at the moment the queue
   * drains — so an invoice raised in the field on Monday and synced on
   * Wednesday would be dated Wednesday, and its due date would slide with it.
   * Across a year boundary it is worse than untidy: the number's year is taken
   * from this date, so a 31 December invoice synced on 2 January would be
   * claimed against a year the device holds no block for, and be refused.
   */
  issuedOn: string;
  shipDate: string | null;
};

/** Forms are queued as plain key/value pairs and rebuilt into FormData server-side. */
export type FormOpBody = Record<string, string>;

export type OutboxBody =
  | { kind: "customer.save"; body: FormOpBody }
  | { kind: "branch.save"; body: FormOpBody }
  | { kind: "product.save"; body: FormOpBody }
  | { kind: "payment.record"; body: PaymentOpBody }
  | { kind: "invoice.draft"; body: DraftPayload }
  | { kind: "reminder.log"; body: ReminderOpBody }
  | { kind: "invoice.issue"; body: IssueOpBody }
  | { kind: "customer.tin"; body: CustomerTinOpBody };

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
  /**
   * The server looked at it and said no — a validation message, a permission
   * refusal, an invoice number that was never lent to this device. Retrying
   * unchanged fails identically, so this is shown to a person.
   */
  | { id: string; status: "rejected"; error: string }
  /**
   * The server never got the chance: a statement timeout, a dropped database
   * connection, a cold start that ran out of time.
   *
   * Nothing about the operation is wrong, so it stays in the queue and goes
   * again on the next tick. This used to be reported as a rejection, which
   * blocked cash taken in a shop behind a problem that had already fixed
   * itself and needed somebody to press retry.
   */
  | { id: string; status: "deferred"; error: string }
  /** Not attempted, because an earlier operation in the batch failed. */
  | { id: string; status: "skipped" };

export type SyncResponse = { results: SyncResult[] };

/** Applied and duplicate both mean "the server has it" — clear it from the queue. */
export function isSettled(result: SyncResult): boolean {
  return result.status === "applied" || result.status === "duplicate";
}
