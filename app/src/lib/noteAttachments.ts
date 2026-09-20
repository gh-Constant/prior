import { getAccountId, readScopedStorage, writeScopedStorage } from "./accountScope";
import { API_URL, ApiAuthError } from "./api";
import { getToken } from "./auth";
import type { NoteAttachment } from "./notes";

const KEY = "prior.note-attachments.v1";
type Attachment = NoteAttachment & { uploaded?: boolean };
export function attachmentMetadata(): Attachment[] { return JSON.parse(readScopedStorage(KEY) ?? "[]") as Attachment[]; }
function writeMetadata(items: Attachment[]) { writeScopedStorage(KEY, JSON.stringify(items)); window.dispatchEvent(new Event("prior-notes-change")); }

function localBlob(account: string, id: string, value?: Blob): Promise<Blob | undefined> {
  if (typeof indexedDB === "undefined") return value ? Promise.reject(new Error("Attachments unavailable")) : Promise.resolve(undefined);
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("prior-notes", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("attachments");
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const transaction = database.transaction("attachments", value ? "readwrite" : "readonly");
      const store = transaction.objectStore("attachments");
      let blob: Blob | undefined;
      if (value) store.put(value, `${account}:${id}`);
      else {
        const read = store.get(`${account}:${id}`);
        read.onsuccess = () => {
          blob = read.result as Blob | undefined;
          // Only attempt legacy blobs if this account owns their metadata.
          if (!blob && account === getAccountId() && attachmentMetadata().some((item) => item.id === id)) {
            const legacy = store.get(id); legacy.onsuccess = () => { blob = legacy.result as Blob | undefined; };
          }
        };
      }
      transaction.oncomplete = () => { database.close(); resolve(blob); };
      transaction.onerror = () => { database.close(); reject(transaction.error); };
      transaction.onabort = () => { database.close(); reject(transaction.error); };
    };
  });
}

export async function saveAttachment(file: NoteAttachment, blob: Blob): Promise<void> {
  if (blob.size > 8 * 1024 * 1024) throw new Error("Attachments must be 8 MB or smaller.");
  const account = getAccountId();
  await localBlob(account, file.id, blob);
  if (account !== getAccountId()) return;
  writeMetadata([...attachmentMetadata().filter((item) => item.id !== file.id), { ...file, uploaded: false }]);
}

async function attachmentRequest(path: string, token: string, init: RequestInit = {}): Promise<Response> {
  const response = await fetch(`${API_URL}/v1/note-attachments${path}`, { ...init, headers: { ...init.headers, Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(60_000) });
  if (response.status === 401) throw new ApiAuthError();
  if (!response.ok) throw new Error(`Attachment sync failed (${response.status})`);
  return response;
}

export async function loadAttachment(id: string): Promise<Blob | undefined> {
  const account = getAccountId();
  const cached = await localBlob(account, id);
  if (account !== getAccountId()) return;
  if (cached) return cached;
  const token = await getToken();
  if (!token || account !== getAccountId()) return;
  const response = await attachmentRequest(`/${encodeURIComponent(id)}`, token);
  const blob = await response.blob();
  if (account !== getAccountId()) return;
  await localBlob(account, id, blob);
  return blob;
}

export async function syncNoteAttachments(token: string, isCurrent: () => boolean): Promise<void> {
  const account = getAccountId();
  const current = () => isCurrent() && account === getAccountId();
  for (const file of attachmentMetadata().filter((item) => !item.uploaded)) {
    const blob = await localBlob(account, file.id);
    if (!current()) return;
    if (!blob) continue;
    await attachmentRequest(`/${encodeURIComponent(file.id)}?name=${encodeURIComponent(file.name)}`, token, { method: "PUT", body: blob });
    if (!current()) return;
    writeMetadata(attachmentMetadata().map((item) => item.id === file.id ? { ...item, uploaded: true } : item));
  }
  const response = await attachmentRequest("", token);
  const remote = await response.json() as Attachment[];
  if (!current()) return;
  const merged = new Map(attachmentMetadata().map((item) => [item.id, item]));
  for (const item of remote) merged.set(item.id, { ...item, uploaded: true });
  const next = [...merged.values()];
  if (JSON.stringify(next) !== JSON.stringify(attachmentMetadata())) writeMetadata(next);
}
