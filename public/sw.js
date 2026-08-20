/*
 * Service worker: makes the app installable, and makes it survive an outage.
 *
 * The rule this file is built around: never show one person another person's
 * figures. A cached invoice list is genuinely useful on a bus with no signal,
 * and genuinely dangerous on a shared phone. So pages are cached into a store
 * keyed by the signed-in user id, and every page cache is destroyed on sign
 * out. A device that has never been told who is using it caches nothing.
 *
 * Strategy per request type:
 *   navigations      stale while revalidate — the cached copy goes back at
 *                    once and the network refreshes it behind; /offline if
 *                    this device has never seen the page. FreshnessGuard on
 *                    the client re-fetches so the figures catch up
 *   /_next/static/   cache first — content-hashed, so it cannot go stale
 *   RSC payloads     never served from cache, but they are what tells us a
 *                    page was visited, so each one quietly pulls that page's
 *                    document into the cache behind it. See onRscRequest.
 *   /api/, /auth/    never touched. Credentials and queue traffic must always
 *                    reach the network or fail honestly.
 *
 * Writes are not handled here — they go through the IndexedDB outbox in
 * src/lib/offline, which retries them against /api/sync.
 */

const VERSION = "v13";
const SHELL_CACHE = `munawar-shell-${VERSION}`;
const META_CACHE = `munawar-meta-${VERSION}`;
const PAGE_PREFIX = `munawar-pages-${VERSION}-`;

const OFFLINE_URL = "/offline";
const SHELL_ASSETS = [OFFLINE_URL, "/icon.svg", "/icon-192.png", "/icon-512.png"];

/**
 * Comfortably above what the manifest asks for, so ad-hoc browsing on top of a
 * full warm run does not start evicting the pages that were warmed on purpose.
 * At roughly 60 KB of HTML each this is about 15 MB against a multi-gigabyte
 * quota — the limit exists to stop unbounded growth, not to ration space.
 */
const MAX_PAGES = 250;

/**
 * Ceiling on a single warm message, whatever it is handed.
 *
 * The client sends the manifest in small batches rather than in one go. A
 * browser will kill a service worker that sits inside one event for too long,
 * and a hundred paced fetches is comfortably too long — the old single-shot run
 * was being terminated part way through and losing the rest of the list.
 * Batching keeps every event short enough to survive.
 */
const MAX_WARM = 24;
/** Consecutive transport failures that mean the network has gone, not the page. */
const OFFLINE_STREAK = 3;
/** Cached more recently than this is left alone — most of a run is skips. */
const WARM_FRESH_MS = 60 * 60 * 1000;
/** Politeness gap, so warming never competes with the screen in front of you. */
const WARM_GAP_MS = 150;

/** Signed out, or on a page that must never be replayed from disk. */
const NEVER_CACHE = ["/login", "/auth", "/onboarding", "/api", "/i/", "/offline"];

const USER_KEY = "/__munawar/user";

// ---------------------------------------------------------------- install --

/**
 * The offline page is useless without the stylesheet that makes it legible.
 * Its asset filenames are content-hashed and change every build, so they are
 * read out of the page's own markup at install time rather than hard-coded.
 */
