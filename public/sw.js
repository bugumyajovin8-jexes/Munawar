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
 *   navigations      network first, then the cached copy, then /offline. The
 *                    network only gets a deadline when there is something on
 *                    disk to fall back to; with an empty cache, waiting beats
 *                    giving up
 *   /_next/static/   cache first — content-hashed, so it cannot go stale
 *   RSC payloads     never served from cache, but they are what tells us a
 *                    page was visited, so each one quietly pulls that page's
 *                    document into the cache behind it. See onRscRequest.
 *   /api/, /auth/    never touched. Credentials and queue traffic must always
 *                    reach the network or fail honestly.
 *
 * Writes are not handled here — they go through the IndexedDB outbox in
 * src/lib/offline, which retries them against /api/sync.
 *
 * The second rule, learned the hard way: a cached document belongs to the
 * build that produced it and to no other. Every cache below is named after
 * either the build or nothing, and there is no third option. See BUILD.
 */

/*
 * Which build this worker belongs to.
 *
 * This used to be a version string edited by hand, and it was keyed to
 * nothing: shipping the app does not change this file, so a document cached
 * under one build stayed valid under every build after it. A document names
 * the script files of the build that produced it, those names are content
 * hashes, and the ones that changed do not exist in the new deployment — they
 * answer 404. Serving such a page hands the browser HTML whose code will never
 * load. That is the app that shows the old screen, ignores every click, and
 * appears to come back only when you refresh.
 *
 * The build id now arrives in this worker's own URL: the page registers
 * /sw.js?v=<build>. That serves two purposes at once. A changed script URL is
 * what makes the browser install a new worker in the first place, and reading
 * it here means this worker knows which build it belongs to before it answers
 * a single request — with no build step writing into this file, and nothing
 * left for anyone to remember to bump.
 */
const BUILD = new URLSearchParams(self.location.search || "").get("v") || "unversioned";

/* Everything in these names this build's code, so they go when the build goes. */
const SHELL_CACHE = `munawar-shell-${BUILD}`;
const META_CACHE = `munawar-meta-${BUILD}`;
const PAGE_PREFIX = `munawar-pages-${BUILD}-`;

/*
 * These two deliberately outlive a deployment.
 *
 * ASSET_CACHE holds /_next/static files, whose names are content hashes — the
 * entire point of which is that one name is the same bytes forever. Clearing
 * them on every deploy would make each release re-download the whole app over
 * the sort of connection this worker exists for. What changed has a new name
 * and is fetched; what did not is already here.
 *
 * IDENTITY_CACHE holds one thing: who is signed in. If that were scoped to the
 * build, every deploy would leave the worker not knowing whose pages it may
 * cache — and a worker that does not know caches nothing, silently.
 */
const ASSET_CACHE = "munawar-assets";
const IDENTITY_CACHE = "munawar-identity";
const KEEP = [SHELL_CACHE, META_CACHE, ASSET_CACHE, IDENTITY_CACHE];

const OFFLINE_URL = "/offline";
/** Build-specific: the offline document names this build's stylesheet. */
const SHELL_ASSETS = [OFFLINE_URL];
/** Not build-specific, and wanted before anyone has signed in. */
const ICON_ASSETS = ["/logo-mark.png", "/icon-192.png", "/icon-512.png"];

/**
 * Content-hashed files never go stale, so this cache is bounded by count
 * rather than by age. keys() is insertion-ordered, so the front of the list is
 * the oldest — which, after a deploy or two, is a build nobody is running.
 */
const MAX_ASSETS = 400;

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
/**
 * Politeness gap, so warming never competes with the screen in front of you.
 *
 * Every one of these is a page render behind an auth check, so the gap is
 * throughput control as much as courtesy: at 150ms this was firing nearly
 * seven requests a second at the same middleware the user's own navigation
 * has to get through, which is how a background nicety became a 504 on the
 * screen somebody was actually looking at.
 */
const WARM_GAP_MS = 400;

/**
 * How long a navigation waits for the network before falling back to disk.
 *
 * Long enough that an ordinary mobile connection wins and the document matches
 * the deployed build; short enough that somebody with no signal is not left
 * looking at a white screen. See handleNavigation.
 */
const NAVIGATION_TIMEOUT_MS = 3000;

