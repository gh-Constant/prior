import { beforeEach, describe, expect, it } from "vitest";
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
    const habit = await localStore.saveHabit({ title: "Stretch", important: false, urgent: true, interval: 2, unit: "week", endDate: "2026-10-01", daysOfWeek: [6] });
    expect((await localStore.listHabits())[0]).toMatchObject({ id: habit.id, interval: 2, unit: "week", endDate: "2026-10-01", daysOfWeek: [6], completedDates: [] });
    const updated = await localStore.updateHabit({ ...habit, completedDates: ["2026-09-15"] });
    expect(updated.completedDates).toEqual(["2026-09-15"]);
    expect((await localStore.pendingMutations()).at(-1)).toMatchObject({ entity: "habit", habit: { id: habit.id, completedDates: ["2026-09-15"] } });
  });

  it("normalizes empty string due date to null and preserves booleans", async () => {
    const task = await localStore.saveTask({ title: "Task with empty due date", dueDate: "", important: false, urgent: false });
    expect(task.dueDate).toBeNull();
    const tasks = await localStore.listTasks();
    expect(tasks[0].dueDate).toBeNull();
    expect(typeof tasks[0].completed).toBe("boolean");
    expect(typeof tasks[0].important).toBe("boolean");
    expect(typeof tasks[0].urgent).toBe("boolean");
  });

  it("persists work-hub context and waiting details with a task", async () => {
    const task = await localStore.saveTask({ title: "Send the brief", areaId: "area-1", projectId: "project-1", status: "waiting", assigneeName: "Alex", followUpDate: "2026-09-22", important: true, urgent: false });
    expect(task).toMatchObject({ areaId: "area-1", projectId: "project-1", status: "waiting", assigneeName: "Alex", followUpDate: "2026-09-22" });
    expect((await localStore.listTasks())[0]).toMatchObject({ projectId: "project-1", status: "waiting" });
  });

  it("resets sync revision back to 0", async () => {
    await localStore.setSyncRevision(42);
    expect((await localStore.getSyncState()).lastServerRevision).toBe(42);
    await localStore.resetSyncRevision();
    expect((await localStore.getSyncState()).lastServerRevision).toBe(0);
  });
});
