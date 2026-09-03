/**
 * The decisions a pull makes, with no I/O of any kind.
 *
 * Split out so they can be tested. Everything here is the sort of logic that
 * fails silently — a cursor that advances too far skips records and nothing
 * ever reports it, a cursor that fails to advance re-fetches the same page
 * forever. Both look exactly like a working sync from the outside, which is
 * how the last three offline bugs survived so long.
 *
 * No browser imports, deliberately: this file has to run in a plain Node
 * process so `npm run test:sync` can exercise it directly, and /api/pull
 * imports it too so the two sides cannot drift.
 */

/**
 * One table's position in the feed.
 *
 * Per table, and that is the whole point. There used to be a single cursor
 * for the entire pull, taken as the newest row across every table in the
 * page. It is wrong in a way that is invisible until the business grows:
 * each table is fetched with its own limit, so when invoices come back
 * truncated at the five hundredth row while customers — a much smaller
 * table — come back complete and freshly touched, the shared cursor jumps
 * to today. Every invoice between the truncation point and now is then
 * "already seen" and is never asked for again. The sync reports success and
 * the mirror has a hole in it for good.
 */
export type TableCursor = {
  /** Rows at or after this timestamp have still to be considered. */
  since: string;
  /**
   * True while the first fill is still running.
   *
   * A cold table is read through a bounded selection — an eighteen-month
   * window for invoices — so that a business three years in does not pull
   * its whole history down a mobile connection the first time somebody signs
   * in. Only once that fill completes does the table become the unbounded
   * "everything newer than my cursor" delta it stays as forever after.
   */
  cold: boolean;
};

export type Cursors = Record<string, TableCursor>;

export type PullPage = {
  changed: Record<string, { updated_at?: string }[]>;
  deleted: { table_name: string; row_key: string }[];
  /**
   * Where each table has got to, decided by the server that ran the queries.
   *
   * A null means "leave this one exactly where it was". That is what a table
   * nobody could read gets: advancing a skipped table's cursor is precisely
   * how invoice_items_view came to be permanently missed, and keeping it
   * still means a table whose grant is repaired resumes from where it
   * stopped with no special healing step at all.
   */
  next: Record<string, TableCursor | null>;
  /** At least one table came back full. Ask again. */
  more: boolean;
  userId: string;
  skipped?: { table: string; reason: string }[];
};

export type Step =
  /** Everything is here. Store these cursors and stop. */
  | { action: "done"; cursors: Cursors }
  /** More to come. Store these and ask again. */
  | { action: "more"; cursors: Cursors }
  /** The server keeps saying there is more but nothing moves forward. */
  | { action: "stalled"; cursors: Cursors }
  /** Somebody else is signed in — the mirror belongs to another person. */
  | { action: "reset"; userId: string };

/** The newest row in a set, which is where the next page begins. */
export function newestIn(rows: { updated_at?: string }[]): string | null {
  let max: string | null = null;
  for (const row of rows) {
    const at = row.updated_at;
    if (at && (max === null || at > max)) max = at;
  }
  return max;
}

/**
 * What to do after applying a page.
 *
 * The server proposes each table's next position, because it is the only
 * side that knows which query ran and what it was bounded by. This checks
 * the proposal rather than trusting it: a cursor is only stored when it
 * actually moves forward, so a server bug that kept returning the same
 * position would stall the loop rather than spin it, and one that tried to
 * hand back an older cursor cannot walk the device backwards.
 */
export function advance(
  page: PullPage,
  cursors: Cursors,
  owner: string | null,
): Step {
  if (owner !== null && owner !== page.userId) {
    return { action: "reset", userId: page.userId };
  }

  const next: Cursors = { ...cursors };
  let moved = false;

  for (const [table, proposed] of Object.entries(page.next ?? {})) {
    // Unreadable this time round. Stay exactly where we were.
    if (!proposed) continue;

    const current = cursors[table];
    if (!current) {
      next[table] = proposed;
      moved = true;
      continue;
    }

    // Finishing the cold fill is progress even when the timestamp does not
    // move: the table stops being windowed and becomes the full delta.
    if (proposed.since > current.since || (current.cold && !proposed.cold)) {
      next[table] = proposed;
      moved = true;
    }
  }

  if (!page.more) return { action: "done", cursors: next };
  if (!moved) return { action: "stalled", cursors: next };
  return { action: "more", cursors: next };
}

/**
 * customer_prices is keyed by a pair of columns, so the mirror gives it a
 * synthetic one. Derived in exactly one place so the key cannot drift between
 * whatever writes it and whatever reads it back.
 */
export function withKeys<T extends Record<string, unknown>>(
  store: string,
  rows: T[],
): T[] {
  if (store !== "customerPrices") return rows;
  return rows.map((row) => ({
    ...row,
    key: `${String(row.customer_id)}:${String(row.product_id)}`,
  }));
}

/** The server names its own tables; the mirror uses camelCase store names. */
export const STORE_FOR_TABLE: Record<string, string> = {
  customers: "customers",
  products: "products",
  invoices: "invoices",
  invoice_items: "invoiceItems",
  payments: "payments",
  customer_prices: "customerPrices",
  reminders_log: "reminders",
};
