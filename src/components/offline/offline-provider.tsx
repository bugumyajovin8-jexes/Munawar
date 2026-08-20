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

    // Fills this device's mirror of the business and keeps it current. Every
    // screen reads from that rather than from Supabase, which is what makes
    // navigation instant with a connection and possible without one.
    void startSync(userId);

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

    // Warming competes with whatever the user actually asked for, so it waits
    // until the current page has settled. The worker skips anything cached in
    // the last hour, so on most loads this run is almost entirely skips and
    // only genuinely new invoices are fetched.
    const timer = setTimeout(() => {
      if (!navigator.onLine) return;
      void warmFromManifest();

      // Restock this device's invoice numbers while there is a connection to
      // ask over. It does nothing when the current block is still healthy, and
      // asking early is close to free — the alternative is discovering the
      // stock is empty in a shop with no signal, which cannot be fixed there.
      void topUp();
    }, 4_000);

    return () => clearTimeout(timer);
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
