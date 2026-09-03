"use client";

/**
 * The signed-in user, held on the device.
 *
 * Read once from /api/session and kept in the mirror, so the shell can render
 * the org name and the user's role without a server round trip — and so it
 * still can with no signal at all, which the server version could never do.
 *
 * A note on the role, because it looks like a security decision and is not.
 * `role` here only decides what the interface offers: whether the "New
 * product" button is drawn, whether a cost column has a heading. It is not
 * what stops a sales user reading margins — the pull returns cost columns as
 * NULL for them, so the number is not on the device to be revealed, and every
 * write is checked again by RLS and the policies. Tampering with this value in
 * devtools would show somebody an empty column and a button whose action the
 * server refuses.
 */
import { getMeta, setMeta } from "./db";
import type { Org } from "../types";

export type AppSession = {
  userId: string;
  email: string;
  fullName: string | null;
  role: "admin" | "sales";
  orgId: string;
  orgName: string;
  reminderLanguage: "en" | "sw";
  defaultTermsDays: number;
  defaultVatRate: number;
  /** The letterhead. See the note in /api/session. */
  org: Org;
};

const KEY = "session";

type Listener = () => void;
const listeners = new Set<Listener>();

let session: AppSession | null = null;
let loaded = false;
let loading: Promise<void> | null = null;

function emit() {
  for (const listener of listeners) listener();
}

export function getAppSession(): AppSession | null {
  return session;
}
export function getServerAppSession(): null {
  return null;
}
export function subscribeAppSession(listener: Listener): () => void {
  listeners.add(listener);
  void load();
  return () => listeners.delete(listener);
}

/**
 * Cached copy first, network second.
 *
 * The stored copy is shown immediately so the shell never blanks while a
 * request is in flight, and the fresh copy replaces it when it arrives. On a
 * device with no connection the stored copy is simply the answer.
 */
export function load(): Promise<void> {
  if (loading) return loading;

  loading = (async () => {
    if (!loaded) {
      const stored = await getMeta<AppSession>(KEY);
      if (stored && !session) {
        session = stored;
        emit();
      }
      loaded = true;
    }

    try {
      const response = await fetch("/api/session", { cache: "no-store" });
      if (!response.ok) return;

      const fresh = (await response.json()) as AppSession;

      // Somebody else has signed in on this device. The stored copy belongs to
      // the previous person and must not linger in the shell.
      if (session && session.userId !== fresh.userId) session = null;

      session = fresh;
      await setMeta(KEY, fresh);
      emit();
    } catch {
      // Offline. The stored copy stands.
    } finally {
      loading = null;
    }
  })();

  return loading;
}

/** Sign out. The next person on this device must not inherit a name. */
export async function clearAppSession(): Promise<void> {
  session = null;
  loaded = false;
  await setMeta(KEY, null);
  emit();
}
