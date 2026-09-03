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
  getByMany,
  deleteRows,
  getRows,
  putRows,
  setMeta,
  deleteRow,
  type MirrorStore,
  type Row,
} from "./db";
import { flush, getOutboxState } from "./outbox";
import { isNetworkError, markOffline, markOnline } from "./online";
import {
  STORE_FOR_TABLE,
  advance,
  withKeys,
  type Cursors,
  type PullPage,
} from "./sync-plan";

/** One position per table. See TableCursor for why a single one was wrong. */
const CURSORS_KEY = "sync:cursors";
/**
 * The single shared cursor this replaced.
 *
 * A device holding one of these has been syncing under the old scheme, which
 * could stride past a truncated table and never come back for it. There is no
 * way to tell from the device whether that happened, so its presence is taken
 * as reason enough to read the business again from the beginning. Rows are
 * upserted, so the screens keep working throughout.
 */
const LEGACY_CURSOR_KEY = "sync:cursor";
const OWNER_KEY = "sync:userId";
const SYNCED_KEY = "sync:lastSyncedAt";
/** Set once the duplicated-lines sweep below has run on this device. */
const LINE_REPAIR_KEY = "sync:linesRepaired";

/*
 * Whether this device is holding any invoice line it wrote itself.
 *
 * The cleanup below is only ever needed where one exists, and on the runs that
 * matter most there are none: a cold fill on a fresh device pulls lines for
 * hundreds of invoices at once, and checking each of them against a store that
 * cannot contain a single unsent row is pure cost on the slowest thing the app
 * does. So the answer is worked out once, by a sweep that was reading the
 * store anyway, and set again the moment anything optimistic is written.
 *
 * Wrong in the safe direction only. A stale `true` costs one indexed lookup per
 * invoice in a page — a few rows, on the pulls that follow saving an invoice.
 * It is never left stale as `false`: applyLocal sets it before the write it
 * describes has even landed.
 *
 * Kept in meta as well as in memory, because a module variable dies with the
 * page. An invoice saved with no signal, and the app closed before the queue
 * drained, would otherwise come back with the flag cleared — and the lines the
 * server later sent would sit beside this device's for good, double-counted by
 * every figure that sums them.
 */
const UNSENT_LINES_KEY = "sync:unsentLines";
let hasUnsentLines = false;

function noteUnsentLines(value: boolean): void {
  // In memory first and synchronously: a pull racing this must see the truth
  // before the write it is racing has been recorded anywhere slower.
  hasUnsentLines = value;
  void setMeta(UNSENT_LINES_KEY, value);
}

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

/**
 * One sweep for invoices already holding both sets of lines.
 *
 * dropSupersededLines only fires when a pull actually carries lines for an
 * invoice, and a delta pull carries only what changed — so an invoice
 * duplicated last week is never mentioned again and would list its products
 * twice for good. This is the repair for what is already on the device.
 *
 * Once per device, recorded in meta. It reads one store in full, which is why
 * it is not run on every sync.
 */
async function repairDuplicateLines(): Promise<void> {
  /*
   * Skipped only when there is nothing of this device's waiting AND the
   * historical sweep has already been done. The second half is what repairs a
   * device duplicated before any of this existed — it has no flag to go on,
   * because the flag is newer than the damage.
   */
  if (!hasUnsentLines && (await getMeta<boolean>(LINE_REPAIR_KEY))) return;

  try {
    const items = await getRows<Row>("invoiceItems");

    // Which invoices the server has answered on. Only their guesses are stale.
    const confirmed = new Set(
      items.filter((row) => !row._pending).map((row) => String(row.invoice_id)),
    );

    const stale = items.filter(
      (row) => row._pending && confirmed.has(String(row.invoice_id)),
    );

    await deleteRows("invoiceItems", stale.map((row) => String(row.id)));

    // What the sweep learned, so the per-pull check above can skip the lookup
    // entirely on a device that has nothing of its own waiting. Counted after
    // the deletions, since those are exactly the rows that stop being unsent.
    const staleIds = new Set(stale.map((row) => String(row.id)));
    noteUnsentLines(items.some((row) => row._pending && !staleIds.has(String(row.id))));

    await setMeta(LINE_REPAIR_KEY, true);
    if (stale.length > 0) {
      console.info(`Munawar: removed ${stale.length} duplicated invoice line(s).`);
      touched();
    }
  } catch {
    // A repair that cannot run must never stop the app starting. It will be
    // attempted again next time, since the flag is only set on success.
  }
}

