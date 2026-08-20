"use client";

/**
 * What the browser will tell you, and what it will not.
 *
 * Persistent storage is decided by the browser silently — persist() just
 * returns true or false with no explanation — so the only way to know where
 * you stand is to ask and print the answer. This puts that answer in the
 * console on every load, and leaves `window.munawar` behind for poking at.
 */
import { readAll } from "./db";
import { getOutboxState } from "./outbox";
import { refreshStorage, requestPersistence, getStorageState } from "./storage";

function mb(bytes: number | null): string {
  if (bytes === null) return "unknown";
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Chromium exposes it as a permission; Firefox and Safari do not. */
async function permissionState(): Promise<string> {
  try {
    const status = await navigator.permissions.query({
      name: "persistent-storage" as PermissionName,
    });
    return status.state;
  } catch {
    return "not reported by this browser";
  }
}

export async function storageReport() {
  await refreshStorage();
  const { supported, persisted, usageBytes, quotaBytes } = getStorageState();

  const report = {
    persistentStorage: !supported
      ? "not supported by this browser"
      : persisted
        ? "GRANTED — this data cannot be evicted to reclaim space"
        : "NOT GRANTED — best-effort storage, the browser may evict it",
    permission: await permissionState(),
    used: mb(usageBytes),
    quota: mb(quotaBytes),
    installed: window.matchMedia("(display-mode: standalone)").matches,
    queued: getOutboxState().items.length,
    blocked: getOutboxState().blocked.length,
  };

  // One plain line first, then the detail. The line is the bit that has to
  // survive a log filter, a collapsed group, or a console that renders neither
  // groups nor tables — it should answer the question on its own.
  console.info(
    `%cMunawar%c persistent storage: ${
      !supported ? "UNSUPPORTED" : persisted ? "GRANTED ✓" : "NOT GRANTED ✗"
    } · using ${mb(usageBytes)} of ${mb(quotaBytes)}`,
    "background:#3f4fb4;color:#fff;padding:2px 6px;border-radius:4px;font-weight:600",
    "color:inherit;font-weight:400",
  );

  // A table beats a wall of text when the point is a handful of key/values.
  console.groupCollapsed("Munawar storage detail");
  console.table(report);
  if (supported && !persisted) {
    console.info(
      "Not granted is normal in a plain browser tab. Chromium decides from " +
        "engagement signals and Safari reserves it for installed apps, so " +
        "installing Munawar to the home screen is what usually grants it. " +
        "Run munawar.requestPersistence() to ask now.",
    );
  }
  console.info("Try: munawar.storage(), munawar.queue(), munawar.caches()");
  console.groupEnd();

  return report;
}

async function cacheReport() {
  const names = await caches.keys();
  const rows: Record<string, number> = {};
  for (const name of names) {
    rows[name] = (await (await caches.open(name)).keys()).length;
  }
  console.table(rows);
  return rows;
}

async function queueReport() {
  const items = await readAll();
  console.table(
    items.map((item) => ({
      what: item.label,
      kind: item.kind,
      queued: new Date(item.createdAt).toLocaleString("en-GB"),
      error: item.lastError ?? "",
    })),
  );
  return items;
}

let installed = false;

/**
 * Exposed deliberately, not by accident. It is read-only apart from
 * requestPersistence(), and everything it shows is this device's own state —
 * nothing here is worth hiding from the person whose device it is.
 */
export function installDiagnostics() {
  if (installed || typeof window === "undefined") return;
  installed = true;

  Object.defineProperty(window, "munawar", {
    value: Object.freeze({
      storage: storageReport,
      queue: queueReport,
      caches: cacheReport,
      requestPersistence,
    }),
    writable: false,
    configurable: true,
  });

  void storageReport();
}
