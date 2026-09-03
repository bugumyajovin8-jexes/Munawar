/*
 * Drives public/sw.js in Node against a mocked Cache API.  `npm run test:sw`
 *
 * This exists because the service worker has failed silently twice, and both
 * times it looked from the outside like it was working. Nothing about the page
 * cache is observable from the app: a worker that caches nothing behaves like
 * one that caches everything until the tab is closed, because Next keeps
 * visited routes in memory for the life of the tab and hides the difference.
 *
 * The worker is plain JavaScript with no dependency on Next, so its logic can
 * be exercised directly and deterministically. What is checked is the thing
 * that was actually broken — what gets written to the page cache, and when —
 * plus the two rules that must never regress: pages are partitioned by user,
 * and signing out destroys them.
 */
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const ORIGIN = "https://app.test";
const BUILD = "buildone";

// ------------------------------------------------------------ cache mock ---

class MockCache {
  constructor() {
    this.map = new Map();
  }
  key(k) {
    if (typeof k === "string") return k;
    if (k && k.__key) return k.__key;
    return k.url;
  }
  async put(k, v) {
    this.map.set(this.key(k), v);
  }
  async match(k) {
    return this.map.get(this.key(k));
  }
  async keys() {
    return [...this.map.keys()].map((k) => ({ __key: k }));
  }
  async delete(k) {
    return this.map.delete(this.key(k));
  }
  async add() {
    /* install-time only */
  }
}

const store = new Map();
const caches = {
  async open(name) {
    if (!store.has(name)) store.set(name, new MockCache());
    return store.get(name);
  },
  async keys() {
    return [...store.keys()];
  },
  async delete(name) {
    return store.delete(name);
  },
  async match(k, opts) {
    if (opts?.cacheName) return (await caches.open(opts.cacheName)).match(k);
    for (const c of store.values()) {
      const hit = await c.match(k);
      if (hit) return hit;
    }
  },
};

// ------------------------------------------------------------ fetch mock ---

let routes = {};
const fetchLog = [];

function html(body = "<html></html>") {
  return {
    ok: true,
    redirected: false,
    status: 200,
    type: "basic",
    headers: new Map([["content-type", "text/html; charset=utf-8"]]),
    body,
    clone() {
      return this;
    },
  };
}
// Node's Headers is fine, but a Map with .get() is all sw.js asks for.
function withGet(res) {
  if (res && res.headers instanceof Map) {
    const m = res.headers;
    res.headers = { get: (k) => m.get(k.toLowerCase()) ?? null };
  }
  return res;
}

async function mockFetch(input) {
  const url = typeof input === "string" ? input : input.url;
  const path = new URL(url).pathname;
  fetchLog.push(new URL(url).pathname + new URL(url).search);

  const route = routes[path] ?? "ok";
  if (route === "offline") throw new TypeError("Failed to fetch");
  // Slower than the deadline, but it does arrive.
  if (route === "slow") {
    await new Promise((resolve) => setTimeout(resolve, 60));
    return withGet(html(path));
  }
  // Never arrives at all.
  if (route === "hang") return new Promise(() => {});
  if (route === "redirect")
    return withGet({ ...html(), ok: true, redirected: true });
  if (route === "notfound") return withGet({ ...html(), ok: false, status: 404 });
  return withGet(html(path));
}

// ------------------------------------------------------------- sw harness --

const handlers = {};
const sandbox = {
  self: {
    addEventListener: (type, fn) => {
      handlers[type] = fn;
    },
    // The worker reads its build id out of its own URL; see BUILD in sw.js.
    location: { origin: ORIGIN, search: `?v=${BUILD}`, href: `${ORIGIN}/sw.js?v=${BUILD}` },
    skipWaiting: async () => {},
    clients: { claim: async () => {} },
  },
  caches,
  fetch: mockFetch,
  URL,
  Response: class {
    constructor(body) {
      this.body = body;
    }
    async text() {
      return String(this.body);
    }
    static redirect(url, status) {
      return { __redirect: url, status };
    }
  },
  setTimeout,
  clearTimeout,
  URLSearchParams,
  Promise,
  console,
};
sandbox.self.self = sandbox.self;
vm.createContext(sandbox);
const SW_PATH = path.join(import.meta.dirname, "..", "public", "sw.js");
vm.runInContext(fs.readFileSync(SW_PATH, "utf8"), sandbox);

function request(path, { mode = "cors", headers = {}, method = "GET" } = {}) {
  const lower = {};
  for (const [k, v] of Object.entries(headers)) lower[k.toLowerCase()] = v;
  return {
    method,
    mode,
    url: new URL(path, ORIGIN).href,
    headers: { get: (k) => lower[k.toLowerCase()] ?? null },
  };
}

