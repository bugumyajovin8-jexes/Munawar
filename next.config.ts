import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    /**
     * Keep visited pages in the in-memory client cache so going back to one
     * paints immediately instead of round-tripping to Vercel and Supabase.
     *
     * Next sets `dynamic` to 0 by default — every page here is dynamic, so
     * nothing was being reused and every navigation paid full price. That is
     * why the app felt quicker offline than online: offline it was reading
     * from a cache, online it was reading from a database in another country.
     *
     * 30 seconds is chosen to be shorter than anyone's attention span for
     * "these figures look wrong". It is also not the only guard: recording a
     * payment calls router.refresh(), which invalidates this cache outright,
     * and FreshnessGuard re-fetches on focus and on a timer. So the window
     * where a stale figure can survive is small and self-closing.
     *
     * The cache is per-tab and in memory. It cannot outlive a reload or leak
     * to another user.
     *
     * `static` is deliberately 60 rather than the 180 default: router.prefetch()
     * results land in that bucket, so a row prefetched on hover would otherwise
     * be servable for three minutes. Only /login and /offline are genuinely
     * static here and neither carries figures, so shortening it costs nothing.
     */
    staleTimes: {
      dynamic: 30,
      static: 60,
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
        ],
      },
    ];
  },
};

export default nextConfig;
