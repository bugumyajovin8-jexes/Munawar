"use client";

/**
 * The read half of offline-first: keeping this device's mirror of the business
 * up to date with the server.
 *
 * The app used to ask Supabase for figures every time a screen rendered, which
 * made navigation as slow as the round trip and impossible without one. Now
 * every screen reads the mirror, and this file is the only thing that talks to
 * the network on their behalf. That single change is what makes navigation
 * instant *and* what makes six months offline survivable — they were never two
 * problems.
 *
 * The cursor is the server's clock, never the device's. A phone running a day
 * fast would ask for "everything since tomorrow" and receive nothing, forever,
 * with no error to notice.
 */
import {
  clearMirror,
  getMeta,
  putRows,
  setMeta,
  deleteRow,
  type MirrorStore,
  type Row,
} from "./db";
import { flush, getOutboxState } from "./outbox";
import { isNetworkError, markOffline, markOnline } from "./online";
import { STORE_FOR_TABLE, nextStep, withKeys, type PullPage } from "./sync-plan";

const CURSOR_KEY = "sync:cursor";
const OWNER_KEY = "sync:userId";
const SYNCED_KEY = "sync:lastSyncedAt";

/** A pull is cheap when nothing changed, so this can be frequent. */
const INTERVAL_MS = 90_000;
/** Stop a runaway loop if the server keeps saying "there is more". */
const MAX_PAGES = 40;

type Listener = () => void;

export type SyncState = {
  syncing: boolean;
  /** Null until this device has completed one successful pull. */
  lastSyncedAt: number | null;
  /** True while the mirror has never been filled — screens show a first-run state. */
  cold: boolean;
  error: string | null;
  needsSignIn: boolean;
};

const IDLE: SyncState = {
  syncing: false,
  lastSyncedAt: null,
  cold: true,
  error: null,
  needsSignIn: false,
};

let state: SyncState = IDLE;
const stateListeners = new Set<Listener>();

/**
 * Bumped whenever the mirror changes, so components can re-read.
 *
 * A counter rather than the data itself: useSyncExternalStore needs a snapshot
 * that is cheap to compare, and comparing an object graph of every invoice on
 * every render would cost more than the render.
 */
let version = 0;
const dataListeners = new Set<Listener>();

let started = false;
let inFlight: Promise<void> | null = null;
let ticker: ReturnType<typeof setInterval> | null = null;

function publish(next: Partial<SyncState>) {
  state = { ...state, ...next };
  for (const listener of stateListeners) listener();
}

function touched() {
  version += 1;
  for (const listener of dataListeners) listener();
}

export function getSyncState(): SyncState {
  return state;
}
export function getServerSyncState(): SyncState {
  return IDLE;
}
export function subscribeSync(listener: Listener): () => void {
  stateListeners.add(listener);
  return () => stateListeners.delete(listener);
}

export function getDataVersion(): number {
  return version;
}
export function getServerDataVersion(): number {
  return 0;
}
export function subscribeData(listener: Listener): () => void {
  dataListeners.add(listener);
  return () => dataListeners.delete(listener);
}

type PullResponse = PullPage & { changed: Record<string, Row[]> };

async function applyPage(response: PullResponse): Promise<void> {
  for (const [key, rows] of Object.entries(response.changed)) {
    if (rows.length === 0) continue;
    await putRows(key, withKeys(key, rows));
  }

  for (const tombstone of response.deleted) {
    const store = STORE_FOR_TABLE[tombstone.table_name];
    if (store) await deleteRow(store, tombstone.row_key);
  }
}

/**
 * Bring the mirror up to date.
 *
 * Unsent work is pushed first. If a payment recorded on this device is still
 * queued, pulling first would overwrite the optimistic copy with a server row
 * that predates it and the payment would appear to vanish until the next sync.
 * Push, then pull, and the server's answer already includes our own work.
 */
