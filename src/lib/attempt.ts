"use client";

import { toast } from "sonner";

/**
 * Run a server action and say something when the network takes it away.
 *
 * These are the writes that do not go through the outbox — issuing, voiding,
 * crediting, deleting a draft, adding a colleague. They are deliberately
 * online-only, because each one needs the database to arbitrate something the
 * device cannot: a number from the shared sequence, a permission, a row that
 * must not exist twice.
 *
 * What they were missing is what happens when the connection goes mid-request.
 * A server action rejects, and every one of these awaited it bare inside a
 * transition, so nothing caught it. The user pressed "Issue", the spinner
 * stopped, and they were told nothing at all — about an operation that may or
 * may not have spent an invoice number.
 *
 * That last part is why the message says "may not have been saved" rather than
 * "failed". The request was sent; whether it arrived is genuinely unknown from
 * here, and telling somebody their invoice was not issued when it might have
 * been is how you end up with two invoices for one delivery.
 */
export async function attempt<T>(
  /** What was being done, as a phrase: "issuing this invoice". */
  label: string,
  work: () => Promise<T>,
): Promise<T | null> {
  try {
    return await work();
  } catch {
    toast.error(`Lost the connection while ${label}`, {
      description: "It may not have been saved — check before trying again.",
    });
    return null;
  }
}