/**
 * Drop this device's guesses about an invoice's lines once the server's own
 * have arrived.
 *
 * The two sets describe the same products under different ids and cannot
 * replace each other by key: a line is written here under the form's own row
 * key, while save_draft_invoice() deletes every line and reinserts it with an
 * id Postgres mints. So both survived, and an invoice of three products listed
 * six — the totals staying right, because those come from one column on the
 * invoice rather than from summing the lines, which is exactly why it looked
 * like a display quirk rather than the mirror holding each line twice.
 *
 * It was not only cosmetic: margin is summed across these rows, so a
 * duplicated invoice reported double the profit it made on the dashboard, in
 * reports and on the invoice itself.
 *
 * Scoped to the invoices in this page, and only to rows this device marked as
 * unsent. A pending line for an invoice the server has not answered on yet is
 * untouched — that is the offline case, and it is the only copy there is.
 */
async function dropSupersededLines(rows: Row[]): Promise<boolean> {
  // The common case, and the expensive one to get wrong: nothing on this
  // device was written by this device, so there is nothing to supersede.
  if (!hasUnsentLines) return false;

  const invoiceIds = [...new Set(rows.map((r) => String(r.invoice_id)).filter(Boolean))];
  if (invoiceIds.length === 0) return false;

  const existing = await getByMany<Row>("invoiceItems", "invoice_id", invoiceIds);
  const stale = existing.filter((row) => row._pending);
  if (stale.length === 0) return false;

  await deleteRows("invoiceItems", stale.map((row) => String(row.id)));
  return true;
}

/**
 * Write a page into the mirror, reporting whether it actually contained
 * anything.
 *
 * The answer decides whether screens are told to re-read, and that is not a
 * detail. Every `useAll` hook responds by reading its whole store out of
 * IndexedDB — the dashboard alone re-reads invoices, customers, payments and
 * invoice items in full. Doing that on every tick of a ninety-second timer,
 * including the overwhelming majority that carry no rows at all, is most of
 * what the app spends its time on once a business has a few years of history.
 */
async function applyPage(response: PullResponse): Promise<boolean> {
  let wrote = false;

  for (const [key, rows] of Object.entries(response.changed)) {
    if (rows.length === 0) continue;
    if (key === "invoiceItems" && (await dropSupersededLines(rows))) wrote = true;
    await putRows(key, withKeys(key, rows));
    wrote = true;
  }

  for (const tombstone of response.deleted) {
    const store = STORE_FOR_TABLE[tombstone.table_name];
    if (store) {
      await deleteRow(store, tombstone.row_key);
      wrote = true;
    }
  }

  return wrote;
}

/**
 * Where each table has got to, migrating a device off the old shared cursor.
 *
 * A device still holding `sync:cursor` synced under the scheme that could
 * stride past a truncated table, and nothing on the device records whether it
 * did. Dropping the cursor costs one cold fill; keeping it risks a mirror
 * that is quietly missing invoices nobody will ever notice are absent.
 */
