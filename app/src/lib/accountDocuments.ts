import { getAccountId, readScopedStorage, writeScopedStorage } from "./accountScope";
import { generateUuid } from "./uuid";

export type DocumentValue = Record<string, unknown>;
export type DocumentMutation = { id: string; key: string; patch: DocumentValue | null; seed?: boolean };
export type AccountDocuments = {
  records: Record<string, DocumentValue | null>;
  pending: DocumentMutation[];
  calendarMigrated?: boolean;
  calendarCache?: Record<string, unknown>;
};
export const ACCOUNT_DATA_KEY = "prior.account-data.v1";
export const ACCOUNT_DATA_CHANGED = "prior-account-data-changed";
export const ACCOUNT_DATA_LOCAL = "prior-account-data-local";

export function readAccountDocuments(): AccountDocuments {
  const raw = readScopedStorage(ACCOUNT_DATA_KEY);
  if (!raw) return { records: {}, pending: [] };
  const value = JSON.parse(raw) as AccountDocuments;
  if (!value.records || !Array.isArray(value.pending)) throw new Error("Invalid account sync storage");
  return value;
}

export function writeAccountDocuments(value: AccountDocuments, local = true, afterWrite?: () => void): void {
  writeScopedStorage(ACCOUNT_DATA_KEY, JSON.stringify(value));
  afterWrite?.();
  window.dispatchEvent(new Event(ACCOUNT_DATA_CHANGED));
  if (local && value.pending.length) window.dispatchEvent(new Event(ACCOUNT_DATA_LOCAL));
}

export function applyDocumentMutation(records: AccountDocuments["records"], mutation: DocumentMutation): void {
  if (mutation.seed && mutation.key in records) return;
  if (records[mutation.key] === null) return;
  records[mutation.key] = mutation.patch === null ? null : { ...records[mutation.key], ...mutation.patch };
}

export function stageDocument(documents: AccountDocuments, key: string, value: DocumentValue | null, seed = false): void {
  if (seed && key in documents.records) return;
  const previous = documents.records[key];
  if (previous === null || JSON.stringify(previous) === JSON.stringify(value)) return;
  let patch: DocumentValue | null = null;
  if (value) {
    patch = {};
    for (const field of new Set([...Object.keys(previous ?? {}), ...Object.keys(value)])) {
      if (JSON.stringify(previous?.[field] ?? null) !== JSON.stringify(value[field] ?? null)) patch[field] = value[field] ?? null;
    }
    if (previous && !Object.keys(patch).length) return;
  }
  const mutation = { id: generateUuid(), key, patch, seed };
  applyDocumentMutation(documents.records, mutation);
  documents.pending.push(mutation);
}

export function setAccountPreference(kind: "agent" | "ui", patch: DocumentValue): void {
  const documents = readAccountDocuments();
  const key = `preferences/${kind}`;
  stageDocument(documents, key, { ...documents.records[key], ...patch });
  writeAccountDocuments(documents);
}

export function reconcileDocuments(current: AccountDocuments, records: Array<{ key: string; value: DocumentValue | null }>, applied: string[]): AccountDocuments {
  const acknowledged = new Set(applied);
  const pending = current.pending.filter((mutation) => !acknowledged.has(mutation.id));
  const next = { ...current, records: Object.fromEntries(records.map((record) => [record.key, record.value])), pending };
  for (const mutation of pending) applyDocumentMutation(next.records, mutation);
  return next;
}

export async function syncAccountDocuments(token: string, isCurrent: () => boolean): Promise<void> {
  const account = getAccountId();
  const { api } = await import("./api");
  if (!isCurrent() || account !== getAccountId()) return;
  let remaining = readAccountDocuments().pending.length;
  // Always pull once; new devices and deletions must converge with an empty outbox.
  do {
    const snapshot = readAccountDocuments();
    const batch: DocumentMutation[] = [];
    let bytes = 0;
    for (const mutation of snapshot.pending.slice(0, 100)) {
      const size = new TextEncoder().encode(JSON.stringify(mutation)).length;
      if (batch.length && bytes + size > 16_000_000) break;
      batch.push(mutation); bytes += size;
    }
    const result = await api.syncAccountData(batch, token);
    if (!isCurrent() || account !== getAccountId()) return;
    const next = reconcileDocuments(readAccountDocuments(), result.records, result.applied);
    writeAccountDocuments(next, false);
    remaining -= batch.length;
  } while (remaining > 0);
}
