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
/** v2 added the mirror stores alongside the original outbox. */
const DB_VERSION = 2;

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

  const table = mem(store);
  for (const row of rows) table.set(keyOf(store, row), row);

  const db = await openDb();
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

export async function deleteRow(store: string, key: string): Promise<void> {
  mem(store).delete(key);
  await run(store, "readwrite", (s) => s.delete(key));
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
