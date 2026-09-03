"use client";

import { useSyncExternalStore } from "react";
import { getOnline, getServerOnline, subscribeOnline } from "./online";
import { getOutboxState, getServerOutboxState, subscribeOutbox, type OutboxState } from "./outbox";
import {
  getServerStorageState,
  getStorageState,
  subscribeStorage,
  type StorageState,
} from "./storage";

/**
 * Both stores hand React a server snapshot that matches the first client
 * render — online, and an empty queue. Anything else would be a hydration
 * mismatch, since neither connectivity nor IndexedDB exists on the server.
 */
export function useOnline(): boolean {
  return useSyncExternalStore(subscribeOnline, getOnline, getServerOnline);
}

export function useOutbox(): OutboxState {
  return useSyncExternalStore(subscribeOutbox, getOutboxState, getServerOutboxState);
}

export function useStorage(): StorageState {
  return useSyncExternalStore(subscribeStorage, getStorageState, getServerStorageState);
}
