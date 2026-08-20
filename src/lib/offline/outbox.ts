"use client";

/**
 * The outbox: a write-ahead log for everything the user does.
 *
 * Every offline-capable write goes in here first and is only then sent. That
 * ordering is the whole design. If the request succeeds the item is gone
 * within milliseconds and nobody notices; if the connection is dead the work
 * is already safe on the device and syncs later. There is one code path, so
 * the offline path cannot rot from lack of use.
 *
 * Each item carries a uuid that the server records in client_ops before doing
 * anything (migration 0006). That is what makes a retry safe: a payment sent
 * twice because the first acknowledgement was lost is recognised and skipped
 * rather than booked twice.
 */
import { readAll, writeItem, deleteItem } from "./db";
import { getOnline, isNetworkError, markOffline, markOnline, subscribeOnline } from "./online";
import { requestPersistence } from "./storage";
import { isSettled, type OutboxBody, type OutboxItem, type SyncResponse } from "./types";

export type OutboxState = {
  items: OutboxItem[];
  /** Items the server refused. Retrying unchanged will not help them. */
  blocked: OutboxItem[];
  syncing: boolean;
  lastSyncedAt: number | null;
  /** The session expired while work was queued — signing in again drains it. */
  needsSignIn: boolean;
};

const EMPTY: OutboxState = {
  items: [],
  blocked: [],
  syncing: false,
  lastSyncedAt: null,
  needsSignIn: false,
};

/** One request should not carry a whole week of fieldwork. */
const MAX_BATCH = 25;
const RETRY_INTERVAL_MS = 30_000;

type Listener = () => void;

const listeners = new Set<Listener>();
let snapshot: OutboxState = EMPTY;
let queue: OutboxItem[] = [];
let blockedIds = new Set<string>();
let syncing = false;
let lastSyncedAt: number | null = null;
let needsSignIn = false;
let initialised = false;
let currentUser: string | null = null;
let inFlight: Promise<void> | null = null;
let ticker: ReturnType<typeof setInterval> | null = null;

/**
 * What the server produced for an operation, held just long enough for the
 * submit() call that queued it to read it back. Only ids in `watching` are
 * recorded, so a background drain of fifty queued items leaves nothing behind.
 */
const applied = new Map<string, { invoiceId?: string } | undefined>();
const watching = new Set<string>();

/** Only ever act on work queued by the person signed in right now. */
function mine(): OutboxItem[] {
  return currentUser === null ? [] : queue.filter((item) => item.userId === currentUser);
}

function rebuild() {
  const owned = mine();
  snapshot = {
    items: owned.filter((item) => !blockedIds.has(item.id)),
    blocked: owned.filter((item) => blockedIds.has(item.id)),
    syncing,
    lastSyncedAt,
    needsSignIn,
  };
  for (const listener of listeners) listener();
}

/**
 * Called from the app shell on every load. Until it runs nothing is sent: an
 * unattributed queue could otherwise be flushed under the wrong account.
 */
export function setOutboxUser(userId: string): void {
  if (currentUser === userId) return;
  currentUser = userId;
  rebuild();
  void flush();
}

export function getOutboxState(): OutboxState {
  return snapshot;
}

/** Server render and first paint show an empty queue — it lives on the device. */
export function getServerOutboxState(): OutboxState {
  return EMPTY;
}

export function subscribeOutbox(listener: Listener): () => void {
  listeners.add(listener);
  void init();
  return () => listeners.delete(listener);
}

/**
 * The id has to be a real uuid, not merely unique: it becomes the primary key
 * of client_ops, so a hand-rolled "unique enough" string would be rejected by
 * Postgres and strand the item in the queue for good.
 */
export function newId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  // randomUUID needs a secure context; getRandomValues does not.
  const bytes = new Uint8Array(16);
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 1

  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join("-");
}

async function init() {
  if (initialised || typeof window === "undefined") return;
  initialised = true;

  queue = await readAll();
  rebuild();

  // Work survived a restart and is sitting on this device right now. Whatever
  // the browser's eviction policy is, this is the moment to opt out of it.
  if (queue.length > 0) void requestPersistence();

  // Reconnecting is the moment the queue is meant to drain.
  subscribeOnline(() => {
    if (getOnline()) void flush();
  });

  // A tab left open through an outage should not need a click to catch up,
  // and coming back to a backgrounded tab is the other common moment.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void flush();
  });

  if (!ticker) {
    ticker = setInterval(() => {
      if (mine().length > 0) void flush();
    }, RETRY_INTERVAL_MS);
  }

  void flush();
}

