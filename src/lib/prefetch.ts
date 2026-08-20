"use client";

import { useCallback, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

/**
 * Fetch a route when the user looks like they are about to open it.
 *
 * Next's default prefetch for a dynamic route stops at the nearest loading.tsx
 * boundary — it fetches the skeleton, not the data. Every route here is
 * dynamic, so clicking still paid for the whole render. router.prefetch() takes
 * the lot, which is what actually makes the click feel instant.
 *
 * The delay is the entire trick. Prefetching on plain hover means sweeping the
 * pointer down a fifty-row table fires fifty full page renders and fifty rounds
 * of Supabase queries. Resting on a row for a moment is the signal that someone
 * means it. Touch has no hover phase at all, so it fires immediately: the gap
 * between finger-down and click is free time worth spending.
 */
export function usePrefetchOnIntent(delayMs = 120) {
  const router = useRouter();
  const requested = useRef(new Set<string>());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clear = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);

  // A row unmounting mid-hover (filter typed, page changed) must not leave a
  // timer behind to prefetch something nobody is looking at any more.
  useEffect(() => clear, [clear]);

  const run = useCallback(
    (href: string) => {
      if (requested.current.has(href)) return;
      requested.current.add(href);
      router.prefetch(href);
    },
    [router],
  );

  return {
    /** Pointer resting on the target. */
    onPointerEnter: (href: string) => {
      if (requested.current.has(href)) return;
      clear();
      timer.current = setTimeout(() => run(href), delayMs);
    },
    onPointerLeave: clear,
    /** Finger down: the click is already coming. */
    onTouchStart: (href: string) => {
      clear();
      run(href);
    },
  };
}
