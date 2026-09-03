"use client";

/**
 * Connectivity, as observed rather than as claimed.
 *
 * `navigator.onLine` only tells you whether a network interface exists. On a
 * phone that has drifted to the edge of a mast, or on hotel wifi that wants
 * you to log in first, it happily reports true while every request dies. So
 * this store trusts two things: the browser's offline event (fast, reliable
 * when the radio is genuinely off) and an actual failed request.
 *
 * Recovery is never assumed either — once offline, it polls a real endpoint
 * until one succeeds.
 */

type Listener = () => void;

const listeners = new Set<Listener>();
let online = true;
let started = false;
let attempt = 0;
let timer: ReturnType<typeof setTimeout> | null = null;

/** Stepped, capped. Long outages should not hammer the radio and the battery. */
const BACKOFF_MS = [2_000, 4_000, 8_000, 15_000];

function emit() {
  for (const listener of listeners) listener();
}

function stopPolling() {
  if (timer) clearTimeout(timer);
  timer = null;
  attempt = 0;
}

/**
 * A dead connection is not always a fast failure. Refused connections reject in
 * milliseconds, but a phone holding a mast it cannot actually reach will leave
 * a request hanging until the browser gives up, which can be half a minute.
 * Anything waiting on this answer would wait that long too, so the question is
 * asked with a deadline: no reply in four seconds is an answer.
 */
const PROBE_TIMEOUT_MS = 4_000;

async function probe(): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const response = await fetch("/api/ping", {
      method: "HEAD",
      cache: "no-store",
      signal: controller.signal,
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

function scheduleProbe() {
  if (timer) return;
  const delay = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)];
  attempt += 1;
  timer = setTimeout(async () => {
    timer = null;
    if (await probe()) markOnline();
    else if (!online) scheduleProbe();
  }, delay);
}

function start() {
  if (started || typeof window === "undefined") return;
  started = true;

  online = navigator.onLine;
  window.addEventListener("offline", markOffline);
  window.addEventListener("online", () => {
    // The event means "an interface came up", not "the server is reachable".
    // Confirm before telling the app it can save again.
    stopPolling();
    void probe().then((ok) => (ok ? markOnline() : scheduleProbe()));
  });

  if (!online) scheduleProbe();
}

/**
 * Is the server actually reachable, right now?
 *
 * Anything that reacts to failure by navigating must ask this first. A failed
 * RSC fetch makes Next fall back to a full browser navigation, so "try it and
 * see" is not a safe way to discover you are offline — it reloads the page,
 * which remounts whatever tried, which tries again. One cheap HEAD request up
 * front costs nothing and breaks that cycle before it starts.
 */
export async function canReachServer(): Promise<boolean> {
  const reachable = await probe();
  if (reachable) markOnline();
  else markOffline();
  return reachable;
}

export function markOnline() {
  stopPolling();
  if (online) return;
  online = true;
  emit();
}

export function markOffline() {
  if (online) {
    online = false;
    emit();
  }
  scheduleProbe();
}

export function getOnline(): boolean {
  return online;
}

/** Rendering on the server, and the first client render, always assume online. */
export function getServerOnline(): boolean {
  return true;
}

export function subscribeOnline(listener: Listener): () => void {
  start();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * A failed fetch and a rejected request look nothing alike and must not be
 * treated alike: "you are offline" retries later, "the amount is negative"
 * never will. fetch() only rejects for transport failures, so a TypeError here
 * genuinely means the request never reached a server.
 */
export function isNetworkError(error: unknown): boolean {
  if (error instanceof TypeError) return true;
  if (error instanceof DOMException && error.name === "AbortError") return true;
  return false;
}
