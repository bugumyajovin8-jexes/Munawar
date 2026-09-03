/**
 * How big a block of invoice numbers this device should ask for, and when.
 *
 * Pure, with no browser or network access, so `npm run test:blocks` can run it
 * directly. That matters more here than almost anywhere else in the app: every
 * number handed out and not used is a permanent gap in the customer's books,
 * and a device that runs out mid-trip cannot issue at all. Both failures are
 * expensive and neither shows up until someone is standing in a shop.
 */

export type Block = {
  docType: string;
  year: number;
  start: number;
  end: number;
  /** The next number this device may use. Walks forward, never back. */
  next: number;
};

/** The server clamps to this range too; kept in step so sizing is honest. */
export const MIN_SIZE = 10;
export const MAX_SIZE = 500;

/** Refill while there is still room to work — running dry is the failure. */
export const REFILL_AT = 0.2;

/** What a device with no history assumes, until it has issued anything. */
export const COLD_START_SIZE = 25;

/** How much of a cushion to carry beyond the observed rate. */
const COVER_DAYS = 30;
const SAFETY = 2;

export function remaining(block: Block | null): number {
  if (!block) return 0;
  return Math.max(0, block.end - block.next + 1);
}

export function size(block: Block | null): number {
  if (!block) return 0;
  return block.end - block.start + 1;
}

/**
 * Does this device need more numbers?
 *
 * Deliberately generous, because the cost is asymmetric. Asking early while
 * there is a connection is nearly free — the unused tail of the *previous*
 * block is the only waste, and it is small. Asking late means discovering the
 * problem with no signal, which cannot be fixed at all.
 */
export function needsMore(block: Block | null, year: number): boolean {
  if (!block) return true;
  if (block.year !== year) return true;
  const total = size(block);
  if (total === 0) return true;
  return remaining(block) / total <= REFILL_AT;
}

/**
 * How many to ask for, from what this device has actually been doing.
 *
 * A shop issuing fifteen invoices a month should not be handed five hundred
 * numbers and leave a 485-number hole in the sequence; a busy depot issuing
 * forty a day should not be handed fifty and run dry by lunchtime. So the size
 * is a month of observed usage with a safety factor, clamped to what the
 * server will grant.
 *
 * `issuedPerDay` is measured over however long this device has been running,
 * so a brand-new device has nothing to go on and gets the cold-start size.
 */
export function nextSize(issuedPerDay: number | null): number {
  if (issuedPerDay === null || !Number.isFinite(issuedPerDay) || issuedPerDay <= 0) {
    return COLD_START_SIZE;
  }

  const wanted = Math.ceil(issuedPerDay * COVER_DAYS * SAFETY);
  return Math.min(MAX_SIZE, Math.max(MIN_SIZE, wanted));
}

/**
 * The rate this device issues at, in invoices per day.
 *
 * Returns null until there is enough history to mean anything — one invoice on
 * the first afternoon is not evidence of forty a day, and treating it as such
 * would ask for a block ten times too big.
 */
export function burnRate(issued: number, sinceMs: number, nowMs: number): number | null {
  const days = (nowMs - sinceMs) / 86_400_000;
  if (issued < 3 || days < 1) return null;
  return issued / days;
}

/**
 * Take the next number, if this device still has one to give.
 *
 * Returns null rather than inventing one. A device out of numbers must fall
 * back to saving a draft — the alternative is two customers eventually holding
 * the same invoice number, which is the thing the whole scheme exists to
 * prevent.
 */
export function take(block: Block | null, year: number): { number: number; block: Block } | null {
  if (!block || block.year !== year) return null;
  if (block.next > block.end) return null;
  return {
    number: block.next,
    block: { ...block, next: block.next + 1 },
  };
}

/**
 * How close to the year end a device should start carrying next year's block.
 *
 * Numbering restarts each January, so a block is only good for its own year.
 * A device that goes into the field in late December with one block comes back
 * unable to issue anything — not because it ran out, but because the calendar
 * moved. Asking for next year's range while there is still a connection costs
 * one request and removes that entirely.
 */
export const CARRY_NEXT_FROM_MONTH = 11; // December, zero-indexed

export function shouldCarryNextYear(now: Date): boolean {
  return now.getMonth() >= CARRY_NEXT_FROM_MONTH;
}

/** The block that can be spent today, out of everything this device holds. */
export function blockForYear(blocks: Block[], year: number): Block | null {
  return blocks.find((b) => b.year === year) ?? null;
}

/**
 * Drop blocks for years that have passed.
 *
 * Their unused numbers are already gaps and nothing can reclaim them, so
 * keeping the rows would only invite spending a number in the wrong year.
 */
export function pruneBlocks(blocks: Block[], year: number): Block[] {
  return blocks.filter((b) => b.year >= year);
}
