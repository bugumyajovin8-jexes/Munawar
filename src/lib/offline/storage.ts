"use client";

/**
 * Persistent storage.
 *
 * By default a browser treats IndexedDB and the Cache API as *best effort*:
 * under storage pressure it may evict a site's data without asking and without
 * telling anyone. For a page cache that is merely annoying — the pages come
 * back next time you open them. For the outbox it is unacceptable: the whole
 * promise of this feature is that a payment taken in a shop with no signal is
 * safe until it reaches the server, and "safe unless the phone runs low on
 * space" is not a promise worth making.
 *
 * navigator.storage.persist() asks for that data to be exempt. How the answer
 * is decided varies, and none of it is under our control:
 *
 *   - Chromium decides silently from engagement signals. Being installed to
 *     the home screen is one of the strongest, which is the second reason the
 *     install card exists.
 *   - Firefox prompts the user, so the request is made at a moment where the
 *     prompt makes sense — when there is actually something queued — rather
 *     than on first load, where it would read as a site being pushy.
 *   - Safari grants it to installed web apps, which also exempts them from the
 *     seven-day eviction it applies to ordinary sites.
 *
 * A refusal is not an error. It means the queue is on best-effort storage, the
 * sync panel says so, and the user is told installing would fix it.
 */

export type StorageState = {
  /** False in browsers with no Storage API at all — nothing to ask, nothing to show. */
  supported: boolean;
  persisted: boolean;
  usageBytes: number | null;
  quotaBytes: number | null;
};

const UNKNOWN: StorageState = {
  supported: false,
  persisted: false,
  usageBytes: null,
  quotaBytes: null,
};

type Listener = () => void;

const listeners = new Set<Listener>();
let state: StorageState = UNKNOWN;
let asked = false;
let started = false;

function available(): boolean {
  return (
    typeof navigator !== "undefined" &&
    typeof navigator.storage !== "undefined" &&
    typeof navigator.storage.persist === "function"
  );
}

function publish(next: StorageState) {
  if (
    next.supported === state.supported &&
    next.persisted === state.persisted &&
    next.usageBytes === state.usageBytes &&
    next.quotaBytes === state.quotaBytes
  ) {
    return;
  }
  state = next;
  for (const listener of listeners) listener();
}

export async function refreshStorage(): Promise<void> {
  if (!available()) return publish({ ...UNKNOWN, supported: false });

  let persisted = false;
  let usageBytes: number | null = null;
  let quotaBytes: number | null = null;

  try {
    persisted = await navigator.storage.persisted();
  } catch {
    // Treated as "not persisted", which is the cautious reading.
  }

  try {
    const estimate = await navigator.storage.estimate();
    usageBytes = estimate.usage ?? null;
    quotaBytes = estimate.quota ?? null;
  } catch {
    // Estimates are decoration; their absence changes nothing.
  }

  publish({ supported: true, persisted, usageBytes, quotaBytes });
}

/**
 * Ask for the exemption. Safe to call repeatedly: it does nothing once granted,
 * and asks at most once per page load otherwise, so a browser that prompts can
 * never be made to prompt twice.
 */
export async function requestPersistence(): Promise<boolean> {
  if (!available()) return false;

  try {
    if (await navigator.storage.persisted()) {
      await refreshStorage();
      return true;
    }
  } catch {
    return false;
  }

  if (asked) return false;
  asked = true;

  try {
    const granted = await navigator.storage.persist();
    await refreshStorage();
    return granted;
  } catch {
    return false;
  }
}

const ASKED_KEY = "munawar:asked-persistence";

/**
 * Ask for persistent storage the next time the user touches anything.
 *
 * Firefox decides this with a prompt, and it will not raise that prompt for a
 * page that asks on its own — the request has to come out of a user gesture.
 * The previous version only ever asked when the app was launched from a home
 * screen, so in an ordinary Firefox tab nothing ever called persist() and no
 * prompt could ever appear. There is a button in the sync panel now too, but a
 * button behind a dialog behind a chip reading "All changes saved" is not
 * somewhere anyone goes looking.
 *
 * So the first click anywhere carries the question. Once per device, recorded
 * across loads rather than per page, because being asked this twice is worse
 * than never being asked at all.
 */
export function askOnFirstGesture(): void {
  if (!available()) return;

  try {
    if (localStorage.getItem(ASKED_KEY)) return;
  } catch {
    // Storage blocked outright; a prompt would not survive anyway.
    return;
  }

  void navigator.storage.persisted().then((already) => {
    if (already) return;

    const ask = () => {
      window.removeEventListener("pointerdown", ask);
      window.removeEventListener("keydown", ask);
      try {
        localStorage.setItem(ASKED_KEY, String(Date.now()));
      } catch {
        // Then it may ask again next load. Not ideal, not harmful.
      }
      void requestPersistence();
    };

    window.addEventListener("pointerdown", ask, { once: true });
    window.addEventListener("keydown", ask, { once: true });
  });
}

export function getStorageState(): StorageState {
  return state;
}

export function getServerStorageState(): StorageState {
  return UNKNOWN;
}

export function subscribeStorage(listener: Listener): () => void {
  if (!started) {
    started = true;
    void refreshStorage();
  }
  listeners.add(listener);
  return () => listeners.delete(listener);
}