async function dispatchFetch(req) {
  const waits = [];
  let responded;
  handlers.fetch({
    request: req,
    waitUntil: (p) => waits.push(p),
    respondWith: (p) => (responded = p),
  });

  /*
   * The response is settled first, then the background work.
   *
   * The other order looks equivalent and is not: waitUntil is now called from
   * inside the handler's own async flow, after respondWith, so draining the
   * list first drains an empty list and the assertions run against a cache
   * nothing has been written to yet.
   */
  const result = responded ? await responded : undefined;

  // Capped, because one of the things the worker deliberately keeps running in
  // the background is a fetch that never comes back. See the "hang" route.
  await Promise.race([
    Promise.all(waits.map((p) => Promise.resolve(p).catch(() => {}))),
    new Promise((resolve) => setTimeout(resolve, 200)),
  ]);
  return result;
}

async function dispatchActivate() {
  const waits = [];
  handlers.activate({ waitUntil: (p) => waits.push(p) });
  await Promise.all(waits.map((p) => Promise.resolve(p).catch(() => {})));
}

async function dispatchMessage(data, port) {
  const waits = [];
  handlers.message({
    data,
    ports: port ? [port] : [],
    waitUntil: (p) => waits.push(p),
  });
  await Promise.all(waits.map((p) => Promise.resolve(p).catch(() => {})));
}

async function pageKeys() {
  for (const [name, cache] of store) {
    if (name.startsWith("munawar-pages-")) {
      return (await cache.keys()).map((k) => k.__key).sort();
    }
  }
  return [];
}

// ------------------------------------------------------------------ tests --

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass: pass ? "PASS" : "FAIL", detail });
}

