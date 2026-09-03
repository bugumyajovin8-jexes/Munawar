"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useOnline } from "@/lib/offline/hooks";
import { canReachServer } from "@/lib/offline/online";

/** Never more often than this, however many triggers fire at once. */
const THROTTLE_MS = 30_000;
/**
 * How long the app has to have been out of sight before coming back to it is
 * worth a refetch.
 *
 * The previous version refreshed on every `focus` and every `visibilitychange`,
 * throttled only to ten seconds. Alt-tabbing to WhatsApp to copy a phone number
 * and coming straight back therefore re-rendered every server component on the
 * page against a database in another country — which is why returning to the
 * app always looked like it was reloading. Glancing away is not a reason to
 * refetch anything; the figures cannot have changed in the four seconds you
 * were gone, and if they did the interval below catches it.
 */
const AWAY_MS = 120_000;
/** Someone watching the collections screen should not have to touch anything. */
const INTERVAL_MS = 60_000;
/** Two refreshes-on-load this close together mean we are in a reload cycle. */
const LOOP_WINDOW_MS = 5_000;
const LOOP_KEY = "munawar:last-load-refresh";

/**
 * The other half of showing cached data: making sure it stops being cached.
 *
 * Two caches sit in front of the database — the service worker's page cache for
 * hard loads, and Next's in-memory router cache for navigation. Both exist so a
 * screen paints immediately instead of waiting on a round trip to Supabase.
 * Both are also, by definition, showing figures from the past. This closes that
 * window: it re-fetches in the background, the current screen stays on show,
 * and React swaps in the new figures with no spinner and no scroll jump.
 *
 * Every refresh is gated on the server actually answering, and that gate is
 * load-bearing rather than defensive. router.refresh() offline does not simply
 * fail — Next falls back to a full browser navigation, the page reloads out of
 * the service worker cache, this component mounts again and refreshes again.
 * The result is a page that flickers and reloads forever. Asking a cheap
 * /api/ping first means that cycle can never start.
 */
export function FreshnessGuard() {
  const router = useRouter();
  const online = useOnline();
  const lastRefresh = useRef(0);

  useEffect(() => {
    if (!online) return;
    let cancelled = false;

    const refresh = async () => {
      if (cancelled || document.visibilityState !== "visible") return;

      const now = Date.now();
      if (now - lastRefresh.current < THROTTLE_MS) return;
      lastRefresh.current = now;

      if (!(await canReachServer()) || cancelled) return;
      router.refresh();
    };

    // A service worker in charge means this document may have come off the
    // disk. With no worker, the server rendered it moments ago.
    if (navigator.serviceWorker?.controller) {
      // Belt and braces behind the connectivity gate: if a load-time refresh
      // already happened seconds ago, this mount is the result of a reload
      // rather than a fresh visit, and refreshing again would continue it.
      let looping = false;
      try {
        const previous = Number(sessionStorage.getItem(LOOP_KEY) ?? 0);
        looping = Date.now() - previous < LOOP_WINDOW_MS;
        sessionStorage.setItem(LOOP_KEY, String(Date.now()));
      } catch {
        // Storage blocked; the connectivity gate alone is enough.
      }
      if (!looping) void refresh();
    }

    // Only `visibilitychange`, and only after a real absence. `focus` fires for
    // things that are not absences at all — clicking back into the window after
    // a dialog, or returning from the address bar — and refreshing on those is
    // what made the app feel like it was reloading constantly.
    let hiddenSince = 0;

    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        hiddenSince = Date.now();
        return;
      }
      const away = hiddenSince === 0 ? 0 : Date.now() - hiddenSince;
      hiddenSince = 0;
      if (away >= AWAY_MS) void refresh();
    };

    document.addEventListener("visibilitychange", onVisibility);
    const timer = setInterval(() => void refresh(), INTERVAL_MS);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibility);
      clearInterval(timer);
    };
  }, [online, router]);

  return null;
}
