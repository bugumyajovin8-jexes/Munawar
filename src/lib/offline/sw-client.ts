"use client";

/**
 * The page's half of the conversation with the service worker.
 *
 * Everything here is best-effort. No service worker (unsupported browser,
 * first load before activation, a user who cleared storage) must ever stop the
 * app working — it only means this session has no offline copy.
 */

async function worker(): Promise<ServiceWorker | null> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return null;
  try {
    // `ready` rather than `controller`: on the very first load the worker is
    // active but has not claimed this page yet, and controller is still null.
    const registration = await navigator.serviceWorker.ready;
    return registration.active;
  } catch {
    return null;
  }
}

/** Tells the worker whose pages it is about to cache. Nothing is cached until it knows. */
export async function announceUser(userId: string): Promise<void> {
  (await worker())?.postMessage({ type: "user", userId });
}

/** Called on sign out. Destroys every cached page on this device. */
export async function purgeOfflineCaches(): Promise<void> {
  (await worker())?.postMessage({ type: "signout" });
}

export type WarmResult = {
  fetched: number;
  skipped: number;
  failed: number;
  stopped: boolean;
  busy: boolean;
};

const NO_WARM: WarmResult = {
  fetched: 0,
  skipped: 0,
  failed: 0,
  stopped: false,
  busy: false,
};

/** Small enough that one batch is never a long-running service worker event. */
const BATCH_SIZE = 12;

/**
 * Fetch these screens now so the first outage is not the first visit.
 *
 * Resolves when the run actually finishes rather than when the message is
 * posted, so a caller can report a real result. The timeout is generous
 * because the worker paces itself on purpose.
 */
export async function warmPages(paths: string[]): Promise<WarmResult> {
  const active = await worker();
  if (!active || typeof MessageChannel === "undefined") return NO_WARM;

  return new Promise((resolve) => {
    const channel = new MessageChannel();
    // One batch, paced. Generous, but not so generous that a worker killed
    // mid-batch leaves the caller hanging for a minute and a half.
    const timer = setTimeout(() => resolve(NO_WARM), 30_000);

    channel.port1.onmessage = (event) => {
      clearTimeout(timer);
      resolve({ ...NO_WARM, ...(event.data as Partial<WarmResult>) });
    };

    try {
      active.postMessage({ type: "warm", paths }, [channel.port2]);
    } catch {
      clearTimeout(timer);
      resolve(NO_WARM);
    }
  });
}

/**
 * Ask the server which screens are worth having, then have the worker fetch
 * them. The server decides because only it knows which invoices are unpaid and
 * which customers owe money — the whole point is to cache the working set
 * rather than everything.
 *
 * Save-Data is honoured. Someone who has told their browser they are counting
 * megabytes has been clear enough, and the app still works page by page.
 */
export async function warmFromManifest(): Promise<WarmResult> {
  const connection = (
    navigator as { connection?: { saveData?: boolean } }
  ).connection;
  if (connection?.saveData) return NO_WARM;

  if (!(await worker())) {
    // Worth saying out loud. A silent no-op here is exactly how this feature
    // managed to look like it was working while caching nothing at all.
    console.info("Munawar: no service worker yet, nothing saved for offline.");
    return NO_WARM;
  }

  let paths: string[];
  try {
    const response = await fetch("/api/offline-manifest", { cache: "no-store" });
    if (!response.ok) {
      console.info(`Munawar: could not read the offline list (${response.status}).`);
      return NO_WARM;
    }
    ({ paths } = (await response.json()) as { paths: string[] });
  } catch {
    // Offline, which means there is nothing to download and nothing to say.
    return NO_WARM;
  }

  /*
   * Sent in batches, because the browser is allowed to kill a service worker
   * that stays inside a single event too long — and it does. A hundred paced
   * fetches in one message was being terminated part way through, which looked
   * from the outside exactly like warming had worked.
   */
  const total: WarmResult = { ...NO_WARM };

  for (let i = 0; i < paths.length; i += BATCH_SIZE) {
    const batch = await warmPages(paths.slice(i, i + BATCH_SIZE));

    total.fetched += batch.fetched;
    total.skipped += batch.skipped;
    total.failed += batch.failed;
    total.busy ||= batch.busy;

    if (batch.stopped || batch.busy) {
      total.stopped = batch.stopped;
      break;
    }
  }

  console.info(
    `Munawar: offline pages — ${total.fetched} saved, ${total.skipped} already current` +
      `${total.failed ? `, ${total.failed} unavailable` : ""}` +
      `${total.stopped ? " (stopped, connection lost)" : ""}`,
  );

  return total;
}

/** How many screens this device currently has saved. */
export async function cachedPageCount(): Promise<number> {
  const active = await worker();
  if (!active || typeof MessageChannel === "undefined") return 0;

  return new Promise((resolve) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => resolve(0), 1_500);
    channel.port1.onmessage = (event) => {
      clearTimeout(timer);
      resolve(typeof event.data?.pages === "number" ? event.data.pages : 0);
    };
    try {
      active.postMessage({ type: "stats" }, [channel.port2]);
    } catch {
      clearTimeout(timer);
      resolve(0);
    }
  });
}

