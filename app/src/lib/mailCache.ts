import type { MailMessage } from "../types";
import { readScopedStorage, writeScopedStorage } from "./accountScope";

/**
 * Stale-while-revalidate cache for mail lists (Gmail-style).
 *
 * The list for each folder/search is persisted per account, so reopening the
 * inbox shows the last known messages instantly while a fresh fetch runs in
 * the background. Heavy HTML bodies are stripped before persisting to stay
 * far under the localStorage quota; they come back with the next fetch.
 */

export type CachedMailPage = {
  messages: MailMessage[];
  nextPageToken?: string;
  savedAt: number;
};

const CACHE_PREFIX = "prior.mail.cache.v2.";
const CACHE_TTL_MS = 10 * 60 * 1000;
const MAX_CACHED_MESSAGES = 25;

function sanitizeKeyPart(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 80);
}

export function mailCacheKey(parts: { provider: string; account: string; folder: string; label: string; query: string }): string {
  return (
    CACHE_PREFIX +
    [parts.provider, parts.account, parts.folder, parts.label || "all", parts.query || "none"]
      .map(sanitizeKeyPart)
      .join(".")
  );
}

export function readMailCache(key: string): CachedMailPage | null {
  try {
    const raw = readScopedStorage(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedMailPage;
    if (!parsed || !Array.isArray(parsed.messages) || typeof parsed.savedAt !== "number") return null;
    if (Date.now() - parsed.savedAt > CACHE_TTL_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeMailCache(key: string, messages: MailMessage[], nextPageToken?: string): void {
  try {
    const light = messages.slice(0, MAX_CACHED_MESSAGES).map((m) => {
      const { bodyHtml: _dropped, ...rest } = m;
      return rest;
    });
    const payload: CachedMailPage = { messages: light, nextPageToken, savedAt: Date.now() };
    writeScopedStorage(key, JSON.stringify(payload));
  } catch {
    // Quota exceeded or storage unavailable: caching is best-effort.
  }
}
