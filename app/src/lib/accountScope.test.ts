import { beforeEach, describe, expect, it } from "vitest";
import { getAccountId, migrateLegacyStorageForAccount, scopedStorageKey } from "./accountScope";
import { localStore } from "./localStore";
import { notesStore } from "./notes";
import { workspaceStore } from "./workspaceStore";

function makeStorage(): Storage {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value); },
    removeItem: (key: string) => { data.delete(key); },
    clear: () => data.clear(),
    key: (index: number) => [...data.keys()][index] ?? null,
    get length() { return data.size; },
  } as Storage;
}

describe("account-scoped local data", () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, "localStorage", { configurable: true, value: makeStorage() });
    Object.defineProperty(globalThis, "window", { configurable: true, value: { dispatchEvent: () => true } as unknown as Window });
    localStorage.clear();
  });

  it("claims pre-account-scoped browser data for the first signed-in account", async () => {
    const task = { id: "legacy-task", title: "Keep my task", completed: false, important: false, urgent: false, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", deletedAt: null };
    localStorage.setItem("prior.session.user", JSON.stringify({ id: "account-a" }));
    localStorage.setItem("prior.tasks.v1", JSON.stringify([task]));

    expect((await localStore.listTasks()).map((item) => item.id)).toEqual(["legacy-task"]);
    expect(localStorage.getItem("prior.tasks.v1")).toBeNull();
    expect(localStorage.getItem(scopedStorageKey("prior.tasks.v1"))).toContain("legacy-task");
  });

  it("never exposes account A data after switching to account B", async () => {
    localStorage.setItem("prior.session.user", JSON.stringify({ id: "account-a" }));
    await localStore.saveTask({ title: "Account A task", important: false, urgent: false });
    const areaA = workspaceStore.createArea("Account A area");
    const noteA = notesStore.create("Account A note");

    localStorage.setItem("prior.session.user", JSON.stringify({ id: "account-b" }));
    expect(getAccountId()).toBe("account-b");
    expect(await localStore.listTasks()).toEqual([]);
    expect(workspaceStore.listAreas()).toEqual([]);
    expect(notesStore.list().some((note) => note.id === noteA.id)).toBe(false);

    const taskB = await localStore.saveTask({ title: "Account B task", important: false, urgent: false });
    expect((await localStore.listTasks()).map((task) => task.id)).toEqual([taskB.id]);
    expect(workspaceStore.listAreas()).toEqual([]);
    expect(areaA.id).not.toBe(workspaceStore.createArea("Account B area").id);
  });

  it("merges legacy collections without discarding an existing account copy", () => {
    localStorage.setItem("prior.session.user", JSON.stringify({ id: "account-a" }));
    localStorage.setItem(scopedStorageKey("prior.projects.v1"), JSON.stringify([{ id: "new", updatedAt: "2026-02-01T00:00:00.000Z" }]));
    localStorage.setItem("prior.projects.v1", JSON.stringify([{ id: "old", updatedAt: "2026-01-01T00:00:00.000Z" }]));

    migrateLegacyStorageForAccount("account-a");

    expect(JSON.parse(localStorage.getItem(scopedStorageKey("prior.projects.v1"))!)).toHaveLength(2);
    expect(localStorage.getItem("prior.projects.v1")).toBeNull();
  });
});
