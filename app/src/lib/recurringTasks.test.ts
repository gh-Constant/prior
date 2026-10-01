import { beforeEach, describe, expect, it } from "vitest";
import { localStore, normalizeTask } from "./localStore";
import { updateTaskAndRepeat } from "./recurringTasks";

describe("recurring tasks in the local store", () => {
  beforeEach(() => {
    const data = new Map<string, string>();
    const storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); }, removeItem: (key: string) => { data.delete(key); }, clear: () => data.clear(), key: (index: number) => [...data.keys()][index] ?? null, get length() { return data.size; } } as Storage;
    Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });
  });

  it("round-trips a recurrence through the store and the outbox", async () => {
    const task = await localStore.saveTask({ title: "Water plants", important: false, urgent: false, dueDate: "2026-10-01", recurrence: { interval: 2, unit: "week", daysOfWeek: [4, 1], basis: "completion" } });
    expect(task.recurrence).toEqual({ interval: 2, unit: "week", daysOfWeek: [1, 4], basis: "completion" });
    expect((await localStore.listTasks())[0]?.recurrence).toEqual(task.recurrence);
    expect((await localStore.pendingMutations()).at(-1)).toMatchObject({ entity: "task", task: { id: task.id, recurrence: { interval: 2, unit: "week" } } });
  });

  it("keeps the rule when an edit does not mention it and clears it only on null", async () => {
    const task = await localStore.saveTask({ title: "Water plants", important: false, urgent: false, recurrence: { interval: 1, unit: "day" } });
    const renamed = await localStore.saveTask({ id: task.id, title: "Water the plants", important: false, urgent: false });
    expect(renamed.recurrence).toEqual({ interval: 1, unit: "day" });
    const cleared = await localStore.saveTask({ id: task.id, title: "Water the plants", important: false, urgent: false, recurrence: null });
    expect(cleared.recurrence).toBeNull();
  });

  it("reads old data and invalid rules as no recurrence", () => {
    const base = { id: "t", title: "x", completed: false, important: false, urgent: false, createdAt: "", updatedAt: "", deletedAt: null };
    expect(normalizeTask({ ...base } as never).recurrence).toBeNull();
    expect(normalizeTask({ ...base, recurrence: { interval: 0, unit: "day" } } as never).recurrence).toBeNull();
    expect(normalizeTask({ ...base, recurrence: "{not json" } as never).recurrence).toBeNull();
    // SQLite returns the JSON text of the column.
    expect(normalizeTask({ ...base, recurrence: '{"interval":3,"unit":"month"}' } as never).recurrence).toEqual({ interval: 3, unit: "month" });
  });

  it("completing a recurring task saves it without a rule and creates the next occurrence", async () => {
    const task = await localStore.saveTask({
      title: "Water plants", important: true, urgent: false, status: "waiting", dueDate: "2026-10-01", dueTime: "09:00", priority: 2,
      checklist: [{ id: "a", title: "Fern", done: true, position: 0 }], recurrence: { interval: 1, unit: "day" },
    });
    const now = new Date(2026, 9, 1, 12, 0, 0);
    const { saved, next } = await updateTaskAndRepeat({ ...task, completed: true, status: "done" }, task, now);
    expect(saved).toMatchObject({ id: task.id, completed: true, recurrence: null });
    expect(next).toMatchObject({ title: "Water plants", completed: false, status: "next", dueDate: "2026-10-02", dueTime: "09:00", priority: 2, important: true, recurrence: { interval: 1, unit: "day" } });
    expect(next!.id).not.toBe(task.id);
    expect(next!.checklist).toHaveLength(1);
    expect(next!.checklist![0]).toMatchObject({ title: "Fern", done: false });
    const stored = await localStore.listTasks();
    expect(stored).toHaveLength(2);
    expect(stored.find((item) => item.id === task.id)?.recurrence).toBeNull();
    // Both writes are in the outbox, so every device gets the completed task and the new one.
    const pushed = (await localStore.pendingMutations()).filter((item) => item.entity !== "habit").map((item) => item.task.id);
    expect(pushed).toEqual(expect.arrayContaining([task.id, next!.id]));
  });

  it("does not repeat on reopening, on a task that is already completed, or without a rule", async () => {
    const task = await localStore.saveTask({ title: "Water plants", important: false, urgent: false, dueDate: "2026-10-01", recurrence: { interval: 1, unit: "day" } });
    const reopened = await updateTaskAndRepeat({ ...task, title: "Water plants!" }, task);
    expect(reopened.next).toBeNull();
    expect(reopened.saved.recurrence).toEqual({ interval: 1, unit: "day" });
    const done = { ...task, completed: true, status: "done" as const };
    expect((await updateTaskAndRepeat(done, { ...task, completed: true, status: "done" })).next).toBeNull();
    const plain = await localStore.saveTask({ title: "Once", important: false, urgent: false });
    expect((await updateTaskAndRepeat({ ...plain, completed: true, status: "done" }, plain)).next).toBeNull();
    expect(await localStore.listTasks()).toHaveLength(2);
  });

  it("ends the series after its last occurrence", async () => {
    const task = await localStore.saveTask({ title: "Short series", important: false, urgent: false, dueDate: "2026-10-01", recurrence: { interval: 1, unit: "day", until: "2026-10-01" } });
    const { saved, next } = await updateTaskAndRepeat({ ...task, completed: true, status: "done" }, task, new Date(2026, 9, 1, 12));
    expect(next).toBeNull();
    expect(saved.completed).toBe(true);
    expect(await localStore.listTasks()).toHaveLength(1);
  });
});
