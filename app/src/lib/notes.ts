export type NoteFolder = {
  id: string;
  name: string;
  parentId: string | null;
  color: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};

export type Note = {
  id: string;
  title: string;
  body: string;
  folderId: string | null;
  projectId?: string | null;
  favorite: boolean;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};

export type NoteAttachment = {
  id: string;
  name: string;
  type: string;
  size: number;
};

export const NOTE_FOLDER_COLORS = [
  { name: "Clay", value: "#c05b4d" },
  { name: "Amber", value: "#cf8347" },
  { name: "Honey", value: "#c9a227" },
  { name: "Sage", value: "#6f9a6b" },
  { name: "Ocean", value: "#5b84a8" },
  { name: "Plum", value: "#8a6faf" },
  { name: "Rose", value: "#c07b9a" },
  { name: "Stone", value: "#8a8580" },
];

const NOTES_KEY = "prior.notes.v1";
const FOLDERS_KEY = "prior.note-folders.v1";
const ATTACHMENTS_KEY = "prior.note-attachments.v1";
const CHANGE_EVENT = "prior-notes-change";

function uid(): string {
  return typeof crypto?.randomUUID === "function" ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function now(): string { return new Date().toISOString(); }

function read<T>(key: string, fallback: T): T {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) as T : fallback;
  } catch { return fallback; }
}

function write<T>(key: string, value: T): void {
  localStorage.setItem(key, JSON.stringify(value));
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
}

function normalizeFolder(folder: NoteFolder): NoteFolder {
  return { ...folder, parentId: folder.parentId ?? null, color: folder.color ?? null, deletedAt: folder.deletedAt ?? null };
}

function normalizeNote(note: Note): Note {
  return { ...note, folderId: note.folderId ?? null, projectId: note.projectId ?? null, favorite: Boolean(note.favorite), deletedAt: note.deletedAt ?? null };
}

function ensureSeed(): void {
  if (localStorage.getItem(NOTES_KEY) === null) {
    const timestamp = now();
    const welcome: Note = {
      id: uid(), title: "Welcome to Notes", folderId: null, projectId: null, favorite: true,
      body: "# Welcome to Prior Notes\n\nA calm space for your ideas. Start writing in **Markdown**.\n\n- Use `[[Note title]]` to link notes.\n- Add a `#tag` to organize thoughts.\n- Try `$E = mc^2$` for inline math.\n\n```mermaid\ngraph LR\n  Ideas --> Notes\n  Notes --> Action\n```\n",
      createdAt: timestamp, updatedAt: timestamp, deletedAt: null,
    };
    localStorage.setItem(NOTES_KEY, JSON.stringify([welcome]));
  }
  if (localStorage.getItem(FOLDERS_KEY) === null) {
    localStorage.setItem(FOLDERS_KEY, JSON.stringify([]));
  }
}