export function sync(): Promise<void> {
  if (inFlight) return inFlight;
  inFlight = run().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function run(): Promise<void> {
  publish({ syncing: true, error: null });

  try {
    if (getOutboxState().items.length > 0) await flush();

    let since = await getMeta<string>(CURSOR_KEY);
    let pages = 0;

    for (;;) {
      const url = since
        ? `/api/pull?since=${encodeURIComponent(since)}`
        : "/api/pull";

      const response = await fetch(url, { cache: "no-store" });

      // Any answer at all proves the network is back, even a refusal.
      markOnline();

      if (response.status === 401) {
        publish({ syncing: false, needsSignIn: true });
        return;
      }
      if (!response.ok) {
        /*
         * The server explains itself in the body, so read it rather than
         * reporting the status code. A 500 here is almost always a schema the
         * code expects and the database does not yet have — "Could not read
         * payments: column payments.updated_at does not exist" names the
         * problem and its fix, where "500" sends you looking in the browser.
         */
        let reason = `HTTP ${response.status}`;
        try {
          const body = (await response.json()) as { error?: string };
          if (body.error) reason = body.error;
        } catch {
          // Not JSON — a gateway or proxy error page. The status is all there is.
        }

        console.error(`Munawar sync failed: ${reason}`);
        publish({ syncing: false, error: reason });
        return;
      }

      const page = (await response.json()) as PullResponse;

      const owner = await getMeta<string>(OWNER_KEY);
      const step = nextStep(page, since, owner);

      /*
       * A different person has signed in on this device. Their mirror must not
       * be laid on top of the previous one — balances would merge and one
       * user's customers would be readable by the other. Start clean.
       */
      if (step.action === "reset") {
        await clearMirror();
        await setMeta(OWNER_KEY, step.userId);
        await setMeta(CURSOR_KEY, null);
        since = null;
        touched();
        pages += 1;
        if (pages > MAX_PAGES) break;
        continue;
      }
      if (!owner) await setMeta(OWNER_KEY, page.userId);

      await applyPage(page);
      touched();

      if (step.action === "done") {
        // A complete answer: the server's clock is now a safe high-water mark.
        if (step.cursor) await setMeta(CURSOR_KEY, step.cursor);
        break;
      }

      if (step.action === "stalled") {
        publish({ error: "Some records could not be synced." });
        break;
      }

      // More to come. Resume from the newest row actually received, never from
      // the server's clock — storing that mid-run would mark everything past
      // the cut as seen and those records would never be asked for again.
      since = step.since;

      pages += 1;
      if (pages > MAX_PAGES) break;
    }

    const now = Date.now();
    await setMeta(SYNCED_KEY, now);
    publish({ syncing: false, lastSyncedAt: now, cold: false, needsSignIn: false });
  } catch (error) {
    if (isNetworkError(error)) markOffline();
    // Offline is not a failure worth showing. The mirror is still there and
    // every screen still works; it is simply not being added to right now.
    publish({ syncing: false, error: null });
  }
}

/**
 * Called once from the app shell.
 *
 * The triggers are the moments the mirror could be out of date: arriving,
 * coming back to the tab, regaining a connection, and time passing.
 */
export async function startSync(userId: string): Promise<void> {
  if (started || typeof window === "undefined") return;
  started = true;

  const owner = await getMeta<string>(OWNER_KEY);
  if (owner && owner !== userId) await clearMirror();

  const [syncedAt] = await Promise.all([getMeta<number>(SYNCED_KEY)]);
  publish({ lastSyncedAt: syncedAt, cold: syncedAt === null });

  void sync();

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void sync();
  });
  window.addEventListener("online", () => void sync());

  if (!ticker) ticker = setInterval(() => void sync(), INTERVAL_MS);
}

/** Sign out. The mirror is this user's business and leaves with them. */
export async function purgeMirror(): Promise<void> {
  await clearMirror();
  publish({ ...IDLE });
  touched();
}

/**
 * Write a row into the mirror before the server has seen it.
 *
 * This is what makes an offline change visible. The row is marked so screens
 * can show it as not yet sent, and the next pull overwrites it with whatever
 * the server actually stored — so the optimistic copy is always in front of
 * the truth and never instead of it.
 */
export async function applyLocal(store: MirrorStore, rows: Row[]): Promise<void> {
  await putRows(
    store,
    withKeys(
      store,
      rows.map((row) => ({ ...row, _pending: true })),
    ),
  );
  touched();
}

export async function removeLocal(store: MirrorStore, key: string): Promise<void> {
  await deleteRow(store, key);
  touched();
}
