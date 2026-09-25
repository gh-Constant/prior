import { useEffect, useState, useSyncExternalStore } from "react";

/**
 * Last successful sync cycle, as seen by this window. App's sync loop fires
 * "prior-sync-complete" once a cycle has pushed and pulled; nothing is
 * persisted, so a fresh launch shows no timestamp until the first sync ends.
 */
export const SYNC_COMPLETE_EVENT = "prior-sync-complete";

let lastSyncedAt: number | null = null;
const listeners = new Set<() => void>();

export function markSynced(at = Date.now()): void {
  lastSyncedAt = at;
  for (const listener of listeners) listener();
}

export function getLastSyncedAt(): number | null {
  return lastSyncedAt;
}

/** Test helper: forget the recorded sync. */
export function resetLastSyncedAt(): void {
  lastSyncedAt = null;
  for (const listener of listeners) listener();
}

if (typeof window !== "undefined") {
  window.addEventListener(SYNC_COMPLETE_EVENT, () => markSynced());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function useLastSyncedAt(): number | null {
  return useSyncExternalStore(subscribe, getLastSyncedAt, getLastSyncedAt);
}

/** Re-renders on an interval so relative labels ("2 min ago") stay fresh. */
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}

/**
 * Short relative time for the sync status: "just now" under a minute, then
 * Intl short wording ("5 min ago", "il y a 2 h") in the UI language.
 */
export function formatSyncedAgo(at: number, now: number, lang: string, justNow: string): string {
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  if (seconds < 60) return justNow;
  const format = new Intl.RelativeTimeFormat(lang, { numeric: "auto", style: "short" });
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return format.format(-minutes, "minute");
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return format.format(-hours, "hour");
  return format.format(-Math.floor(hours / 24), "day");
}