async function precacheOfflineAssets(cache) {
  try {
    const html = await (await fetch(OFFLINE_URL, { cache: "reload" })).text();

    const assets = new Set();
    for (const match of html.matchAll(/(?:src|href)="(\/_next\/static\/[^"]+)"/g)) {
      assets.add(match[1]);
    }

    await Promise.all([...assets].map((url) => cache.add(url).catch(() => {})));
  } catch {
    // Installed while offline. The page still renders; it may just be plain.
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then(async (cache) => {
        // Individually, so one missing icon cannot fail the whole install.
        await Promise.all(SHELL_ASSETS.map((url) => cache.add(url).catch(() => {})));
        await precacheOfflineAssets(cache);
      })
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter(
              (key) =>
                key.startsWith("munawar-") &&
                key !== SHELL_CACHE &&
                key !== META_CACHE &&
                !key.startsWith(PAGE_PREFIX),
            )
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

// ------------------------------------------------------------ who is this --

/**
 * The user id has to outlive the worker, because the worst case is exactly the
 * one where nobody can tell us: the app launched from the home screen with no
 * connection. So it lives in the Cache API, which is the only durable store a
 * service worker can read synchronously enough to be useful here.
 */
let userIdPromise = null;

function currentUserId() {
  if (!userIdPromise) {
    userIdPromise = caches
      .open(META_CACHE)
      .then((cache) => cache.match(USER_KEY))
      .then((response) => (response ? response.text() : null))
      .catch(() => null);
  }
  return userIdPromise;
}

async function setUserId(userId) {
  const previous = await currentUserId();
  if (previous && previous !== userId) await purgePages();

  userIdPromise = Promise.resolve(userId);
  const cache = await caches.open(META_CACHE);
  await cache.put(USER_KEY, new Response(userId));
}

async function purgePages() {
  userIdPromise = Promise.resolve(null);
  const keys = await caches.keys();
  await Promise.all(
    keys.filter((key) => key.startsWith(PAGE_PREFIX)).map((key) => caches.delete(key)),
  );
  const meta = await caches.open(META_CACHE);
  const metaKeys = await meta.keys();
  await Promise.all(metaKeys.map((request) => meta.delete(request)));
}

// -------------------------------------------------------------- page cache --

function cacheableNavigation(url) {
  if (url.origin !== self.location.origin) return false;
  return !NEVER_CACHE.some(
    (prefix) => url.pathname === prefix || url.pathname.startsWith(`${prefix}/`),
  );
}

/** One key per path+query, so /invoices?status=overdue keeps its own copy. */
function pageKey(url) {
  return `${url.pathname}${url.search}`;
}

function timeKey(url) {
  return `/__munawar/time?p=${encodeURIComponent(pageKey(url))}`;
}

async function pageCache() {
  const userId = await currentUserId();
  if (!userId) return null;
  return caches.open(`${PAGE_PREFIX}${userId}`);
}

async function storePage(url, response) {
  const cache = await pageCache();
  if (!cache) return;

  await cache.put(pageKey(url), response);

  // The timestamp is kept beside the page rather than injected into its
  // headers: re-wrapping a response means re-declaring content-encoding, and
  // getting that wrong serves a gzip stream the browser will not decode.
  const meta = await caches.open(META_CACHE);
  await meta.put(timeKey(url), new Response(String(Date.now())));

  const keys = await cache.keys();
  if (keys.length > MAX_PAGES) {
    // keys() is insertion-ordered, so the front of the list is the oldest.
    await Promise.all(
      keys.slice(0, keys.length - MAX_PAGES).map((request) => cache.delete(request)),
    );
  }
}

/** How recently a page was cached, or null if it never was. */
async function pageAge(url) {
  try {
    const meta = await caches.open(META_CACHE);
    const response = await meta.match(timeKey(url));
    if (!response) return null;
    return Date.now() - Number(await response.text());
  } catch {
    return null;
  }
}

let warming = false;

/**
 * Reports what it did when it finishes, so the caller can show a real result
 * instead of guessing with a timer. `skipped` being most of the total is the
 * healthy case — it means the device was already up to date.
 */
async function warm(paths, port) {
  const result = { fetched: 0, skipped: 0, failed: 0, stopped: false, busy: false };

  // Two warms racing would double the requests and halve nobody's wait.
  if (warming) {
    result.busy = true;
    port?.postMessage(result);
    return result;
  }
  if (!(await pageCache())) {
    port?.postMessage(result);
    return result;
  }

  warming = true;
  try {
    // One page this role cannot open must not end the run. Only the network
    // dropping should, and that shows up as several failures in a row.
    let consecutiveOffline = 0;

    for (const path of paths.slice(0, MAX_WARM)) {
      let url;
      try {
        url = new URL(path, self.location.origin);
      } catch {
        continue;
      }
      if (url.origin !== self.location.origin) continue;

      const outcome = await cacheDocument(url);

      if (outcome === "skipped") {
        result.skipped += 1;
        continue;
      }

      if (outcome === "offline") {
        result.failed += 1;
        consecutiveOffline += 1;
        if (consecutiveOffline >= OFFLINE_STREAK) {
          result.stopped = true;
          break;
        }
        continue;
      }

      consecutiveOffline = 0;
      if (outcome === "stored") result.fetched += 1;
      else result.failed += 1;

      await new Promise((resolve) => setTimeout(resolve, WARM_GAP_MS));
    }
  } finally {
    warming = false;
  }

  port?.postMessage(result);
  return result;
}

async function readPage(url) {
  const cache = await pageCache();
  if (!cache) return null;
  return (await cache.match(pageKey(url))) ?? null;
}

/**
 * Fetch a page's document and store it, unless a recent copy is already here.
 *
 * Requests the worker makes itself do not re-enter this worker's fetch handler,
 * so there is no recursion to guard against.
 */
async function cacheDocument(url) {
  if (!cacheableNavigation(url)) return "rejected";
  if (!(await pageCache())) return "rejected";

  const age = await pageAge(url);
  if (age !== null && age < WARM_FRESH_MS) return "skipped";

  let response;
  try {
    response = await fetch(url.href, { credentials: "same-origin" });
  } catch {
    // fetch() only rejects on transport failure, so this is the network being
    // gone rather than the server objecting to anything.
    return "offline";
  }

  // A redirect is the session having expired, or a page this role may not
  // open. Neither is worth keeping, and neither says anything about the
  // connection, so a caller working through a list should keep going.
  if (!response.ok || response.redirected) return "rejected";

  const type = response.headers.get("content-type") || "";
  if (!type.includes("text/html")) return "rejected";

  await storePage(url, response);
  return "stored";
}

/*
 * Clicking a link is not a navigation, and that is the whole bug this exists
 * to fix.
 *
 * The App Router does not navigate between pages — it fetches an RSC payload
 * and re-renders in place. The browser reports those as ordinary fetches, so a
 * worker that only watches for `mode === "navigate"` sees exactly one request
 * per session: the document you first loaded. Every screen reached by clicking
 * was invisible to it, and therefore never cached. The app appeared to remember
 * pages only because Next keeps visited routes in memory for the life of the
 * tab; closing the tab threw that away and revealed that nothing had ever been
 * written to disk.
 *
 * So the RSC request is left to the network untouched — replaying a payload
 * built for a different router state would corrupt the client — but it is
 * treated as the signal it is: this user just opened this page, so fetch the
 * real document behind their back and keep it. Offline, the RSC fetch fails,
 * Next falls back to a full browser navigation, and that navigation finds the
 * document sitting in the cache.
 *
 * Prefetches are deliberately excluded. Those fire on hover, and turning a
 * mouse crossing a table of fifty rows into fifty page renders would cost more
 * than it ever saved.
 */
function isRscRequest(request, url) {
  return request.headers.get("RSC") === "1" || url.searchParams.has("_rsc");
}

function onRscRequest(event, request, url) {
  if (request.headers.get("Next-Router-Prefetch") === "1") return;

  // `_rsc` is a build hash Next appends to bust its own caches. The document
  // lives at the same path without it, and leaving it on would file the page
  // under a key no navigation will ever ask for.
  const document = new URL(url.href);
  document.searchParams.delete("_rsc");

  event.waitUntil(cacheDocument(document));
}

/**
 * The page the browser actually navigates to. The original request is passed
 * through untouched so the browser handles any redirect itself.
 *
 * Note what is NOT checked here: response.redirected. A navigation request
 * carries redirect:"manual", so a bounce to /login comes back as an opaque
 * response — type "opaqueredirect", status 0, no Location to read. That is
 * why the guard is `response.ok`, which an opaque redirect fails. Checking
 * `redirected` here looks right and silently never fires.
 */
async function fetchFresh(url, request) {
  const response = await fetch(request);

  if (response.ok && response.type !== "opaqueredirect" && cacheableNavigation(url)) {
    const type = response.headers.get("content-type") || "";
    if (type.includes("text/html")) await storePage(url, response.clone());
  }
  return response;
}

/**
 * The refresh that runs behind a cache hit. Nobody is waiting on this response,
 * so it is issued as a fresh request rather than the navigation one.
 *
 * An earlier version destroyed the entire page cache whenever this landed on
 * /login, reasoning that the session must have expired. That was wrong, and
 * badly so. This request races the page's own request, and Supabase rotates
 * refresh tokens — so a perfectly valid session can lose that race, bounce to
 * /login once, and take every cached page on the device with it. The symptom
 * is an app that appears to forget everything each time it is reopened.
 *
 * Purging is now only ever done by an explicit sign out, which is the one
 * moment we actually know what happened. A genuinely expired session needs no
 * help from here: nothing new gets cached, and the first real navigation or
 * refresh lands the user on the login page by itself.
 */
async function revalidate(url) {
  const response = await fetch(url.href, { credentials: "same-origin" });
  if (response.redirected || !response.ok) return;

  if (cacheableNavigation(url)) {
    const type = response.headers.get("content-type") || "";
    if (type.includes("text/html")) await storePage(url, response);
  }
}

async function handleNavigation(event, request) {
  const url = new URL(request.url);

  /*
   * Stale while revalidate.
   *
   * A cached copy goes back immediately and the network runs behind it. This
   * is why the app felt faster with no signal than with one: offline it was
   * reading from disk, online it was waiting on Vercel waiting on Supabase.
   * There is no reason the online path should be the slow one.
   *
   * What makes it safe to show figures from disk is that they do not stay
   * there: FreshnessGuard re-fetches as soon as the page is running, so the
   * screen catches up within a moment of appearing. The cache buys the paint,
   * not the truth.
   */
  const cached = await readPage(url);
  if (cached) {
    event.waitUntil(
      revalidate(url).catch(() => {
        // Still offline. The copy just served is the best there is.
      }),
    );
    return cached;
  }

  // Nothing cached, so this is the first time this device has asked for this
  // screen. There is no shortcut available; go to the network and fall back to
  // the offline page if it is not there.
  try {
    return await fetchFresh(url, request);
  } catch (error) {
    const offline = await caches.match(OFFLINE_URL, { cacheName: SHELL_CACHE });
    if (!offline) throw error;

    // The offline page asking for itself. Serving it here is the base case;
    // redirecting would point it at itself forever.
    if (url.pathname === OFFLINE_URL) return offline;

    /*
     * Otherwise redirect rather than serve /offline's HTML under the requested
     * URL.
     *
     * That shortcut looks fine for a second and then falls apart: the App
     * Router hydrates with the offline page's payload while believing it is on
     * /customers, notices the mismatch, tries to refetch, fails, and drops the
     * user on an error screen — strictly worse than no offline page at all.
     * Redirecting keeps the URL and the document in agreement.
     */
    return Response.redirect(new URL(OFFLINE_URL, self.location.origin).href, 302);
  }
}

// ------------------------------------------------------------------ fetch ---

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/auth/")) return;

  if (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname === "/icon.svg" ||
    url.pathname === "/icon-maskable.svg" ||
    url.pathname === "/icon-192.png" ||
    url.pathname === "/icon-512.png" ||
    url.pathname === "/apple-touch-icon.png"
  ) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ??
          fetch(request).then((response) => {
            if (response.ok) {
              const copy = response.clone();
              caches.open(SHELL_CACHE).then((cache) => cache.put(request, copy));
            }
            return response;
          }),
      ),
    );
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(handleNavigation(event, request));
    return;
  }

  // Not answered from cache — only used as a signal that a page was opened.
  if (isRscRequest(request, url)) onRscRequest(event, request, url);
});