export type SubmitOutcome =
  /** The server has it. `data` is whatever the write produced, if anything. */
  | { ok: true; queued: false; data?: { invoiceId?: string } }
  /** Safe on the device, waiting for a connection. */
  | { ok: true; queued: true }
  /** The server looked at it and said no — show this to the user now. */
  | { ok: false; error: string };

/**
 * Queue a write and try to send it immediately.
 *
 * A rejection while the user is still looking at the form is reported back to
 * them and the item is dropped, because they are about to correct it. Only
 * work rejected later, during a background drain, ends up in the blocked list.
 */
export async function submit(
  op: OutboxBody & { label: string },
): Promise<SubmitOutcome> {
  await init();

  const item: OutboxItem = {
    ...op,
    id: newId(),
    userId: currentUser ?? "",
    createdAt: Date.now(),
    attempts: 0,
    lastError: null,
  };

  queue = [...queue, item];
  await writeItem(item);
  rebuild();

  watching.add(item.id);
  try {
    await flush();

    // flush() joins a drain already in progress, and that batch was assembled
    // before this item existed. Without a second pass the user would be told
    // their payment is "waiting to sync" a moment before it silently syncs.
    const missed = queue.some((q) => q.id === item.id) && !blockedIds.has(item.id);
    if (missed && getOnline()) await flush();
  } finally {
    watching.delete(item.id);
  }

  const still = queue.find((q) => q.id === item.id);
  if (!still) {
    const data = applied.get(item.id);
    applied.delete(item.id);
    return { ok: true, queued: false, data };
  }

  if (blockedIds.has(item.id)) {
    const error = still.lastError ?? "The server rejected it.";
    await discard(item.id);
    return { ok: false, error };
  }

  // It did not go out, so it is spending real time on this device. Ask now:
  // where the browser prompts, this is the point at which the question makes
  // sense to the person answering it.
  void requestPersistence();
  return { ok: true, queued: true };
}

export function flush(): Promise<void> {
  if (inFlight) return inFlight;
  inFlight = drain().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function drain(): Promise<void> {
  const pending = mine()
    .filter((item) => !blockedIds.has(item.id))
    .slice(0, MAX_BATCH);
  if (pending.length === 0) return;

  syncing = true;
  rebuild();

  try {
    const response = await fetch("/api/sync", {
      method: "POST",
      headers: { "content-type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({
        ops: pending.map(({ id, kind, body }) => ({ id, kind, body })),
      }),
    });

    // Any answer at all, even a refusal, proves the network is back. Waiting
    // for a 200 would keep the app showing "offline" through an outage that
    // was only ever an expired session.
    markOnline();

    if (response.status === 401) {
      needsSignIn = true;
      return;
    }
    if (!response.ok) {
      // A 5xx is the server's problem, not this device's — leave the queue be
      // and let the next tick try again.
      return;
    }

    needsSignIn = false;

    const { results } = (await response.json()) as SyncResponse;

    for (const result of results) {
      if (isSettled(result)) {
        if (result.status === "applied" && watching.has(result.id)) {
          applied.set(result.id, result.data);
        }
        queue = queue.filter((item) => item.id !== result.id);
        await deleteItem(result.id);
        continue;
      }
      if (result.status === "rejected") {
        blockedIds.add(result.id);
        queue = queue.map((item) =>
          item.id === result.id
            ? { ...item, attempts: item.attempts + 1, lastError: result.error }
            : item,
        );
        const updated = queue.find((item) => item.id === result.id);
        if (updated) await writeItem(updated);
      }
      // "skipped" keeps its place untouched and goes again next round.
    }

    lastSyncedAt = Date.now();
  } catch (error) {
    if (isNetworkError(error)) markOffline();
  } finally {
    syncing = false;
    rebuild();
  }

  // More waiting than one batch could carry.
  if (mine().some((item) => !blockedIds.has(item.id)) && getOnline()) {
    await drain();
  }
}

/** Un-block an item the user has decided to send again as-is. */
export async function retry(id: string): Promise<void> {
  blockedIds.delete(id);
  queue = queue.map((item) => (item.id === id ? { ...item, lastError: null } : item));
  rebuild();
  await flush();
}

export async function discard(id: string): Promise<void> {
  blockedIds.delete(id);
  queue = queue.filter((item) => item.id !== id);
  await deleteItem(id);
  rebuild();
}

export async function retryAll(): Promise<void> {
  blockedIds = new Set();
  rebuild();
  await flush();
}