async function loadCursors(): Promise<Cursors> {
  const legacy = await getMeta<string>(LEGACY_CURSOR_KEY);
  if (legacy) {
    console.info("Munawar: upgrading to per-table sync cursors — reading everything once.");
    await setMeta(LEGACY_CURSOR_KEY, null);
    await setMeta(CURSORS_KEY, {});
    return {};
  }

  return (await getMeta<Cursors>(CURSORS_KEY)) ?? {};
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

    let cursors = await loadCursors();
    let pages = 0;
    let wrote = false;

    for (;;) {
      const held = Object.keys(cursors).length > 0;
      const url = held
        ? `/api/pull?cursors=${encodeURIComponent(JSON.stringify(cursors))}`
        : "/api/pull";

      /*
       * The fetch gets its own catch, and it is the only thing allowed to be
       * read as "no signal".
       *
       * isNetworkError() treats any TypeError as a lost connection, which is
       * right for a rejected fetch and wrong for everywhere else — a TypeError
       * from a bug in the loop below was being caught by the same handler,
       * reported as offline, and then silenced, because offline is not a
       * failure worth showing the user. So a real fault presented as a device
       * that had wandered out of range: much loading, then "Offline" in the
       * sidebar, and nothing anywhere saying why.
       */
      let response: Response;
      try {
        response = await fetch(url, { cache: "no-store" });
      } catch (error) {
        if (!isNetworkError(error)) throw error;
        markOffline();
        publish({ syncing: false, error: null });
        return;
      }

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
      const step = advance(page, cursors, owner);

      /*
       * A different person has signed in on this device. Their mirror must not
       * be laid on top of the previous one — balances would merge and one
       * user's customers would be readable by the other. Start clean.
       */
      if (step.action === "reset") {
        await clearMirror();
        await setMeta(OWNER_KEY, step.userId);
        await setMeta(CURSORS_KEY, {});
        cursors = {};
        touched();
        pages += 1;
        if (pages > MAX_PAGES) break;
        continue;
      }
      if (!owner) await setMeta(OWNER_KEY, page.userId);

      /*
       * A skipped table is a partial sync, and partial syncs must not be
       * silent.
       *
       * invoice_items_view went missing from every pull for days because the
       * view lacked the column the query ordered by. The response said so on
       * every request; nothing read it. The dashboard showed "waiting to
       * finish syncing" and there was no way to find out what it was waiting
       * for. One console line would have named the table and the reason.
       */
      for (const skip of page.skipped ?? []) {
        console.warn(`Munawar sync skipped ${skip.table}: ${skip.reason}`);
      }

      /*
       * Beyond saying so, a skipped table needs no healing step any more.
       *
       * Its cursor is simply not advanced — the server returns null for it and
       * `advance` leaves it exactly where it was — so the rows it could not
       * read are still waiting the moment the grant or the view is repaired.
       * There used to be a global reset here to compensate for a shared cursor
       * that had no way of holding one table still.
       */

      wrote = (await applyPage(page)) || wrote;
      // Only when something actually arrived. See applyPage.
      if (wrote) touched();

      cursors = step.cursors;
      await setMeta(CURSORS_KEY, cursors);

      if (step.action === "done") break;

      if (step.action === "stalled") {
        console.error("Munawar sync stalled: the server reports more but sends nothing newer.");
        publish({ error: "Some records could not be synced." });
        break;
      }

      pages += 1;
      if (pages > MAX_PAGES) {
        console.error(
          `Munawar sync stopped after ${MAX_PAGES} pages with more still to come.`,
        );
        publish({ error: "Still catching up — this device is a long way behind." });
        break;
      }
    }

    const now = Date.now();
    await setMeta(SYNCED_KEY, now);
    publish({ syncing: false, lastSyncedAt: now, cold: false, needsSignIn: false });
  } catch (error) {
    /*
     * Anything reaching here is a fault in this code, not a flat connection —
     * the fetch handles that case itself above. Say so, loudly and on screen.
     * The mirror is intact and every screen still works, but a sync that has
     * stopped for a reason nobody can see is how a device quietly falls weeks
     * behind.
     */
    const reason = error instanceof Error ? error.message : "Unknown error";
    console.error("Munawar sync failed:", error);
    publish({ syncing: false, error: `Sync failed: ${reason}` });
  }
}

