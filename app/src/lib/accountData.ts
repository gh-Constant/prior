// Account lifecycle helpers on the device (specs/ACCOUNT.md): saving files,
// exporting local data without an account, and wiping everything an account
// left on this device after it is deleted.
import { localStore } from "./localStore";
import { workspaceStore } from "./workspaceStore";
import { notesStore } from "./notes";

/** Saves a Blob through the browser/webview download flow. */
export function saveBlob(blob: Blob, filename: string): void {
  if (typeof document === "undefined") return;
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export type LocalExport = {
  format: "prior-local-export";
  version: 1;
  exportedAt: string;
  tasks: unknown[];
  habits: unknown[];
  areas: unknown[];
  projects: unknown[];
  noteFolders: unknown[];
  notes: unknown[];
};

/** Everything stored on this device for the current (possibly anonymous) scope. */
export async function buildLocalExport(now = new Date()): Promise<LocalExport> {
  const [tasks, habits] = await Promise.all([localStore.listAllTasks(), localStore.listAllHabits()]);
  return {
    format: "prior-local-export",
    version: 1,
    exportedAt: now.toISOString(),
    tasks: tasks.filter((task) => !task.deletedAt),
    habits: habits.filter((habit) => !habit.deletedAt),
    areas: workspaceStore.listAreas(),
    projects: workspaceStore.listProjects(),
    noteFolders: notesStore.listFolders(),
    notes: notesStore.list(),
  };
}

export async function exportLocalData(now = new Date()): Promise<void> {
  const data = await buildLocalExport(now);
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  saveBlob(blob, `prior-local-export-${now.toISOString().slice(0, 10)}.json`);
}

// Device UI state that can name private items (open note tabs and so on).
const DEVICE_KEYS = ["prior.notes.tabs", "prior.notes.library", "prior.notes.collapsed", "prior.auth.handled_codes"];

function deleteAttachmentBlobs(accountId: string): Promise<void> {
  if (typeof indexedDB === "undefined") return Promise.resolve();
  return new Promise((resolve) => {
    const request = indexedDB.open("prior-notes", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("attachments");
    request.onerror = () => resolve();
    request.onsuccess = () => {
      const database = request.result;
      const transaction = database.transaction("attachments", "readwrite");
      const store = transaction.objectStore("attachments");
      const prefix = `${accountId}:`;
      const range = IDBKeyRange.bound(prefix, `${prefix}￿`);
      store.delete(range);
      transaction.oncomplete = () => { database.close(); resolve(); };
      transaction.onerror = () => { database.close(); resolve(); };
      transaction.onabort = () => { database.close(); resolve(); };
    };
  });
}

/**
 * Removes every local trace of a deleted account: SQLite rows, the
 * account-scoped localStorage collections (tasks, workspace, notes, game
 * cache, settings), cached attachments and device UI state. The session and
 * keychain entry are cleared separately by clearSession.
 */
export async function wipeAccountLocalData(accountId: string): Promise<void> {
  await localStore.wipeAccount(accountId).catch((error) => console.warn("Prior could not wipe the local database:", error));
  try {
    const suffix = `.account.v2.${encodeURIComponent(accountId)}`;
    const keys: string[] = [];
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (key && (key.endsWith(suffix) || DEVICE_KEYS.includes(key))) keys.push(key);
    }
    for (const key of keys) localStorage.removeItem(key);
  } catch {
    // storage unavailable
  }
  await deleteAttachmentBlobs(accountId);
}
