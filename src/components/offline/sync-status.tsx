"use client";

import { useEffect, useState } from "react";
import {
  AlertTriangle,
  Check,
  CloudOff,
  HardDrive,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Trash2,
  UploadCloud,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { useOnline, useOutbox, useStorage } from "@/lib/offline/hooks";
import { discard, flush, retry } from "@/lib/offline/outbox";
import { requestPersistence } from "@/lib/offline/storage";
import { cachedPageCount, warmFromManifest } from "@/lib/offline/sw-client";
import type { OutboxItem } from "@/lib/offline/types";

function ago(when: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - when) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? "hour" : "hours"} ago`;
  const days = Math.round(hours / 24);
  return `${days} ${days === 1 ? "day" : "days"} ago`;
}

type Tone = "sidebar" | "compact";

/**
 * Says, at all times, whether the work the user has done is actually somewhere
 * safe. An app that queues silently is an app that loses money quietly.
 */
export function SyncStatus({ tone = "sidebar" }: { tone?: Tone }) {
  const online = useOnline();
  const { items, blocked, syncing, needsSignIn } = useOutbox();
  const storage = useStorage();
  const [open, setOpen] = useState(false);

  const waiting = items.length;
  const stuck = blocked.length;
  const clean = waiting === 0 && stuck === 0;

  // Nothing to say, and no room to say it in.
  if (tone === "compact" && clean && online) return null;

  const label = needsSignIn
    ? "Sign in to sync"
    : stuck > 0
      ? `${stuck} need${stuck === 1 ? "s" : ""} attention`
      : syncing
        ? "Syncing…"
        : waiting > 0
          ? `${waiting} waiting to sync`
          : online
            ? "All changes saved"
            : "Offline — nothing pending";

  const state: "error" | "busy" | "waiting" | "ok" =
    needsSignIn || stuck > 0 ? "error" : syncing ? "busy" : waiting > 0 ? "waiting" : "ok";

  const Icon =
    state === "error"
      ? AlertTriangle
      : state === "busy"
        ? RefreshCw
        : state === "waiting"
          ? UploadCloud
          : online
            ? Check
            : CloudOff;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`Sync status: ${label}`}
        className={cn(
          "flex items-center gap-2 rounded-lg text-xs font-medium transition-colors outline-none",
          "focus-visible:ring-2 focus-visible:ring-ring/60",
          tone === "sidebar"
            ? "w-full px-2 py-1.5 text-left hover:bg-sidebar-accent"
            : "px-2 py-1.5 hover:bg-accent",
          state === "error"
            ? "text-destructive"
            : state === "ok"
              ? tone === "sidebar"
                ? "text-sidebar-muted"
                : "text-muted-foreground"
              : "text-warning",
        )}
      >
        <Icon className={cn("size-3.5 shrink-0", state === "busy" && "animate-spin")} />
        <span className={cn("truncate", tone === "compact" && "sr-only sm:not-sr-only")}>
          {label}
        </span>
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Saved on this device</DialogTitle>
            <DialogDescription>
              {clean
                ? "Everything you have done is on the server."
                : "These are waiting for a connection. They send themselves — you do not have to be on this screen."}
            </DialogDescription>
          </DialogHeader>

          {needsSignIn && (
            <p
              role="alert"
              className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              Your session expired while this was waiting. Sign in again and it will
              send itself — nothing has been lost.
            </p>
          )}

          {clean ? (
            <p className="flex items-center gap-2 rounded-md bg-success/10 px-3 py-2.5 text-sm text-success">
              <Check className="size-4" />
              Nothing waiting.
            </p>
          ) : (
            <ul className="flex max-h-80 flex-col gap-2 overflow-y-auto">
              {[...blocked, ...items].map((item) => (
                <QueueRow key={item.id} item={item} stuck={blocked.includes(item)} />
              ))}
            </ul>
          )}

          <OfflineCoverage open={open} online={online} />

          <StorageNote supported={storage.supported} persisted={storage.persisted} />

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Close
            </Button>
            <Button onClick={() => void flush()} disabled={clean || syncing || !online}>
              {syncing && <RefreshCw className="size-4 animate-spin" />}
              Sync now
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * How much of the app is actually on this device.
 *
 * Opening a screen with no signal and being told it was never downloaded is a
 * poor surprise, and the honest fix is to say up front what is here and offer
 * to fetch the rest. The button exists because "before I get on the road" is a
 * moment the app cannot predict but the user can.
 */
function OfflineCoverage({ open, online }: { open: boolean; online: boolean }) {
  const [pages, setPages] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    let live = true;
    void cachedPageCount().then((count) => {
      if (live) setPages(count);
    });
    return () => {
      live = false;
    };
  }, [open, saving]);

  // The worker reports when the run is genuinely finished, so the button can
  // stop on the real event rather than on a guessed timer.
  async function saveMore() {
    setSaving(true);
    try {
      await warmFromManifest();
    } finally {
      setSaving(false);
    }
  }

  if (pages === null) return null;

  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5">
      <p className="text-xs text-muted-foreground">
        <span className="font-medium text-foreground">
          {pages} {pages === 1 ? "screen" : "screens"}
        </span>{" "}
        saved for offline use. Unpaid invoices and the customers who owe you are
        kept automatically.
      </p>
      <Button
        size="sm"
        variant="outline"
        onClick={() => void saveMore()}
        disabled={saving || !online}
      >
        {saving && <RefreshCw className="size-4 animate-spin" />}
        {saving ? "Saving" : "Save more"}
      </Button>
    </div>
  );
}

/**
 * Whether the device has promised to keep this data.
 *
 * Without persistent storage the browser is free to evict the queue to reclaim
 * space, silently. That is worth saying out loud when there is unsent work, and
 * worth confirming when there is — an app that claims to hold your money data
 * should be willing to show whether it actually can.
 */
function StorageNote({
  supported,
  persisted,
}: {
  supported: boolean;
  persisted: boolean;
}) {
  if (!supported) return null;

  if (persisted) {
    return (
      <p className="flex items-start gap-2 text-xs text-muted-foreground">
        <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-success" />
        This device has reserved storage for Munawar, so nothing saved here can
        be cleared away to free up space.
      </p>
    );
  }

  /*
   * Shown whenever storage is not reserved, not only when something is queued.
   *
   * The earlier version waited for work to be at stake, so that in a browser
   * tab with an empty queue the app never asked and Firefox never showed its
   * prompt. That was the wrong trade: without this, saved pages are best-effort
   * and can vanish, which is precisely the "it forgot everything" complaint.
   *
   * The request must also come from a click. Firefox will not raise its
   * doorhanger for a page that asks on its own, so the button is the mechanism,
   * not a courtesy.
   */
  return (
    <div className="flex items-start gap-2 rounded-md bg-warning/10 px-3 py-2.5 text-xs text-warning-foreground dark:text-warning">
      <HardDrive className="mt-0.5 size-3.5 shrink-0" />
      <div>
        <p>
          This browser has not reserved storage for Munawar, so saved pages and
          anything waiting to sync can be cleared to free up space.
        </p>
        <Button
          size="sm"
          variant="outline"
          className="mt-2"
          onClick={() => void requestPersistence()}
        >
          Allow permanent storage
        </Button>
        <p className="mt-2 opacity-80">
          Firefox will ask you to confirm. Installing Munawar to the home screen
          usually grants it without asking.
        </p>
      </div>
    </div>
  );
}

function QueueRow({ item, stuck }: { item: OutboxItem; stuck: boolean }) {
  return (
    <li
      className={cn(
        "rounded-lg border px-3 py-2.5 text-sm",
        stuck ? "border-destructive/40 bg-destructive/5" : "border-border",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-medium">{item.label}</p>
          <p className="text-xs text-muted-foreground">{ago(item.createdAt)}</p>
        </div>
        {stuck && (
          <div className="flex shrink-0 gap-1">
            <Button
              size="icon"
              variant="ghost"
              aria-label="Try again"
              onClick={() => void retry(item.id)}
            >
              <RotateCcw className="size-4" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              aria-label="Remove from queue"
              onClick={() => void discard(item.id)}
            >
              <Trash2 className="size-4 text-destructive" />
            </Button>
          </div>
        )}
      </div>

      {stuck && item.lastError && (
        <p className="mt-1.5 text-xs text-destructive">
          {item.lastError} — fix it and try again, or remove it and redo it here.
        </p>
      )}
    </li>
  );
}