/** Signed out, or on a page that must never be replayed from disk. */
const NEVER_CACHE = ["/login", "/auth", "/onboarding", "/api", "/i/", "/offline"];

const USER_KEY = "/__munawar/user";

// ---------------------------------------------------------------- install --

/**
 * The offline page is useless without the stylesheet that makes it legible.
 * Its asset filenames are content-hashed and change every build, so they are
 * read out of the page's own markup at install time rather than hard-coded.
 *
 * They go into the asset cache rather than the shell, because that is what
 * they are — the page itself is the build-specific half, and it is what the
 * shell cache holds.
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
    (async () => {
      const [shell, assets] = await Promise.all([
        caches.open(SHELL_CACHE),
        caches.open(ASSET_CACHE),
      ]);

      // Individually, so one missing icon cannot fail the whole install.
      await Promise.all([
        ...SHELL_ASSETS.map((url) => shell.add(url).catch(() => {})),
        ...ICON_ASSETS.map((url) => assets.add(url).catch(() => {})),
      ]);
      await precacheOfflineAssets(assets);

      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      /*
       * Anything belonging to a build that is no longer running goes now, and
       * this is the moment that makes a deploy safe: the documents naming the
       * previous build's scripts are destroyed before there is any chance of
       * serving one against the current build.
       *
       * A new worker only exists at all because the script URL carried a new
       * build id, so reaching here means the build really did change.
       */
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter(
            (key) =>
              key.startsWith("munawar-") &&
              !KEEP.includes(key) &&
              !key.startsWith(PAGE_PREFIX),
          )
          .map((key) => caches.delete(key)),
      );

      await self.clients.claim();
    })(),
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
      .open(IDENTITY_CACHE)
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
  const cache = await caches.open(IDENTITY_CACHE);
  await cache.put(USER_KEY, new Response(userId));
}

/**
 * Called on sign out, and only on sign out.
 *
 * An earlier version also purged whenever a background refresh happened to
 * land on /login, reasoning that the session must have expired. That was wrong
 * and badly so: Supabase rotates refresh tokens, so a perfectly valid session
 * can lose a race, bounce to /login once, and take every cached page on the
 * device with it. The symptom was an app that appeared to forget everything
 * each time it was opened. An expired session needs no help from here —
 * nothing new gets cached and the next navigation lands on the login page by
 * itself.
 */