(async () => {
  await dispatchMessage({ type: "user", userId: "user-1" });

  // 1. Clicking a link — an RSC fetch — must cache that page's document.
  fetchLog.length = 0;
  await dispatchFetch(
    request("/customers?_rsc=1a2b3c", { headers: { RSC: "1" } }),
  );
  check(
    "link click caches the document",
    (await pageKeys()).includes("/customers"),
    `cached=${JSON.stringify(await pageKeys())}`,
  );
  check(
    "document fetched without the _rsc hash",
    fetchLog.includes("/customers") && !fetchLog.some((u) => u.includes("_rsc")),
    `fetched=${JSON.stringify(fetchLog)}`,
  );

  // 2. Hover prefetches must not each trigger a page render.
  fetchLog.length = 0;
  await dispatchFetch(
    request("/products?_rsc=9z", {
      headers: { RSC: "1", "Next-Router-Prefetch": "1" },
    }),
  );
  check(
    "hover prefetch caches nothing",
    !(await pageKeys()).includes("/products") && fetchLog.length === 0,
    `fetched=${JSON.stringify(fetchLog)}`,
  );

  // 3. Revisiting within the freshness window costs nothing.
  fetchLog.length = 0;
  await dispatchFetch(request("/customers?_rsc=zzz", { headers: { RSC: "1" } }));
  check("revisit skips the refetch", fetchLog.length === 0, `fetched=${JSON.stringify(fetchLog)}`);

  /*
   * 4. A navigation goes to the network first, and to the cache only when the
   *    network cannot answer.
   *
   *    This is the one that matters after a deploy. A cached document names
   *    the previous build's script files; serving it hands the browser a page
   *    whose code will not load, so nothing on screen responds to a click
   *    while a manual refresh appears to fix it. The cache is the fallback,
   *    not the default.
   */
  fetchLog.length = 0;
  await dispatchFetch(request("/reports", { mode: "navigate" }));
  const cachedReports = (await pageKeys()).includes("/reports");

  fetchLog.length = 0;
  const online = await dispatchFetch(request("/reports", { mode: "navigate" }));
  check(
    "a navigation prefers the network over the cached copy",
    cachedReports && fetchLog.includes("/reports") && online?.body === "/reports",
    `cached=${cachedReports} fetched=${JSON.stringify(fetchLog)}`,
  );

  // ...and falls back to what is on disk once the network is gone.
  routes = { "/reports": "offline" };
  fetchLog.length = 0;
  const offlineServed = await dispatchFetch(request("/reports", { mode: "navigate" }));
  check(
    "with no network the cached copy is served",
    offlineServed && offlineServed.body === "/reports",
    `servedBody=${offlineServed && offlineServed.body}`,
  );
  routes = {};

  // 5. One forbidden page must not abandon the rest of the warm run.
  store.clear();
  await dispatchMessage({ type: "user", userId: "user-1" });
  routes = { "/b": "redirect" };
  let warmResult;
  await dispatchMessage({ type: "warm", paths: ["/a", "/b", "/c"] }, {
    postMessage: (m) => (warmResult = m),
  });
  check(
    "warm continues past a page this role cannot open",
    warmResult && warmResult.fetched === 2 && warmResult.failed === 1 && !warmResult.stopped,
    JSON.stringify(warmResult),
  );

  // 6. A dead network should stop the run rather than grind through the list.
  store.clear();
  await dispatchMessage({ type: "user", userId: "user-1" });
  routes = { "/a": "offline", "/b": "offline", "/c": "offline", "/d": "offline", "/e": "offline" };
  await dispatchMessage({ type: "warm", paths: ["/a", "/b", "/c", "/d", "/e"] }, {
    postMessage: (m) => (warmResult = m),
  });
  check(
    "warm stops once the connection is clearly gone",
    warmResult && warmResult.stopped && warmResult.failed === 3,
    JSON.stringify(warmResult),
  );

  // 7. Signing out must destroy the pages and stop new ones being written.
  store.clear();
  routes = {};
  await dispatchMessage({ type: "user", userId: "user-1" });
  await dispatchFetch(request("/customers?_rsc=1", { headers: { RSC: "1" } }));
  const beforeSignOut = (await pageKeys()).length;

  await dispatchMessage({ type: "signout" });
  const afterSignOut = (await pageKeys()).length;

  fetchLog.length = 0;
  await dispatchFetch(request("/invoices?_rsc=1", { headers: { RSC: "1" } }));
  check(
    "sign out clears pages and stops caching",
    beforeSignOut === 1 && afterSignOut === 0 && (await pageKeys()).length === 0,
    `before=${beforeSignOut} after=${afterSignOut} then=${JSON.stringify(await pageKeys())}`,
  );

  // 8. A different person on the same device must never inherit the pages.
  await dispatchMessage({ type: "user", userId: "user-1" });
  await dispatchFetch(request("/customers?_rsc=1", { headers: { RSC: "1" } }));
  const asFirst = await pageKeys();
  await dispatchMessage({ type: "user", userId: "user-2" });
  check(
    "switching user destroys the previous pages",
    asFirst.includes("/customers") && (await pageKeys()).length === 0,
    `first=${JSON.stringify(asFirst)} second=${JSON.stringify(await pageKeys())}`,
  );

  /*
   * 9. The one that this whole scheme exists for.
   *
   *    A page cached by an earlier build must not survive into this one. Its
   *    HTML names script files whose names are content hashes, and the ones
   *    that changed are not in the new deployment — they answer 404. Serving
   *    it gives the browser a document whose code will never load: the old
   *    screen, no working clicks, and a refresh that appears to fix it.
   */
  store.clear();
  await dispatchMessage({ type: "user", userId: "user-1" });
  await (await caches.open(`munawar-pages-oldbuild-user-1`)).put("/invoices", html("/invoices"));
  await (await caches.open(`munawar-shell-oldbuild`)).put("/offline", html("/offline"));
  await (await caches.open("munawar-assets")).put("/_next/static/chunks/a.js", html("chunk"));
  await (await caches.open("munawar-identity")).put("/__munawar/user", new Response("user-1"));

  await dispatchActivate();
  const surviving = (await caches.keys()).sort();

  check(
    "activating a new build destroys the previous build's pages",
    !surviving.includes("munawar-pages-oldbuild-user-1") &&
      !surviving.includes("munawar-shell-oldbuild"),
    `caches=${JSON.stringify(surviving)}`,
  );

  check(
    "...but keeps the content-hashed assets and who is signed in",
    surviving.includes("munawar-assets") && surviving.includes("munawar-identity"),
    `caches=${JSON.stringify(surviving)}`,
  );

  // 10. With nothing on disk the deadline must not fire. Giving up after three
  //     seconds and showing the offline page to somebody who is merely on a
  //     slow connection is worse than making them wait, and this is the normal
  //     state of the page cache on the first load after a deploy.
  store.clear();
  await dispatchMessage({ type: "user", userId: "user-1" });
  routes = { "/slow": "slow" };
  fetchLog.length = 0;
  const slow = await dispatchFetch(request("/slow", { mode: "navigate" }));
  check(
    "a slow page with no cached copy is waited for, not abandoned",
    slow && slow.body === "/slow",
    `served=${slow && (slow.body ?? slow.__redirect)}`,
  );
  routes = {};

  // 11. ...but with a copy on disk, a stalled network must not hold the screen
  //     hostage. It is safe to serve now: the cache belongs to this build.
  routes = { "/slow": "hang" };
  const hung = await dispatchFetch(request("/slow", { mode: "navigate" }));
  check(
    "a cached page is served when the network stalls",
    hung && hung.body === "/slow",
    `served=${hung && (hung.body ?? hung.__redirect)}`,
  );
  routes = {};

  console.table(results);
  process.exit(results.every((r) => r.pass === "PASS") ? 0 : 1);
})();
