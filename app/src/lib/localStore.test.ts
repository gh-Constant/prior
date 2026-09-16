import { beforeEach, describe, expect, it, vi } from "vitest";
import { localStore } from "./localStore";

describe("localStore browser fallback", () => {
  beforeEach(() => {
    const data = new Map<string, string>();
    const storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); }, removeItem: (key: string) => { data.delete(key); }, clear: () => data.clear(), key: (index: number) => [...data.keys()][index] ?? null, get length() { return data.size; } } as Storage;
    Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });
  });

  it("creates a task immediately and records an outbox mutation", async () => {
    const task = await localStore.saveTask({ title: "Write the release notes", description: "Include the migration notes", dueDate: "2026-09-20", priority: 2, important: true, urgent: false });
    expect((await localStore.listTasks()).map((item) => item.title)).toEqual(["Write the release notes"]);
    expect((await localStore.listTasks())[0]).toMatchObject({ description: "Include the migration notes", dueDate: "2026-09-20", priority: 2 });
    expect((await localStore.pendingMutations()).filter((item) => item.entity !== "habit").map((item) => item.task.id)).toEqual([task.id]);
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

  it("persists a recurring habit and keeps its completion history in the habit mutation", async () => {
    const habit = await localStore.saveHabit({ title: "Stretch", important: false, urgent: true, interval: 2, unit: "week" });
    expect((await localStore.listHabits())[0]).toMatchObject({ id: habit.id, interval: 2, unit: "week", completedDates: [] });
    const updated = await localStore.updateHabit({ ...habit, completedDates: ["2026-09-15"] });
    expect(updated.completedDates).toEqual(["2026-09-15"]);
    expect((await localStore.pendingMutations()).at(-1)).toMatchObject({ entity: "habit", habit: { id: habit.id, completedDates: ["2026-09-15"] } });
  });

  it("starts a new habit on the local calendar day near midnight", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 16, 0, 15));
    try {
      const habit = await localStore.saveHabit({ title: "Read", important: false, urgent: false, interval: 1, unit: "day" });
      expect(habit.startDate).toBe("2026-09-16");
    } finally {
      vi.useRealTimers();
    }
  });
});
