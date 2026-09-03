/**
 * Registers the service worker, and rescues a device that a deploy has broken.
 *
 * This is an inline script in the document rather than an effect in a client
 * component, and that is the whole point of it. Both jobs below have to work
 * on a page whose JavaScript never loads — which is precisely the state this
 * is here to get out of. An effect cannot run without hydration, and hydration
 * cannot happen without the bundle, so the old version of this file could only
 * fix devices that did not need fixing. It also waited for window's `load`
 * event, which never fires on a page that is still trying to load something
 * that will never arrive.
 *
 * Not a client component, so nothing here is shipped twice or hydrated. In
 * development it renders nothing: a worker caching pages while Turbopack is
 * swapping them underneath is nothing but confusing.
 */
export function PwaRegister() {
  if (process.env.NODE_ENV !== "production") return null;

  const build = process.env.NEXT_PUBLIC_BUILD_ID ?? "unversioned";

  /*
   * Two things, in one script so the second cannot be skipped by a failure in
   * the first.
   *
   * REGISTER — at /sw.js?v=<build>. The query string is load-bearing. A
   * browser only replaces a worker when the script it fetches differs, and
   * public/sw.js is byte-identical from one deploy to the next, so without
   * this a deploy would leave the old worker in charge of the new build. A
   * changed script URL is itself the signal to install, and it also tells the
   * worker which build it belongs to before it answers a single request.
   *
   * REPAIR — if a script under /_next/ fails to load, this document is from a
   * build that is no longer deployed: it is asking for content-hashed files
   * that have been replaced, and they answer 404. Nothing on the page will
   * ever work, and no amount of refreshing helps while the cache keeps
   * handing back the same document. So the caches go and the page reloads
   * once — guarded by a key holding this build id, so it can happen at most
   * once per build per tab and can never become a reload loop. Only the
   * caches are touched. The mirror is in IndexedDB and is not involved.
   *
   * The failure is watched for twice because one listener cannot see the
   * whole page. An error event only reaches a handler that was already
   * attached, and this script cannot be the first thing in the document; so
   * the load handler afterwards sweeps resource timings for anything under
   * /_next/ that came back 4xx or 5xx, which catches whatever failed before
   * the listener existed.
   */
  const bootstrap = `
(function () {
  if (!("serviceWorker" in navigator)) return;
  var build = ${JSON.stringify(build)};
  var NEXT = "/_next/";

  function repair() {
    try {
      if (sessionStorage.getItem("munawar:repaired") === build) return;
      sessionStorage.setItem("munawar:repaired", build);
    } catch (e) {
      return;
    }
    caches.keys().then(function (names) {
      return Promise.all(names.filter(function (name) {
        return name.indexOf("munawar-") === 0;
      }).map(function (name) { return caches.delete(name); }));
    }).catch(function () {}).then(function () { location.reload(); });
  }

  window.addEventListener("error", function (event) {
    var el = event.target;
    if (!el || el.tagName !== "SCRIPT" || !el.src) return;
    if (el.src.indexOf(NEXT) === -1) return;
    repair();
  }, true);

  window.addEventListener("load", function () {
    try {
      var entries = performance.getEntriesByType("resource");
      for (var i = 0; i < entries.length; i++) {
        var e = entries[i];
        if (e.name.indexOf(NEXT) !== -1 && e.responseStatus >= 400) return repair();
      }
    } catch (e) {
      /* Older browser with no responseStatus. The listener above is the net. */
    }
  });

  navigator.serviceWorker
    .register("/sw.js?v=" + encodeURIComponent(build))
    .catch(function () {});
})();
`.trim();

  return <script dangerouslySetInnerHTML={{ __html: bootstrap }} />;
}
