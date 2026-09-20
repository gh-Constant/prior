const USER_KEY = "prior.session.user";
export const ANONYMOUS_ACCOUNT_ID = "anonymous";

// These are the local collections that existed before local data became
// account-scoped. They are claimed once by the first account that signs in on
// this device, then the unscoped copies are removed so a later account cannot
// see them.
export const LEGACY_STORAGE_KEYS = [
  "prior.tasks.v1",
  "prior.habits.v1",
  "prior.outbox.v1",
  "prior.sync.v1",
  "prior.areas.v1",
  "prior.projects.v1",
  "prior.notes.v1",
  "prior.note-folders.v1",
  "prior.note-attachments.v1",
  "prior.calendar.v1",
  "prior.ai.settings.v1",
] as const;

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function accountStorageKey(baseKey: string, accountId: string): string {
  return `${baseKey}.account.v2.${encodeURIComponent(accountId)}`;
}

function itemTimestamp(value: unknown): number {
  if (!value || typeof value !== "object") return 0;
  const item = value as { updatedAt?: unknown; createdAt?: unknown };
  const timestamp = typeof item.updatedAt === "string" ? item.updatedAt : item.createdAt;
  return typeof timestamp === "string" ? Date.parse(timestamp) || 0 : 0;
}

function mergeLegacyCollections(existingRaw: string, legacyRaw: string): string {
  try {
    const existing = JSON.parse(existingRaw) as unknown;
    const legacy = JSON.parse(legacyRaw) as unknown;
    // Calendars are an object containing sources, unlike the other collections.
    // Keep offline calendars when signing into an account with existing data.
    if (existing && legacy && typeof existing === "object" && typeof legacy === "object" && "sources" in existing && "sources" in legacy && Array.isArray(existing.sources) && Array.isArray(legacy.sources)) {
      const sources = JSON.parse(mergeLegacyCollections(JSON.stringify(existing.sources), JSON.stringify(legacy.sources))) as unknown[];
      return JSON.stringify({ ...existing, sources });
    }
    if (!Array.isArray(existing) || !Array.isArray(legacy)) return existingRaw;
    const merged = new Map<string, unknown>();
    for (const item of [...legacy, ...existing]) {
      if (!item || typeof item !== "object" || typeof (item as { id?: unknown }).id !== "string") continue;
      const id = (item as { id: string }).id;
      const previous = merged.get(id);
      if (!previous || itemTimestamp(item) >= itemTimestamp(previous)) merged.set(id, item);
    }
    return JSON.stringify([...merged.values()]);
  } catch {
    return existingRaw;
  }
}

/** Return the account id used to namespace local data. */
export function getAccountId(): string {
  const store = storage();
  if (!store) return ANONYMOUS_ACCOUNT_ID;
  try {
    const raw = store.getItem(USER_KEY);
    if (!raw) return ANONYMOUS_ACCOUNT_ID;
    const user = JSON.parse(raw) as { id?: unknown };
    return typeof user.id === "string" && user.id.trim() ? user.id.trim() : ANONYMOUS_ACCOUNT_ID;
  } catch {
    return ANONYMOUS_ACCOUNT_ID;
  }
}

/**
 * Move data written by pre-account-scoped versions into one account namespace.
 * A legacy value is never deleted until its account copy has been written.
 */
export function migrateLegacyStorageForAccount(accountId = getAccountId()): void {
  if (!accountId || accountId === ANONYMOUS_ACCOUNT_ID) return;
  const store = storage();
  if (!store) return;
  for (const baseKey of LEGACY_STORAGE_KEYS) {
    try {
      const legacyRaw = store.getItem(baseKey);
      if (legacyRaw === null) continue;
      const scopedKey = accountStorageKey(baseKey, accountId);
      const existingRaw = store.getItem(scopedKey);
      store.setItem(scopedKey, existingRaw === null ? legacyRaw : mergeLegacyCollections(existingRaw, legacyRaw));
      store.removeItem(baseKey);
    } catch {
      // Storage can be unavailable or full. Keeping the legacy value is safer
      // than deleting data that has not been copied successfully.
    }
  }
}

/**
 * Claim data written while signed out (anonymous) into the authenticated account.
 */
export function claimAnonymousStorageForAccount(accountId: string): void {
  if (!accountId || accountId === ANONYMOUS_ACCOUNT_ID) return;
  const store = storage();
  if (!store) return;
  for (const baseKey of LEGACY_STORAGE_KEYS) {
    try {
      const anonKey = accountStorageKey(baseKey, ANONYMOUS_ACCOUNT_ID);
      const anonRaw = store.getItem(anonKey);
      if (anonRaw === null) continue;
      const scopedKey = accountStorageKey(baseKey, accountId);
      const existingRaw = store.getItem(scopedKey);
      store.setItem(scopedKey, existingRaw === null ? anonRaw : mergeLegacyCollections(existingRaw, anonRaw));
      store.removeItem(anonKey);
    } catch {
      // Storage can be unavailable or full.
    }
  }
}

/** Resolve a collection key for the current account. */
export function scopedStorageKey(baseKey: string): string {
  const accountId = getAccountId();
  if (accountId !== ANONYMOUS_ACCOUNT_ID) migrateLegacyStorageForAccount(accountId);
  return accountStorageKey(baseKey, accountId);
}

/** Read a scoped value for the current account. */
export function readScopedStorage(baseKey: string): string | null {
  const store = storage();
  if (!store) return null;
  const scopedKey = scopedStorageKey(baseKey);
  return store.getItem(scopedKey);
}

export function writeScopedStorage(baseKey: string, value: string): void {
  const store = storage();
  if (!store) return;
  store.setItem(scopedStorageKey(baseKey), value);
}

export function removeScopedStorage(baseKey: string): void {
  const store = storage();
  if (!store) return;
  store.removeItem(scopedStorageKey(baseKey));
}

export function emitAccountScopeChange(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("prior-auth-change"));
    window.dispatchEvent(new CustomEvent("prior-notes-change"));
    window.dispatchEvent(new CustomEvent("prior-workspace-change"));
  }
}
