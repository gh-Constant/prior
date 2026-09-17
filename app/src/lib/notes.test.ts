import { beforeEach, describe, expect, it } from "vitest";
import { notesStore } from "./notes";

describe("notesStore", () => {
  beforeEach(() => {
    const data = new Map<string, string>();
    Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => data.set(key, value), removeItem: (key: string) => data.delete(key), clear: () => data.clear() } as unknown as Storage });
    Object.defineProperty(globalThis, "window", { configurable: true, value: { dispatchEvent: () => true, addEventListener: () => undefined, removeEventListener: () => undefined } as unknown as Window });
    localStorage.clear();
  });

  it("seeds a welcome note and supports nested folders", () => {
    const welcome = notesStore.list()[0];
    expect(welcome.title).toBe("Welcome to Notes");
    const projects = notesStore.createFolder("Projects");
    const research = notesStore.createFolder("Research", projects.id);
    const note = notesStore.create("Experiment", research.id);
    expect(notesStore.listFolders().find((folder) => folder.id === research.id)?.parentId).toBe(projects.id);
    expect(notesStore.list().find((item) => item.id === note.id)?.folderId).toBe(research.id);
  });

  it("updates, trashes, and restores a note without losing its body", () => {
    const note = notesStore.create("Draft");
    notesStore.update({ ...note, body: "# Kept" });
    notesStore.trash(note.id);
    expect(notesStore.list().some((item) => item.id === note.id)).toBe(false);
    expect(notesStore.listTrash().find((item) => item.id === note.id)?.body).toBe("# Kept");
    notesStore.restore(note.id);
    expect(notesStore.list().find((item) => item.id === note.id)?.body).toBe("# Kept");
  });
});
