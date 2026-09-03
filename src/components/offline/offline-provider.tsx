"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { setOutboxUser } from "@/lib/offline/outbox";
import { installDiagnostics } from "@/lib/offline/diagnostics";
import { askOnFirstGesture, requestPersistence } from "@/lib/offline/storage";
import { announceUser, warmFromManifest } from "@/lib/offline/sw-client";
import { startSync } from "@/lib/offline/sync";
import { topUp } from "@/lib/offline/numbers";
import { useOutbox } from "@/lib/offline/hooks";

/**
 * Attaches this session to the offline machinery: tells the outbox and the
 * service worker who is signed in, pulls the main screens into the cache, and
 * refreshes the page once queued work lands so the figures stop lying.
 */
export function OfflineProvider({ userId }: { userId: string }) {
  const router = useRouter();
  const { items, blocked, syncing, lastSyncedAt } = useOutbox();

  useEffect(() => {
    setOutboxUser(userId);
    void announceUser(userId);

    // Prints the storage verdict to the console and leaves window.munawar
    // behind. The browser gives no other way to see whether persist() worked.
    installDiagnostics();

    // Installed apps are granted this without being asked, so there is no
    // prompt to be careful about — claim it immediately. In a browser tab the
    // question needs a user gesture to be allowed to appear at all, so it rides
    // along with the first click; see askOnFirstGesture().
    if (window.matchMedia("(display-mode: standalone)").matches) {
      void requestPersistence();
    } else {
      askOnFirstGesture();
    }

    /*
     * Warming waits for the mirror to finish filling, not for a fixed delay.
     *
     * Four seconds was long enough on a device that already had its data. On a
     * fresh sign-in it was not: the first sync is a cold read of the whole
     * business, several pages of it, and the warm run started on top of that
     * and added a page fetch every fraction of a second — each one a server
     * render behind an auth check. Between them they were enough to time the
     * middleware out and put a 504 on the screen of somebody who had just
     * typed their password.
     *
     * startSync() resolves when the mirror is current, so waiting on it puts
     * the two in sequence rather than in competition. The four seconds after
     * it is the gap that stops warming from landing on the first paint.
     */
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    void startSync(userId).finally(() => {
      if (cancelled) return;
      timer = setTimeout(() => {
        if (cancelled || !navigator.onLine) return;
        void warmFromManifest();

        // Restock this device's invoice numbers while there is a connection to
        // ask over. It does nothing when the current block is still healthy,
        // and asking early is close to free — the alternative is discovering
        // the stock is empty in a shop with no signal, which cannot be fixed
        // there.
        void topUp();
      }, 4_000);
    });

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [userId]);

  // Refs, not state: this is bookkeeping about renders past, and writing state
  // from an effect is exactly the pattern React 19 warns about.
  const previousPending = useRef(0);
  const announced = useRef<number | null>(null);

  useEffect(() => {
    const pending = items.length;
    const drained = previousPending.current > 0 && pending === 0 && !syncing;
    previousPending.current = pending;

    if (!drained || lastSyncedAt === null || announced.current === lastSyncedAt) return;
    announced.current = lastSyncedAt;

    toast.success(
      blocked.length > 0 ? "Back online — everything else synced" : "Back online — everything synced",
    );
    // The screen was rendered from figures that have just changed underneath it.
    router.refresh();
  }, [items.length, blocked.length, syncing, lastSyncedAt, router]);

  return null;
}
