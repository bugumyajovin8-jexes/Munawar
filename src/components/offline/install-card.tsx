"use client";

import { useSyncExternalStore } from "react";
import { Share, Smartphone, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

/**
 * Chrome's install event. Not in lib.dom yet, so it is declared here rather
 * than cast away at the call site.
 */
type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

const DISMISSED_KEY = "munawar:install-dismissed";

type InstallState = { canPrompt: boolean; isIOS: boolean; hidden: boolean };

/**
 * Installability lives in the browser, not in React — it depends on an event
 * that may fire before this component mounts, on a display mode, and on
 * localStorage. So it is modelled as an external store and read through
 * useSyncExternalStore, which keeps the server snapshot ("show nothing")
 * honest and avoids writing state from an effect.
 */
const NOTHING_TO_OFFER: InstallState = {
  canPrompt: false,
  isIOS: false,
  hidden: true,
};

let state: InstallState = NOTHING_TO_OFFER;
let deferred: InstallPromptEvent | null = null;
let started = false;
const listeners = new Set<() => void>();

function isInstalled(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    // Safari's own flag, and the only way to detect it on iOS.
    (navigator as { standalone?: boolean }).standalone === true
  );
}

function recompute() {
  let dismissed = false;
  try {
    dismissed = localStorage.getItem(DISMISSED_KEY) === "1";
  } catch {
    // Storage blocked. Offering the card again is the harmless direction.
  }

  const next: InstallState = {
    canPrompt: deferred !== null,
    isIOS: /iPad|iPhone|iPod/.test(navigator.userAgent),
    hidden: isInstalled() || dismissed,
  };

  if (
    next.canPrompt === state.canPrompt &&
    next.isIOS === state.isIOS &&
    next.hidden === state.hidden
  ) {
    return;
  }

  state = next;
  for (const listener of listeners) listener();
}

function start() {
  if (started || typeof window === "undefined") return;
  started = true;

  window.addEventListener("beforeinstallprompt", (event) => {
    // Keep the event: it can only be used once, and only later, from a click.
    event.preventDefault();
    deferred = event as InstallPromptEvent;
    recompute();
  });

  window.addEventListener("appinstalled", () => {
    deferred = null;
    recompute();
  });

  recompute();
}

function subscribe(listener: () => void): () => void {
  start();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function dismiss() {
  try {
    localStorage.setItem(DISMISSED_KEY, "1");
  } catch {
    // Nothing to do — the card simply comes back next session.
  }
  state = { ...state, hidden: true };
  for (const listener of listeners) listener();
}

async function install() {
  if (!deferred) return;
  const prompt = deferred;
  await prompt.prompt();
  const { outcome } = await prompt.userChoice;
  deferred = null;
  if (outcome === "accepted") state = { ...state, hidden: true };
  recompute();
  for (const listener of listeners) listener();
}

/**
 * Offers to install the app to the home screen.
 *
 * Installed is the mode this app is meant to be used in: it launches without
 * browser chrome, keeps its own storage, and is one tap away when a customer
 * is standing in front of you.
 *
 * Renders nothing once installed, or in browsers with no install path — an
 * install button that does nothing is worse than no button.
 */
export function InstallCard() {
  const { canPrompt, isIOS, hidden } = useSyncExternalStore(
    subscribe,
    () => state,
    () => NOTHING_TO_OFFER,
  );

  // iOS can install, but only by hand, so it gets instructions instead.
  if (hidden || (!canPrompt && !isIOS)) return null;

  return (
    <Card className="mb-5 border-primary/30 bg-primary/5">
      <CardContent className="flex items-start gap-3 py-4">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
          <Smartphone className="size-5" />
        </div>

        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">Install Munawar on this device</p>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {isIOS ? (
              <>
                Tap <Share className="inline size-3.5 align-text-bottom" /> Share,
                then <span className="font-medium">Add to Home Screen</span>. It
                opens like an app and keeps working when the signal drops.
              </>
            ) : (
              "It opens like an app, launches faster, and keeps working when the signal drops."
            )}
          </p>

          {canPrompt && (
            <Button size="sm" className="mt-3" onClick={() => void install()}>
              Install
            </Button>
          )}
        </div>

        <button
          type="button"
          onClick={dismiss}
          aria-label="Don't show this again"
          className="rounded-md p-1 text-muted-foreground hover:bg-accent"
        >
          <X className="size-4" />
        </button>
      </CardContent>
    </Card>
  );
}
