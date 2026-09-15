import { beforeEach, describe, expect, it } from "vitest";
import { localStore } from "./localStore";

describe("localStore browser fallback", () => {
  beforeEach(() => {
    const data = new Map<string, string>();
    const storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); }, removeItem: (key: string) => { data.delete(key); }, clear: () => data.clear(), key: (index: number) => [...data.keys()][index] ?? null, get length() { return data.size; } } as Storage;
    Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });
  });

  it("creates a task immediately and records an outbox mutation", async () => {
    const task = await localStore.saveTask({ title: "Write the release notes", important: true, urgent: false });
    expect((await localStore.listTasks()).map((item) => item.title)).toEqual(["Write the release notes"]);
    expect((await localStore.pendingMutations()).map((item) => item.task.id)).toEqual([task.id]);
  });

  it("preserves task fields while updating and uses a tombstone for deletes", async () => {
    const task = await localStore.saveTask({ title: "Keep this task", important: true, urgent: true });
    const updated = await localStore.updateTask({ ...task, completed: true, title: "Updated task" });
    expect(updated.completed).toBe(true);
    expect(updated.createdAt).toBe(task.createdAt);
    await localStore.removeTask(updated);
    expect(await localStore.listTasks()).toEqual([]);
    expect((await localStore.pendingMutations()).at(-1)?.kind).toBe("delete");
  });

  it("keeps an unsynced local edit ahead of an incoming remote snapshot", async () => {
    const local = await localStore.saveTask({ title: "Local wording", important: true, urgent: false });
    await localStore.applyRemoteTasks([{ ...local, title: "Remote wording", serverRevision: 42 }]);
    expect((await localStore.listTasks())[0]?.title).toBe("Local wording");
  });
});
