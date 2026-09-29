import { useSyncExternalStore } from "react";

/**
 * Whether Prior can currently reach its API. Shared projects live on the
 * server, so edits to them require this to be true. navigator.onLine is
 * unreliable in Tauri webviews, so API results (see request in api.ts) are
 * the source of truth and the browser events only speed up the switch.
 */
let online = typeof navigator === "undefined" ? true : navigator.onLine !== false;
const listeners = new Set<() => void>();

export function setOnline(value: boolean): void {
  if (online === value) return;
  online = value;
  for (const listener of listeners) listener();
}

export function isOnline(): boolean {
  return online;
}

if (typeof window !== "undefined") {
  window.addEventListener("offline", () => setOnline(false));
  window.addEventListener("online", () => setOnline(true));
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function useOnline(): boolean {
  return useSyncExternalStore(subscribe, isOnline, isOnline);
}
