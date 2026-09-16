import { describe, expect, it } from "vitest";
import type { Task } from "../types";
import { defaultTaskFilters } from "./taskFilters";
import { filterTasksWithExitingCompletions, pruneCompletionExits, retainCompletionExit } from "./completionExit";

function makeTask(id: string, updatedAt: string, options: Partial<Task> = {}): Task {
  return {
    id,
    title: `Task ${id}`,
    description: "",
    dueDate: null,
    priority: 4,
    completed: false,
    important: false,
    urgent: false,
    createdAt: updatedAt,
    updatedAt,
    deletedAt: null,
    ...options,
  };
}

describe("completion exit lifecycle", () => {
  it("keeps a newly completed task in the open view during its exit window", () => {
    const reference = new Date("2026-09-16T12:00:00.000Z");
    const task = makeTask("done", "2026-09-16T11:59:00.000Z", { completed: true });
    const deadlines = retainCompletionExit({}, task.id, reference.getTime());

    expect(filterTasksWithExitingCompletions([task], defaultTaskFilters, deadlines, reference, reference.getTime())).toEqual([task]);
    expect(filterTasksWithExitingCompletions([task], defaultTaskFilters, deadlines, reference, reference.getTime() + 601)).toEqual([]);
  });

  it("keeps normal filters and sort order while retaining the completed row", () => {
    const reference = new Date("2026-09-16T12:00:00.000Z");
    const tasks = [
      makeTask("old", "2026-09-16T11:00:00.000Z"),
      makeTask("done", "2026-09-16T11:59:00.000Z", { completed: true, important: true }),
      makeTask("other", "2026-09-16T11:30:00.000Z"),
    ];
    const deadlines = retainCompletionExit({}, "done", reference.getTime());

    expect(filterTasksWithExitingCompletions(
      tasks,
      { ...defaultTaskFilters, priority: "important" },
      deadlines,
      reference,
      reference.getTime(),
    ).map((task) => task.id)).toEqual(["done"]);
  });

  it("prunes expired deadlines without touching active exits", () => {
    const deadlines = { expired: 100, active: 300 };

    expect(pruneCompletionExits(deadlines, 200)).toEqual({ active: 300 });
    expect(pruneCompletionExits(deadlines, 50)).toBe(deadlines);
  });
});
