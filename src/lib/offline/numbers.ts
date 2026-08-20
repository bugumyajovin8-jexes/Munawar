"use client";

/**
 * This device's stock of invoice numbers.
 *
 * Numbers come from a database row lock so they are unique and gap-free, which
 * is exactly why a phone cannot invent one. Instead the server *lends* this
 * device a range in advance, and every number that later reaches the server is
 * checked against the range it actually granted (claim_block_number in 0007).
 * A client that makes one up is refused and the invoice stays a draft.
 *
 * Note what none of this needs: any idea of how many devices exist. The server
 * hands out the next range on demand, so a second phone simply gets the next
 * one and a phone bought tomorrow needs no planning today.
 */
import { getMeta, setMeta } from "./db";
import { newId } from "./outbox";
import { getOnline } from "./online";
import { burnRate, needsMore, nextSize, take, type Block } from "./block-plan";

const DEVICE_KEY = "device:id";
const BLOCK_KEY = "numbers:block";
const ISSUED_KEY = "numbers:issued";
const SINCE_KEY = "numbers:since";

/**
 * A stable id for this device, generated here and never by the server.
 *
 * It has to exist before the device can ask for anything, and it has to
 * survive being offline from the very first run, so there is no moment at
 * which the server could have supplied it.
 */
export async function deviceId(): Promise<string> {
  const existing = await getMeta<string>(DEVICE_KEY);
  if (existing) return existing;

  const id = newId();
  await setMeta(DEVICE_KEY, id);
  await setMeta(SINCE_KEY, Date.now());
  return id;
}

export async function currentBlock(): Promise<Block | null> {
  return getMeta<Block>(BLOCK_KEY);
}

/** Invoice numbering restarts each year, so blocks are per year too. */
function thisYear(): number {
  return new Date().getFullYear();
}

/**
 * Ask the server for more numbers, if this device is running low and there is
 * a connection to ask over.
 *
 * Safe to call often — it does nothing when the current block is healthy, and
 * nothing at all when offline.
 */
export async function topUp(docType = "invoice"): Promise<Block | null> {
  const year = thisYear();
  const block = await currentBlock();

  if (!needsMore(block, year)) return block;
  if (!getOnline()) return block;

  const [issued, since] = await Promise.all([
    getMeta<number>(ISSUED_KEY),
    getMeta<number>(SINCE_KEY),
  ]);

  const rate = burnRate(issued ?? 0, since ?? Date.now(), Date.now());

  try {
    const response = await fetch("/api/number-block", {
      method: "POST",
      headers: { "content-type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({
        deviceId: await deviceId(),
        docType,
        year,
        size: nextSize(rate),
      }),
    });

    if (!response.ok) return block;

    const granted = (await response.json()) as {
      start: number;
      end: number;
      year: number;
      docType: string;
    };

    /*
     * The old block is dropped, not merged.
     *
     * Its unused tail becomes a gap in the sequence, which is a real cost and
     * the reason blocks are sized from observed usage rather than handed out
     * in round hundreds. Carrying two ranges at once would avoid that gap and
     * buy a much worse problem: numbers issued out of order, from two places,
     * with no single "next" to reason about.
     */
    const fresh: Block = {
      docType: granted.docType,
      year: granted.year,
      start: granted.start,
      end: granted.end,
      next: granted.start,
    };

    await setMeta(BLOCK_KEY, fresh);
    return fresh;
  } catch {
    // No connection. The existing block, however small, is what there is.
    return block;
  }
}

/**
 * Take the next number for an invoice being issued right now.
 *
 * Returns null when this device has none left, and the caller must then save a
 * draft instead. Inventing one would eventually hand two customers the same
 * invoice number, which is the single thing this whole arrangement exists to
 * prevent.
 */
export async function takeNumber(): Promise<{ number: number; year: number } | null> {
  const year = thisYear();
  const taken = take(await currentBlock(), year);
  if (!taken) return null;

  await setMeta(BLOCK_KEY, taken.block);

  // Recorded before the invoice is even built, so a device that crashes
  // mid-issue never re-uses the number it had already committed to.
  const issued = (await getMeta<number>(ISSUED_KEY)) ?? 0;
  await setMeta(ISSUED_KEY, issued + 1);

  return { number: taken.number, year };
}

/** Put a number back, but only the one just taken and only if unused. */
export async function returnNumber(number: number): Promise<void> {
  const block = await currentBlock();
  if (!block || block.next !== number + 1) return;
  await setMeta(BLOCK_KEY, { ...block, next: number });

  const issued = (await getMeta<number>(ISSUED_KEY)) ?? 1;
  await setMeta(ISSUED_KEY, Math.max(0, issued - 1));
}

/** For the sync panel: can this device issue an invoice with no signal? */
export async function blockStatus(): Promise<{
  held: number;
  canIssueOffline: boolean;
}> {
  const block = await currentBlock();
  const year = thisYear();
  const held =
    block && block.year === year ? Math.max(0, block.end - block.next + 1) : 0;
  return { held, canIssueOffline: held > 0 };
}
