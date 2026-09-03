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
import {
  blockForYear,
  burnRate,
  needsMore,
  nextSize,
  pruneBlocks,
  shouldCarryNextYear,
  take,
  type Block,
} from "./block-plan";

/**
 * One tab at a time may touch this device's stock of numbers.
 *
 * Taking a number is read, modify, write across IndexedDB, and nothing about
 * that is atomic. Two tabs of the app open on one phone — which is ordinary,
 * not exotic — can both read `next`, both take it, and both hand a customer a
 * document numbered INV-2026-0043. The server refuses the second, so no two
 * invoices ever share a number in the ledger; what the user sees instead is an
 * invoice they have already printed failing to sync for no reason they can
 * act on.
 *
 * Web Locks is scoped to the origin and held across tabs, which is exactly the
 * boundary this needs. Where it does not exist, the fallback chain at least
 * serialises within a tab — better than nothing, and the server check is still
 * behind it either way.
 */
const NUMBER_LOCK = "munawar:numbers";
let localChain: Promise<unknown> = Promise.resolve();

async function exclusive<T>(work: () => Promise<T>): Promise<T> {
  if (typeof navigator !== "undefined" && navigator.locks?.request) {
    return navigator.locks.request(NUMBER_LOCK, work) as Promise<T>;
  }

  const run = localChain.then(work, work);
  // The chain must not break on a rejection, or every later caller inherits it.
  localChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

const DEVICE_KEY = "device:id";
/**
 * Every block this device holds — at most two, this year's and next year's.
 *
 * Plural because numbering restarts each January. A device that went into the
 * field in late December holding one block came back unable to issue anything,
 * not because it ran out but because the calendar moved.
 */
const BLOCKS_KEY = "numbers:blocks";
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

async function heldBlocks(): Promise<Block[]> {
  return (await getMeta<Block[]>(BLOCKS_KEY)) ?? [];
}

async function saveBlocks(blocks: Block[]): Promise<void> {
  await setMeta(BLOCKS_KEY, pruneBlocks(blocks, thisYear()));
}

export async function currentBlock(): Promise<Block | null> {
  return blockForYear(await heldBlocks(), thisYear());
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

  await ensureBlockFor(year, docType);

  // From December, next year's range is fetched too, so a device that spends
  // the New Year out of signal can carry straight on issuing.
  if (shouldCarryNextYear(new Date())) {
    await ensureBlockFor(year + 1, docType);
  }

  return currentBlock();
}

async function ensureBlockFor(year: number, docType: string): Promise<Block | null> {
  return exclusive(() => grantBlockFor(year, docType));
}

/** Runs under the numbers lock. See ensureBlockFor. */
async function grantBlockFor(year: number, docType: string): Promise<Block | null> {
  const blocks = await heldBlocks();
  const block = blockForYear(blocks, year);

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
     * A year's old block is dropped rather than merged with its replacement.
     *
     * Its unused tail becomes a permanent gap, which is a real cost and the
     * reason blocks are sized from observed usage rather than handed out in
     * round hundreds. Holding two ranges *for the same year* would avoid that
     * gap and buy a worse problem: numbers issued out of order from two
     * places, with no single "next" to reason about.
     *
     * Holding one range per year is a different matter and is fine — only one
     * year is ever spendable, so there is still exactly one "next".
     */
    const fresh: Block = {
      docType: granted.docType,
      year: granted.year,
      start: granted.start,
      end: granted.end,
      next: granted.start,
    };

    // Replaces any block held for that same year, keeps the other year's.
    await saveBlocks([...blocks.filter((b) => b.year !== fresh.year), fresh]);
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
  return exclusive(async () => {
    const year = thisYear();
    const blocks = await heldBlocks();
    const taken = take(blockForYear(blocks, year), year);
    if (!taken) return null;

    await saveBlocks([...blocks.filter((b) => b.year !== year), taken.block]);

    // Recorded before the invoice is even built, so a device that crashes
    // mid-issue never re-uses the number it had already committed to.
    const issued = (await getMeta<number>(ISSUED_KEY)) ?? 0;
    await setMeta(ISSUED_KEY, issued + 1);

    return { number: taken.number, year };
  });
}

/** Put a number back, but only the one just taken and only if unused. */
export async function returnNumber(number: number): Promise<void> {
  await exclusive(async () => {
    const year = thisYear();
    const blocks = await heldBlocks();
    const block = blockForYear(blocks, year);
    if (!block || block.next !== number + 1) return;

    await saveBlocks([
      ...blocks.filter((b) => b.year !== year),
      { ...block, next: number },
    ]);

    const issued = (await getMeta<number>(ISSUED_KEY)) ?? 1;
    await setMeta(ISSUED_KEY, Math.max(0, issued - 1));
  });
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