/**
 * Called once from the app shell.
 *
 * The triggers are the moments the mirror could be out of date: arriving,
 * coming back to the tab, regaining a connection, and time passing.
 */
export async function startSync(userId: string): Promise<void> {
  // Already running: hand back whatever is in flight, so a second caller
  // waiting on this still waits for a real answer rather than none.
  if (started || typeof window === "undefined") return inFlight ?? undefined;
  started = true;

  const owner = await getMeta<string>(OWNER_KEY);
  if (owner && owner !== userId) await clearMirror();

  const syncedAt = await getMeta<number>(SYNCED_KEY);
  publish({ lastSyncedAt: syncedAt, cold: syncedAt === null });

  // One key, read once, so the per-pull check below can be a boolean test.
  hasUnsentLines = (await getMeta<boolean>(UNSENT_LINES_KEY)) ?? false;

  /*
   * Listeners before the first sync, not after.
   *
   * A cold fill on a poor connection can run for a while, and a phone that
   * finds signal partway through has to be able to act on it. Registering
   * these first costs nothing and means the recovery paths exist for the
   * whole of the slowest sync this device will ever do.
   */
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void sync();
  });
  window.addEventListener("online", () => void sync());

  if (!ticker) ticker = setInterval(() => void sync(), INTERVAL_MS);

  /*
   * Awaited, so a caller can wait for the mirror before adding load of its
   * own. This used to be `void sync()`, which meant the offline warm run's
   * attempt to wait for it returned instantly and the two ran together —
   * a cold read of the whole business alongside a page fetch every fraction
   * of a second, which is what timed the middleware out after a fresh login.
   */
  await sync();

  /*
   * After the mirror is current, not before, and not awaited.
   *
   * It reads one store in full, and doing that ahead of the first sync would
   * put a scan of every invoice line on the launch path — the thing this app
   * has already been made slow by once. Nothing waits on it either: the
   * invoice screen ignores superseded lines as it reads, so the sweep is only
   * correcting the figures that sum them, and those can be right a moment
   * later. It publishes a change when it finds something, so screens re-read
   * by themselves.
   */
  void repairDuplicateLines();
}

/**
 * Forget how far we have got and read the whole business again.
 *
 * Exposed as munawar.resync() for the case the automatic healing cannot cover:
 * a cursor that moved past data while a table was unreadable, on a device that
 * has since been repaired but has no record of ever having skipped anything.
 *
 * Deliberately does not clear the mirror first. Rows are upserted, so the
 * screens keep working throughout rather than emptying and refilling.
 */
export async function resync(): Promise<void> {
  await setMeta(CURSORS_KEY, {});
  await setMeta(LEGACY_CURSOR_KEY, null);
  await sync();
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
  // Set before the write, never after: the flag existing to make a skip safe
  // must never be false while an unsent row is on its way in.
  if (store === "invoiceItems" && rows.length > 0) noteUnsentLines(true);

  await putRows(
    store,
    withKeys(
      store,
      rows.map((row) => ({ ...row, _pending: true })),
    ),
  );
  touched();
}

/**
 * Take an optimistic row back out — one key or a whole set.
 *
 * The set form is not convenience. Rolling an invoice back one row at a time
 * re-renders every screen once per line, and — more importantly — it is the
 * shape that invites forgetting the children: the invoice used to be removed
 * on a failed issue while its lines stayed in the mirror for ever, since
 * nothing but a server tombstone ever cleans those up and the server never
 * knew they existed.
 */
export async function removeLocal(
  store: MirrorStore,
  keys: string | string[],
): Promise<void> {
  for (const key of Array.isArray(keys) ? keys : [keys]) {
    await deleteRow(store, key);
  }
  touched();
}