export const notesStore = {
  list(): Note[] {
    ensureSeed();
    return read<Note[]>(NOTES_KEY, []).filter((note) => !note.deletedAt).map(normalizeNote).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  },
  listTrash(): Note[] { return read<Note[]>(NOTES_KEY, []).filter((note) => Boolean(note.deletedAt)).map(normalizeNote).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)); },
  listFolders(): NoteFolder[] {
    ensureSeed();
    return read<NoteFolder[]>(FOLDERS_KEY, []).filter((folder) => !folder.deletedAt).map(normalizeFolder).sort((a, b) => a.name.localeCompare(b.name));
  },
  create(title = "Untitled note", folderId: string | null = null, projectId: string | null = null): Note {
    const timestamp = now();
    const note: Note = { id: uid(), title: title.trim() || "Untitled note", body: "", folderId, projectId, favorite: false, createdAt: timestamp, updatedAt: timestamp, deletedAt: null };
    write(NOTES_KEY, [...read<Note[]>(NOTES_KEY, []), note]);
    return note;
  },
  update(note: Note): Note {
    const saved = { ...note, title: note.title.trim() || "Untitled note", updatedAt: now(), deletedAt: null };
    write(NOTES_KEY, read<Note[]>(NOTES_KEY, []).map((item) => item.id === note.id ? saved : item));
    return saved;
  },
  trash(noteId: string): void {
    const timestamp = now();
    write(NOTES_KEY, read<Note[]>(NOTES_KEY, []).map((note) => note.id === noteId ? { ...note, deletedAt: timestamp, updatedAt: timestamp } : note));
  },
  restore(noteId: string): void { write(NOTES_KEY, read<Note[]>(NOTES_KEY, []).map((note) => note.id === noteId ? { ...note, deletedAt: null, updatedAt: now() } : note)); },
  createFolder(name: string, parentId: string | null = null, color: string | null = null): NoteFolder {
    const timestamp = now();
    const folder: NoteFolder = { id: uid(), name: name.trim() || "New folder", parentId, color, createdAt: timestamp, updatedAt: timestamp, deletedAt: null };
    write(FOLDERS_KEY, [...read<NoteFolder[]>(FOLDERS_KEY, []), folder]);
    return folder;
  },
  renameFolder(folderId: string, name: string): void {
    write(FOLDERS_KEY, read<NoteFolder[]>(FOLDERS_KEY, []).map((folder) => folder.id === folderId ? { ...folder, name: name.trim() || folder.name, updatedAt: now() } : folder));
  },
  setFolderColor(folderId: string, color: string | null): void {
    write(FOLDERS_KEY, read<NoteFolder[]>(FOLDERS_KEY, []).map((folder) => folder.id === folderId ? { ...folder, color, updatedAt: now() } : folder));
  },
  deleteFolder(folderId: string): void {
    const timestamp = now();
    const folders = read<NoteFolder[]>(FOLDERS_KEY, []);
    const target = folders.find((folder) => folder.id === folderId);
    if (!target || target.deletedAt) return;
    const newParentId = target.parentId ?? null;
    write(NOTES_KEY, read<Note[]>(NOTES_KEY, []).map((note) => note.folderId === folderId ? { ...note, folderId: newParentId, updatedAt: timestamp } : note));
    write(FOLDERS_KEY, folders.map((folder) => {
      if (folder.id === folderId) return { ...folder, deletedAt: timestamp, updatedAt: timestamp };
      if (folder.parentId === folderId) return { ...folder, parentId: newParentId, updatedAt: timestamp };
      return folder;
    }));
  },
  move(noteId: string, folderId: string | null): void {
    write(NOTES_KEY, read<Note[]>(NOTES_KEY, []).map((note) => note.id === noteId ? { ...note, folderId, updatedAt: now() } : note));
  },
  attachmentMeta(): NoteAttachment[] { return read<NoteAttachment[]>(ATTACHMENTS_KEY, []); },
  saveAttachment(file: NoteAttachment, blob: Blob): Promise<void> {
    const database = typeof indexedDB === "undefined" ? null : indexedDB;
    if (!database) return Promise.reject(new Error("Attachments are unavailable in this browser"));
    return new Promise((resolve, reject) => {
      const request = database.open("prior-notes", 1);
      request.onupgradeneeded = () => request.result.createObjectStore("attachments");
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const transaction = request.result.transaction("attachments", "readwrite");
        transaction.objectStore("attachments").put(blob, file.id);
        transaction.oncomplete = () => { write(ATTACHMENTS_KEY, [...this.attachmentMeta().filter((item) => item.id !== file.id), file]); resolve(); };
        transaction.onerror = () => reject(transaction.error);
      };
    });
  },
  loadAttachment(id: string): Promise<Blob | undefined> {
    if (typeof indexedDB === "undefined") return Promise.resolve(undefined);
    return new Promise((resolve, reject) => {
      const request = indexedDB.open("prior-notes", 1);
      request.onupgradeneeded = () => request.result.createObjectStore("attachments");
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const transaction = request.result.transaction("attachments", "readonly");
        const get = transaction.objectStore("attachments").get(id);
        get.onsuccess = () => resolve(get.result as Blob | undefined);
        get.onerror = () => reject(get.error);
      };
    });
  },
  subscribe(callback: () => void): () => void {
    window.addEventListener(CHANGE_EVENT, callback);
    window.addEventListener("storage", callback);
    return () => { window.removeEventListener(CHANGE_EVENT, callback); window.removeEventListener("storage", callback); };
  },
};
