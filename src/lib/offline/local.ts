"use client";

/**
 * Reading the mirror from React.
 *
 * Screens no longer await Supabase; they await IndexedDB, which answers in
 * about a millisecond whether or not there is a network. The subscription is
 * to a version counter rather than to the data, because `useSyncExternalStore`
 * compares snapshots on every render and comparing every invoice in the
 * business would cost more than the render it was meant to save.
 */
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { getBy, getRow, getRows, type MirrorStore } from "./db";
import {
  getDataVersion,
  getServerDataVersion,
  getServerSyncState,
  getSyncState,
  subscribeData,
  subscribeSync,
  type SyncState,
} from "./sync";

export function useSync(): SyncState {
  return useSyncExternalStore(subscribeSync, getSyncState, getServerSyncState);
}

/**
 * Run a read against the mirror, and run it again whenever the mirror changes.
 *
 * `key` identifies the query — change it when the thing being asked for
 * changes (a different invoice id, a different filter) and the read re-runs.
 * It exists because the alternative, spreading a dependency array, defeats the
 * exhaustive-deps check that keeps these correct.
 */
export function useLocalData<T>(key: string, load: () => Promise<T>, initial: T): T {
  const version = useSyncExternalStore(
    subscribeData,
    getDataVersion,
    getServerDataVersion,
  );

  const [data, setData] = useState<T>(initial);

  // Held in a ref so an inline arrow function does not re-run the query on
  // every render, without forcing every caller to useCallback.
  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  });

  useEffect(() => {
    let live = true;
    void loadRef.current().then((next) => {
      if (live) setData(next);
    });
    return () => {
      live = false;
    };
  }, [version, key]);

  return data;
}

export function useAll<T>(store: MirrorStore): T[] {
  return useLocalData<T[]>(`all:${store}`, () => getRows<T>(store), []);
}

export function useOne<T>(store: MirrorStore, id: string | null): T | null {
  return useLocalData<T | null>(
    `one:${store}:${id ?? ""}`,
    () => (id ? getRow<T>(store, id) : Promise.resolve(null)),
    null,
  );
}

/** Children of one parent — an invoice's lines, a customer's invoices. */
export function useRelated<T>(
  store: MirrorStore,
  index: string,
  value: string | null,
): T[] {
  return useLocalData<T[]>(
    `by:${store}:${index}:${value ?? ""}`,
    () => (value ? getBy<T>(store, index, value) : Promise.resolve([])),
    [],
  );
}

/**
 * Server rows and mirror rows as one list, the mirror winning per record.
 *
 * The obvious version of this — use the mirror if it has anything, otherwise
 * the server — is wrong in a way that only shows up at the worst moment. On a
 * device whose mirror has not filled yet, saving one customer puts exactly one
 * row in it, and a whole-list switch would then show that single customer and
 * hide every other one the server had already sent.
 *
 * Merging by id avoids that entirely: a record the device has a newer copy of
 * uses the local copy, everything else stays. A cold mirror adds nothing and
 * changes nothing, rather than replacing the world with its own emptiness.
 */
export function mergeById<T extends { id: string }>(
  serverRows: T[],
  mirrorRows: T[],
): T[] {
  if (mirrorRows.length === 0) return serverRows;

  const merged = new Map<string, T>();
  for (const row of serverRows) merged.set(row.id, row);
  for (const row of mirrorRows) merged.set(row.id, row);
  return [...merged.values()];
}
