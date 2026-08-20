/**
 * The decisions a pull makes, with no I/O of any kind.
 *
 * Split out so they can be tested. Everything here is the sort of logic that
 * fails silently — a cursor that advances too far skips records and nothing
 * ever reports it, a cursor that fails to advance re-fetches the same page
 * forever. Both look exactly like a working sync from the outside, which is
 * how the last two offline bugs survived so long.
 *
 * No browser imports, deliberately: this file has to run in a plain Node
 * process so `npm run test:sync` can exercise it directly.
 */

export type PullPage = {
  cursor: string | null;
  truncated: boolean;
  changed: Record<string, { updated_at?: string }[]>;
  deleted: { table_name: string; row_key: string }[];
  userId: string;
};

export type Step =
  /** Everything is here. Store this cursor and stop. */
  | { action: "done"; cursor: string | null }
  /** More to come. Ask again from here, and do not store it. */
  | { action: "more"; since: string }
  /** The server keeps saying there is more but sends nothing newer. */
  | { action: "stalled" }
  /** Somebody else is signed in — the mirror belongs to another person. */
  | { action: "reset"; userId: string };

/** The newest row in this page, which is where the next page begins. */
export function newestIn(page: PullPage): string | null {
  let max: string | null = null;
  for (const rows of Object.values(page.changed)) {
    for (const row of rows) {
      const at = row.updated_at;
      if (at && (max === null || at > max)) max = at;
    }
  }
  return max;
}

/**
 * What to do after applying a page.
 *
 * The rule that matters: when a page came back full, the next request resumes
 * from the newest row actually received, never from the server's clock.
 * Storing the clock mid-run would mark everything past the cut as already
 * seen, and those records would never be asked for again.
 */
export function nextStep(page: PullPage, since: string | null, owner: string | null): Step {
  if (owner !== null && owner !== page.userId) {
    return { action: "reset", userId: page.userId };
  }

  if (!page.truncated) return { action: "done", cursor: page.cursor };

  const newest = newestIn(page);

  // No forward progress: either every row in a full page shares one timestamp,
  // or the page carried none at all. Asking again would return the same rows.
  if (newest === null || (since !== null && newest <= since)) {
    return { action: "stalled" };
  }

  return { action: "more", since: newest };
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
