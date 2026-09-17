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

  it("stores folder colors and normalizes legacy folders", () => {
    const plain = notesStore.createFolder("Plain");
    expect(plain.color).toBeNull();
    expect(notesStore.listFolders().find((folder) => folder.id === plain.id)?.color).toBeNull();
    notesStore.setFolderColor(plain.id, "#5b84a8");
    expect(notesStore.listFolders().find((folder) => folder.id === plain.id)?.color).toBe("#5b84a8");
    notesStore.setFolderColor(plain.id, null);
    expect(notesStore.listFolders().find((folder) => folder.id === plain.id)?.color).toBeNull();
  });

  it("links notes to a project without requiring a note folder", () => {
    const note = notesStore.create("Launch brief", null, "project-1");
    expect(notesStore.list().find((item) => item.id === note.id)?.projectId).toBe("project-1");
  });

  it("places new project notes in the project's workspace category", () => {
    const folder = notesStore.ensureWorkspaceFolder("project", "project-1", "Launch site", null, "#c96551", "rocket");
    const note = notesStore.create("Launch brief", null, "project-1");
    expect(note.folderId).toBe(folder.id);
    expect(notesStore.list().find((item) => item.id === note.id)).toMatchObject({ projectId: "project-1", folderId: folder.id });
  });

  it("deletes a folder while keeping its notes and subfolders", () => {
    const projects = notesStore.createFolder("Projects");
    const research = notesStore.createFolder("Research", projects.id);
    const note = notesStore.create("Experiment", research.id);
    notesStore.deleteFolder(research.id);
    expect(notesStore.listFolders().some((folder) => folder.id === research.id)).toBe(false);
    expect(notesStore.list().find((item) => item.id === note.id)?.folderId).toBe(projects.id);
    notesStore.deleteFolder(projects.id);
    expect(notesStore.list().find((item) => item.id === note.id)?.folderId).toBeNull();
  });

  it("moves notes between folders and preserves project scope", () => {
    const folderA = notesStore.createFolder("Folder A");
    const folderB = notesStore.createFolder("Folder B");
    const note = notesStore.create("Scoped note", folderA.id, "project-xyz");

    // Move to folder B
    notesStore.move(note.id, folderB.id);
    const moved = notesStore.list().find((item) => item.id === note.id);
    expect(moved?.folderId).toBe(folderB.id);
    expect(moved?.projectId).toBe("project-xyz");

    // Move to Library (root)
    notesStore.move(note.id, null);
    const inRoot = notesStore.list().find((item) => item.id === note.id);
    expect(inRoot?.folderId).toBeNull();
    expect(inRoot?.projectId).toBe("project-xyz");
  });

  it("moves folders and protects against cyclic moves", () => {
    const rootA = notesStore.createFolder("Root A");
    const childA = notesStore.createFolder("Child A", rootA.id);
    const grandChildA = notesStore.createFolder("Grandchild A", childA.id);
    const rootB = notesStore.createFolder("Root B");

    // Valid move: move childA to rootB
    const valid = notesStore.moveFolder(childA.id, rootB.id);
    expect(valid).toBe(true);
    expect(notesStore.listFolders().find((f) => f.id === childA.id)?.parentId).toBe(rootB.id);

    // Invalid move: move rootB into itself
    expect(notesStore.moveFolder(rootB.id, rootB.id)).toBe(false);

    // Invalid move: move rootB into its descendant childA or grandChildA
    expect(notesStore.moveFolder(rootB.id, childA.id)).toBe(false);
    expect(notesStore.moveFolder(rootB.id, grandChildA.id)).toBe(false);

    // Valid move: move childA back to Library (null)
    expect(notesStore.moveFolder(childA.id, null)).toBe(true);
    expect(notesStore.listFolders().find((f) => f.id === childA.id)?.parentId).toBeNull();
  });

  it("exports tombstones and merges the newest remote note version", () => {
    const note = notesStore.create("Local note");
    const exported = notesStore.exportAll();
    notesStore.mergeRemote({
      folders: [],
      notes: [{ ...note, body: "Remote body", updatedAt: "2999-01-01T00:00:00.000Z" }],
    });
    expect(notesStore.exportAll().notes.find((item) => item.id === note.id)?.body).toBe("Remote body");
    expect(exported.notes.find((item) => item.id === note.id)?.body).toBe("");
  });
});
