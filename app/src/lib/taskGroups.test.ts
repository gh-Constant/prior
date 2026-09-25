import { describe, expect, it } from "vitest";
import type { Task } from "../types";
import { dueTone, groupTasksByStatus, initialsFor, taskGroupStatus, TASK_GROUP_ORDER } from "./taskGroups";

function task(id: string, overrides: Partial<Task> = {}): Task {
  return {
    id, title: id, description: "", dueDate: null, priority: 4, completed: false, important: false, urgent: false,
    createdAt: "2026-09-01T10:00:00.000Z", updatedAt: "2026-09-01T10:00:00.000Z", deletedAt: null, ...overrides,
  };
}

describe("groupTasksByStatus", () => {
  it("returns every status group in display order and keeps the incoming sort inside each group", () => {
    const tasks = [
      task("a", { status: "next" }),
      task("b", { status: "in_progress" }),
      task("c", { status: "next" }),
      task("d"),
      task("e", { status: "waiting" }),
      task("f", { status: "done", completed: true }),
      task("g", { status: "backlog" }),
    ];
    const groups = groupTasksByStatus(tasks);
    expect(groups.map((group) => group.status)).toEqual(["in_progress", "next", "inbox", "waiting", "backlog", "done"]);
    expect(groups.map((group) => group.tasks.map((item) => item.id))).toEqual([["b"], ["a", "c"], ["d"], ["e"], ["g"], ["f"]]);
  });

  it("files completed tasks under done whatever their stored status, unless a placement pins them", () => {
    const finished = task("x", { status: "next", completed: true });
    expect(taskGroupStatus(finished)).toBe("done");
    const pinned = groupTasksByStatus([finished], () => "next");
    expect(pinned.find((group) => group.status === "next")?.tasks).toHaveLength(1);
    expect(pinned.find((group) => group.status === "done")?.tasks).toHaveLength(0);
  });

  it("treats missing or unknown statuses as inbox", () => {
    expect(taskGroupStatus(task("y"))).toBe("inbox");
    expect(taskGroupStatus(task("z", { status: "bogus" as Task["status"] }))).toBe("inbox");
    expect(TASK_GROUP_ORDER).toContain("inbox");
  });
});

describe("dueTone", () => {
  const reference = new Date(2026, 8, 23, 15, 0);
  it("classifies due dates against the local day", () => {
    expect(dueTone("2026-09-22", reference)).toBe("overdue");
    expect(dueTone("2026-09-23", reference)).toBe("today");
    expect(dueTone("2026-09-24", reference)).toBe("tomorrow");
    expect(dueTone("2026-10-01", reference)).toBe("upcoming");
  });
});

describe("initialsFor", () => {
  it("builds two-letter initials from real names", () => {
    expect(initialsFor("Alex Rivera")).toBe("AR");
    expect(initialsFor("amin")).toBe("AM");
    expect(initialsFor("   ")).toBe("");
  });
});
