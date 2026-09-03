import { createHash } from "node:crypto";
import type { NextConfig } from "next";

/**
 * A token that changes with every deployment, and only with a deployment.
 *
 * The service worker needs this. Its caches used to be keyed by a version
 * string edited by hand in public/sw.js, which meant they were keyed by
 * nothing at all: shipping the app does not touch that file, so documents
 * cached from an older build stayed valid forever — and a document names the
 * script files of the build that made it. Those names are content hashes, so
 * the ones that changed simply do not exist in the new deployment. The page
 * loads, its code 404s, and it sits there: no clicks, no navigation, a
 * spinner that never finishes and a refresh that appears to fix it.
 *
 * Hashed rather than used raw so the shape is the same whichever of these
 * happens to be set, and short enough to sit in a query string.
 */
const BUILD_ID = createHash("sha1")
  .update(
    process.env.VERCEL_DEPLOYMENT_ID ??
      process.env.VERCEL_GIT_COMMIT_SHA ??
      process.env.VERCEL_URL ??
      String(Date.now()),
  )
  .digest("hex")
  .slice(0, 12);

/**
 * The app's own content policy.
 *
 * Deliberately not the strictest one that could be written. `script-src` keeps
 * 'unsafe-inline' because Next bootstraps and streams through inline script
 * tags, and locking that down properly means threading a per-request nonce
 * through the whole render — worth doing one day, not worth a blank white app
 * in a shop in the meantime.
 *
 * What it does buy is the part an XSS actually needs to be useful: `connect-src`
 * pins network calls to this origin and Supabase, so a script that did run has
 * nowhere to send the customer list; `form-action` stops a posted form being
 * redirected off-site; `base-uri` stops an injected <base> tag re-pointing
 * every relative script URL; and `object-src 'none'` closes the plugin
 * embedding route entirely.
 */
function contentSecurityPolicy(): string {
  let supabase = "https://*.supabase.co wss://*.supabase.co";
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (url) {
      const { origin, host } = new URL(url);
      supabase = `${origin} wss://${host}`;
    }
  } catch {
    // Malformed or missing at build time. The wildcard above still applies.
  }

  return [
    "default-src 'self'",
    // eval() is needed by the dev overlay and by Turbopack's HMR runtime.
    `script-src 'self' 'unsafe-inline'${process.env.NODE_ENV === "production" ? "" : " 'unsafe-eval'"}`,
    "style-src 'self' 'unsafe-inline'",
    // blob: is the QR code and the Excel download; data: is the inline icons.
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src 'self' ${supabase}`,
    "worker-src 'self'",
    "manifest-src 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'self'",
    "object-src 'none'",
  ].join("; ");
}

const nextConfig: NextConfig = {
  /*
   * Inlined into the client bundle at build time, which is the only place it
   * can come from — the page has to know the build id before it can tell the
   * service worker about it. See src/components/pwa-register.tsx.
   */
  env: { NEXT_PUBLIC_BUILD_ID: BUILD_ID },

  experimental: {
    /**
     * How long the client keeps a prefetched or visited route in memory.
     *
     * These numbers changed meaning entirely once the screens stopped fetching
     * on the server. A cached route used to be a cached *answer* — balances
     * and totals rendered at some past moment — so it had to expire quickly or
     * the app would show stale money. Now a route is an empty shell and every
     * figure in it is read from IndexedDB at render time, so caching one for
     * longer cannot make a number stale. It only avoids re-fetching markup
     * that never changes between builds.
     *
     * `static` is what prefetched routes land in, and the app screens are all
     * static now, so this is the number that decides whether a click feels
     * instant. Five minutes is Next's own default and there is no longer any
     * reason to undercut it.
     */
    staleTimes: {
      dynamic: 30,
      static: 300,
    },
  },

  async headers() {
    return [
      {
        /**
         * The one file that must never be cached.
         *
         * A service worker is only replaced when the browser fetches a byte-
         * different copy of this file. If a CDN or the browser serves the old
         * one from cache, the old worker stays installed — and since it is the
         * thing deciding what every page shows, a stale worker can pin users to
         * a stale app indefinitely, with no way to push a fix.
         */
        source: "/sw.js",
        headers: [
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          // The worker only ever needs its own origin.
          { key: "Content-Security-Policy", value: "default-src 'self'; script-src 'self'" },
        ],
      },
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // DENY would break nothing today, but SAMEORIGIN leaves the print
          // preview iframe route open if it is ever needed.
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Content-Security-Policy", value: contentSecurityPolicy() },
        ],
      },
    ];
  },
};

export default nextConfig;