// --------------------------------------------------------------- messages ---

self.addEventListener("message", (event) => {
  const data = event.data;
  if (!data || typeof data !== "object") return;

  if (data.type === "user" && typeof data.userId === "string") {
    event.waitUntil(setUserId(data.userId));
    return;
  }

  if (data.type === "signout") {
    event.waitUntil(purgePages());
    return;
  }

  /**
   * Pull the screens down before they are needed. Visiting a page is what
   * normally caches it, which would mean the first outage is always the one
   * where the page you wanted was never opened.
   *
   * Three rules keep this from becoming a data bill:
   *
   *   - anything cached in the last hour is skipped, so the second run of the
   *     day costs almost nothing and only new invoices are actually fetched
   *   - one page at a time with a gap between, so it never competes with what
   *     the user is doing right now
   *   - the first network failure ends the run — offline is not the moment to
   *     keep retrying a download
   */
  if (data.type === "warm" && Array.isArray(data.paths)) {
    event.waitUntil(warm(data.paths, event.ports[0]));
    return;
  }

  /** "How much of the app do I actually have?" — shown in the sync panel. */
  if (data.type === "stats" && event.ports[0]) {
    const port = event.ports[0];
    event.waitUntil(
      (async () => {
        try {
          const cache = await pageCache();
          port.postMessage({ pages: cache ? (await cache.keys()).length : 0 });
        } catch {
          port.postMessage({ pages: 0 });
        }
      })(),
    );
    return;
  }

});
