"use client";

/**
 * A very small IndexedDB wrapper — no dependency, one database, several stores.
 *
 * localStorage would have been shorter, but it is synchronous (it blocks the
 * main thread on every write) and browsers evict it far more readily. Money
 * the user has already typed in must survive a killed tab, so it belongs in
 * the durable store.
 *
 * Every call falls back to an in-memory map when IndexedDB is unavailable —
 * Safari private browsing, locked-down enterprise profiles, ancient WebViews.
 * A degraded store that lasts as long as the tab beats a crash on line one.
 *
 * Two things live here. The **outbox** is work this device has done that the
 * server has not seen yet. The **mirror** is the business as the server last
 * described it. Screens read the mirror, so they never wait on a network and
 * never go blank without one; the outbox is what eventually reconciles it.
 * Both are in one database because they must be upgraded together — two
 * openers on the same name would deadlock each other's version change.
 */
import type { OutboxItem } from "./types";

const DB_NAME = "munawar-offline";
/**
 * v2 added the mirror stores alongside the original outbox.
 * v3 added customerBranches.
 *
 * The upgrade below is additive and skips stores that already exist, so a bump
 * creates the new store and touches nothing else — no device loses its mirror.
 * The new store simply starts empty, and because sync cursors are per table, a
 * table with no cursor is cold and fills itself on the next sync. A single
 * shared cursor would instead have declared it already up to date and left it
 * empty for ever.
 */
const DB_VERSION = 3;

export const OUTBOX = "outbox";

/**
 * The mirrored tables, and how each is indexed.
 *
 * The indexes are not decoration — they are the difference between a screen
 * that reads one invoice's lines and one that walks every line in the business
 * to find them. After six months offline that distinction is the app being
 * usable or not.
 */
export const MIRROR_STORES = {
  customers: { keyPath: "id", indexes: ["name"] },
  customerBranches: { keyPath: "id", indexes: ["customer_id"] },
  products: { keyPath: "id", indexes: ["name"] },
  invoices: { keyPath: "id", indexes: ["customer_id", "status", "due_date"] },
  invoiceItems: { keyPath: "id", indexes: ["invoice_id"] },
  payments: { keyPath: "id", indexes: ["invoice_id", "paid_on"] },
  /** Keyed by a synthetic "customerId:productId" — the table has no id column. */
  customerPrices: { keyPath: "key", indexes: ["customer_id"] },
  reminders: { keyPath: "id", indexes: ["invoice_id"] },
} as const;

export type MirrorStore = keyof typeof MIRROR_STORES;

/** Sync cursor, the user the mirror belongs to, the device id, number blocks. */
export const META = "meta";

let dbPromise: Promise<IDBDatabase | null> | null = null;
const memory = new Map<string, Map<string, unknown>>();

function mem(store: string): Map<string, unknown> {
  let table = memory.get(store);
  if (!table) {
    table = new Map();
    memory.set(store, table);
  }
  return table;
}

/**
 * Which stores keep a shadow copy in memory even when IndexedDB is working.
 *
 * The outbox and the meta store do: between them they hold a few dozen small
 * records, and one of those records is money the user has typed in and not yet
 * sent, which must survive a transaction failing for reasons we cannot see.
 *
 * The mirror stores do not. They are the business — tens of thousands of rows
 * within a few years — and holding all of it twice doubles the app's memory
 * for a copy that is re-downloadable by definition. A phone is exactly where
 * that bill is felt. When there is no IndexedDB at all, everything falls back
 * to memory regardless; that is what the map was originally for.
 */
function alwaysShadowed(store: string): boolean {
  return store === OUTBOX || store === META;
}

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve) => {
    if (typeof indexedDB === "undefined") return resolve(null);

    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      return resolve(null);
    }

    request.onupgradeneeded = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains(OUTBOX)) {
        db.createObjectStore(OUTBOX, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(META)) {
        db.createObjectStore(META, { keyPath: "key" });
      }

      for (const [name, spec] of Object.entries(MIRROR_STORES)) {
        if (db.objectStoreNames.contains(name)) continue;
        const store = db.createObjectStore(name, { keyPath: spec.keyPath });
        for (const index of spec.indexes) {
          store.createIndex(index, index, { unique: false });
        }
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    // Firefox fires neither event when a private window blocks storage.
    request.onblocked = () => resolve(null);
  });

  return dbPromise;
}