async function purgePages() {
  userIdPromise = Promise.resolve(null);

  const keys = await caches.keys();
  await Promise.all(
    keys
      // Every build's pages, not just this one's. Somebody signing out means
      // none of it may stay, whichever release wrote it.
      .filter((key) => key.startsWith("munawar-pages-"))
      .map((key) => caches.delete(key)),
  );

  // The timestamps that say how fresh those pages were, and the record of who
  // was signed in. Assets are left: they are the app's own code, identical for
  // everyone, and re-downloading them would punish the next person to sign in.
  await Promise.all([caches.delete(META_CACHE), caches.delete(IDENTITY_CACHE)]);
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
    /*
     * keys() is insertion-ordered, so the front of the list is the oldest.
     *
     * The timestamp goes with the page. Leaving it behind is worse than
     * untidy: a warm run reads it, sees a page cached twenty minutes ago,
     * and skips a page that is no longer there — so the screens evicted for
     * being least used become the ones that are never fetched again. The
     * meta cache also grew without bound, one dead entry per eviction.
     */
    await Promise.all(
      keys.slice(0, keys.length - MAX_PAGES).map(async (request) => {
        await cache.delete(request);
        try {
          await meta.delete(timeKey(new URL(request.url)));
        } catch {
          // A key we cannot parse is one no page will ask for either.
        }
      }),
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
async function fetchFresh(url, request, event) {
  const response = await fetch(request);

  if (response.ok && response.type !== "opaqueredirect" && cacheableNavigation(url)) {
    const type = response.headers.get("content-type") || "";
    if (type.includes("text/html")) {
      // waitUntil, not await. Writing the page to disk is bookkeeping for the
      // next visit; awaiting it made every single load wait for the whole
      // document to be read out and stored before the browser saw a byte.
      event.waitUntil(storePage(url, response.clone()));
    }
  }
  return response;
}

/** Told apart from a real Response, which is the only other thing racing. */
const TIMED_OUT = Symbol("timed out");
const FAILED = Symbol("failed");

async function handleNavigation(event, request) {
  const url = new URL(request.url);

  /*
   * Network first, with what is on disk behind it.
   *
   * This used to serve the cached copy immediately and refresh behind it,
   * which is the right shape for data and precisely the wrong one for a
   * document whose script filenames change with every deploy. That is now
   * handled at the root — the page cache belongs to one build and is destroyed
   * with it — so a cached page can only ever name code this deployment is
   * still serving. Preferring the network is still right: it is how a page
   * edited an hour ago is the page you get.
   *
   * A navigation is not the common case anyway. Clicking a link inside the app
   * is an RSC fetch, handled elsewhere. This runs when somebody opens the app,
   * reloads, or follows a link in.
   */
  const network = fetchFresh(url, request, event);
  // Attached now so a rejection during the cache read below is never loose.
  network.catch(() => {});

  const cached = await readPage(url);

  if (cached) {
    /*
     * There is something to fall back to, so the network gets a deadline.
     * navigator.onLine cannot be trusted — a phone holding a mast it cannot
     * reach reports true — so rather than ask, this tries and gives up.
     *
     * The request is not aborted when the deadline passes. It is left running
     * and its result still refreshes the cache, so a connection too slow to
     * win the race at least makes the next visit fast. Aborting also meant
     * handing fetch() an init object, which rebuilds the Request and quietly
     * downgrades a navigation's mode in the process.
     */
    const winner = await Promise.race([
      network.catch(() => FAILED),
      new Promise((resolve) => setTimeout(() => resolve(TIMED_OUT), NAVIGATION_TIMEOUT_MS)),
    ]);

    if (winner !== TIMED_OUT && winner !== FAILED) return winner;

    event.waitUntil(network.catch(() => {}));
    return cached;
  }

  /*
   * Nothing on disk for this page, so there is nothing to be gained by giving
   * up early — a slow answer beats the offline screen every time. This is the
   * ordinary case on the first load after a deploy, when this build's page
   * cache is still empty, and it is exactly when a deadline would have been
   * most harmful.
   */
  try {
    return await network;
  } catch {
    // Genuinely no network. The offline page is all that is left.
  }

  const offline = await caches.match(OFFLINE_URL, { cacheName: SHELL_CACHE });
  if (!offline) return Response.error();

  // The offline page asking for itself. Serving it here is the base case;
  // redirecting would point it at itself forever.
  if (url.pathname === OFFLINE_URL) return offline;

  /*
   * Otherwise redirect rather than serve /offline's HTML under the requested
   * URL.
   *
   * That shortcut looks fine for a second and then falls apart: the App Router
   * hydrates with the offline page's payload while believing it is on
   * /customers, notices the mismatch, tries to refetch, fails, and drops the
   * user on an error screen — strictly worse than no offline page at all.
   * Redirecting keeps the URL and the document in agreement.
   */
  return Response.redirect(new URL(OFFLINE_URL, self.location.origin).href, 302);
}

// ------------------------------------------------------------------ fetch ---

/**
 * Cache first, and safely so: every one of these is either content-hashed or
 * an icon that changes only when the app is redeployed.
 *
 * Kept apart from the page cache and not scoped to the build. A cached page
 * is only usable by the build that wrote it; a cached chunk is usable by any
 * build that asks for that exact name, which is what a content hash means. So
 * a deploy re-downloads what changed and nothing else.
 */
async function handleAsset(event, request) {
  const cache = await caches.open(ASSET_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (response.ok) {
    const copy = response.clone();
    event.waitUntil(cache.put(request, copy).then(() => trimAssets(cache)));
  }
  return response;
}

async function trimAssets(cache) {
  const keys = await cache.keys();
  if (keys.length <= MAX_ASSETS) return;
  await Promise.all(keys.slice(0, keys.length - MAX_ASSETS).map((key) => cache.delete(key)));
}


self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/auth/")) return;

  if (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname === "/logo-mark.png" ||
    url.pathname === "/icon-192.png" ||
    url.pathname === "/icon-512.png" ||
    url.pathname === "/apple-touch-icon.png"
  ) {
    event.respondWith(handleAsset(event, request));
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