function run<T>(
  storeName: string,
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T | null> {
  return openDb().then(
    (db) =>
      new Promise<T | null>((resolve) => {
        if (!db) return resolve(null);
        try {
          const tx = db.transaction(storeName, mode);
          const request = work(tx.objectStore(storeName));
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => resolve(null);
        } catch {
          resolve(null);
        }
      }),
  );
}

// ------------------------------------------------------------- outbox -------

export async function readAll(): Promise<OutboxItem[]> {
  const rows = await run<OutboxItem[]>(OUTBOX, "readonly", (s) => s.getAll());
  const items = rows ?? ([...mem(OUTBOX).values()] as OutboxItem[]);
  // Order is the whole point: a draft invoice must not reach the server before
  // the customer it belongs to.
  return items.sort((a, b) => a.createdAt - b.createdAt);
}

export async function writeItem(item: OutboxItem): Promise<void> {
  mem(OUTBOX).set(item.id, item);
  await run(OUTBOX, "readwrite", (s) => s.put(item));
}

export async function deleteItem(id: string): Promise<void> {
  mem(OUTBOX).delete(id);
  await run(OUTBOX, "readwrite", (s) => s.delete(id));
}

export async function clearAll(): Promise<void> {
  mem(OUTBOX).clear();
  await run(OUTBOX, "readwrite", (s) => s.clear());
}

// ------------------------------------------------------------- mirror -------

export type Row = Record<string, unknown> & { id?: string; key?: string };

function keyOf(store: string, row: Row): string {
  const keyPath = store === META ? "key" : MIRROR_STORES[store as MirrorStore]?.keyPath;
  return String(row[keyPath as "id" | "key"] ?? "");
}

/**
 * Upsert, always. The server is the authority on what a row contains, so a row
 * arriving from a pull replaces whatever was here — including an optimistic
 * copy this device wrote a moment ago. That is what closes the loop: the local
 * guess is only ever in front of the truth, never instead of it.
 */
export async function putRows(store: string, rows: Row[]): Promise<void> {
  if (rows.length === 0) return;

  const db = await openDb();

  if (!db || alwaysShadowed(store)) {
    const table = mem(store);
    for (const row of rows) table.set(keyOf(store, row), row);
  }

  if (!db) return;

  // One transaction for the whole batch. A pull can carry hundreds of rows and
  // a transaction each would be an order of magnitude slower.
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(store, "readwrite");
      const objectStore = tx.objectStore(store);
      for (const row of rows) objectStore.put(row);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
}

export async function getRows<T>(store: string): Promise<T[]> {
  const rows = await run<T[]>(store, "readonly", (s) => s.getAll());
  return rows ?? ([...mem(store).values()] as T[]);
}

export async function getRow<T>(store: string, key: string): Promise<T | null> {
  const row = await run<T>(store, "readonly", (s) => s.get(key));
  // A miss and a failure both come back nullish, so the shadow is consulted
  // either way. It is empty for the mirror stores unless there is no
  // IndexedDB, which makes this a no-op rather than a wrong answer.
  return row ?? ((mem(store).get(key) as T) ?? null);
}

/** Every row whose indexed column equals this value — one invoice's lines. */
export async function getBy<T>(
  store: MirrorStore,
  index: string,
  value: string,
): Promise<T[]> {
  const rows = await run<T[]>(store, "readonly", (s) =>
    s.index(index).getAll(value),
  );
  if (rows) return rows;

  return [...mem(store).values()].filter(
    (row) => (row as Record<string, unknown>)[index] === value,
  ) as T[];
}

/**
 * Every row whose indexed column matches any of these values, in one
 * transaction.
 *
 * The alternative the screens were using is getAll() over the whole store,
 * which for invoice items is the largest table there is — several rows per
 * invoice, so tens of thousands within a few years — deserialised in full
 * every time anything in the mirror changed, to answer a question about the
 * few dozen invoices in a month. The index is already there; this uses it.
 *
 * One transaction rather than one per value: opening thousands of them is
 * slower than the scan it replaces.
 */
export async function getByMany<T>(
  store: MirrorStore,
  index: string,
  values: string[],
): Promise<T[]> {
  if (values.length === 0) return [];

  const db = await openDb();
  if (!db) {
    const wanted = new Set(values);
    return [...mem(store).values()].filter((row) =>
      wanted.has(String((row as Record<string, unknown>)[index])),
    ) as T[];
  }

  return new Promise<T[]>((resolve) => {
    const rows: T[] = [];
    try {
      const tx = db.transaction(store, "readonly");
      const target = tx.objectStore(store).index(index);

      for (const value of values) {
        const request = target.getAll(value);
        request.onsuccess = () => rows.push(...(request.result as T[]));
      }

      tx.oncomplete = () => resolve(rows);
      // A partial answer would be read as the whole answer and quietly
      // understate whatever it is summed into.
      tx.onerror = () => resolve([]);
      tx.onabort = () => resolve([]);
    } catch {
      resolve([]);
    }
  });
}

export async function deleteRow(store: string, key: string): Promise<void> {
  mem(store).delete(key);
  await run(store, "readwrite", (s) => s.delete(key));
}

/**
 * Delete a set of keys in one transaction.
 *
 * deleteRow opens a transaction per key, which is right for the one-off case
 * and wrong for a sweep: removing forty rows that way is forty transactions,
 * each with its own commit, on the thread that also draws the screen.
 */
export async function deleteRows(store: string, keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  for (const key of keys) mem(store).delete(key);

  const db = await openDb();
  if (!db) return;

  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(store, "readwrite");
      const target = tx.objectStore(store);
      for (const key of keys) target.delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
}

/**
 * Wipe the mirror, keeping the outbox.
 *
 * Signing out, or a different person signing in on this device, must not leave
 * one user's customers and figures readable by the next. Unsent work is a
 * separate question and deliberately survives — it belongs to whoever queued
 * it, and the outbox is already scoped by user id.
 */
export async function clearMirror(): Promise<void> {
  for (const store of Object.keys(MIRROR_STORES)) {
    mem(store).clear();
    await run(store, "readwrite", (s) => s.clear());
  }
  mem(META).clear();
  await run(META, "readwrite", (s) => s.clear());
}

// --------------------------------------------------------------- meta -------

export async function getMeta<T>(key: string): Promise<T | null> {
  const row = await getRow<{ key: string; value: T }>(META, key);
  return row ? row.value : null;
}

export async function setMeta<T>(key: string, value: T): Promise<void> {
  await putRows(META, [{ key, value } as Row]);
}
