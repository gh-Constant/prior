import { afterEach, describe, expect, it } from "vitest";
import type { Task } from "../types";
import {
  NO_PROJECT_COLUMN, applyKanbanMove, buildKanbanColumns, dueBucket, dueDropDate, isTaskBlocked, kanbanColumnOf,
  loadKanbanGroupBy, loadTaskLayout, saveKanbanGroupBy, saveTaskLayout, type KanbanContext,
} from "./kanban";

function task(id: string, overrides: Partial<Task> = {}): Task {
  return {
    id, title: id, description: "", dueDate: null, priority: 4, completed: false, important: false, urgent: false,
    createdAt: "2026-09-01T10:00:00.000Z", updatedAt: "2026-09-01T10:00:00.000Z", deletedAt: null, ...overrides,
  };
}

// 2026-10-01 is a Thursday.
const TODAY = "2026-10-01";
const context: KanbanContext = {
  today: TODAY,
  projects: [
    { id: "p1", name: "Website", status: "active" },
    { id: "p2", name: "Mobile app", status: "active" },
    { id: "p3", name: "Old", status: "completed" },
  ],
};

afterEach(() => localStorage.clear());

describe("dueBucket", () => {
  it("buckets dates around today", () => {
    expect(dueBucket(null, TODAY)).toBe("none");
    expect(dueBucket("2026-09-30", TODAY)).toBe("overdue");
    expect(dueBucket("2026-10-01", TODAY)).toBe("today");
    expect(dueBucket("2026-10-02T09:00:00Z", TODAY)).toBe("tomorrow");
    expect(dueBucket("2026-10-03", TODAY)).toBe("week");
    expect(dueBucket("2026-10-07", TODAY)).toBe("week");
    expect(dueBucket("2026-10-08", TODAY)).toBe("later");
  });
});

describe("dueDropDate", () => {
  it("returns a date that falls back into the column it was dropped on", () => {
    for (const bucket of ["today", "tomorrow", "week", "later"] as const) {
      const date = dueDropDate(bucket, TODAY);
      expect(typeof date).toBe("string");
      expect(dueBucket(date as string, TODAY)).toBe(bucket);
    }
    expect(dueDropDate("none", TODAY)).toBeNull();
    expect(dueDropDate("overdue", TODAY)).toBeUndefined();
  });

  it("picks the coming Friday for this week when it is in range, otherwise three days out", () => {
    // Monday 2026-09-28: Friday is 2026-10-02 (+4).
    expect(dueDropDate("week", "2026-09-28")).toBe("2026-10-02");
    // Thursday 2026-10-01: Friday is tomorrow, out of the "this week" range.
    expect(dueDropDate("week", TODAY)).toBe("2026-10-04");
    // Saturday 2026-10-03: the next Friday is +6.
    expect(dueDropDate("week", "2026-10-03")).toBe("2026-10-09");
  });
});

describe("buildKanbanColumns", () => {
  const tasks = [
    task("a", { status: "next", priority: 1, projectId: "p1", dueDate: "2026-09-20" }),
    task("b", { status: "in_progress", priority: 2, projectId: "p2", dueDate: TODAY }),
    task("c", { priority: 4 }),
    task("d", { status: "done", completed: true, priority: 3, projectId: "p1" }),
    task("e", { status: "waiting", projectId: "ghost" }),
  ];

  it("groups by status in the list order and adds the hidden completed tasks to Done", () => {
    const hidden = task("z", { status: "done", completed: true });
    const columns = buildKanbanColumns(tasks.filter((item) => !item.completed), "status", { ...context, doneTasks: [hidden] });
    expect(columns.map((column) => column.id)).toEqual(["in_progress", "next", "inbox", "waiting", "backlog", "done"]);
    expect(columns.map((column) => column.tasks.map((item) => item.id))).toEqual([["b"], ["a"], ["c"], ["e"], [], ["z"]]);
    expect(columns.find((column) => column.id === "done")?.canAdd).toBe(false);
  });

  it("groups by priority from P1 to P4", () => {
    const columns = buildKanbanColumns(tasks, "priority", context);
    expect(columns.map((column) => [column.id, column.tasks.map((item) => item.id)])).toEqual([["1", ["a"]], ["2", ["b"]], ["3", ["d"]], ["4", ["c", "e"]]]);
  });

  it("groups by project with a No project column, hiding finished projects without tasks", () => {
    const columns = buildKanbanColumns(tasks, "project", context);
    expect(columns.map((column) => column.id)).toEqual([NO_PROJECT_COLUMN, "p1", "p2"]);
    // A task pointing at an unknown project falls back to "No project".
    expect(columns[0].tasks.map((item) => item.id)).toEqual(["c", "e"]);
    expect(columns[1].label).toBe("Website");
    const withOld = buildKanbanColumns([task("o", { projectId: "p3" })], "project", context);
    expect(withOld.map((column) => column.id)).toContain("p3");
  });

  it("groups by due date and keeps Overdue read-only", () => {
    const columns = buildKanbanColumns(tasks, "due", context);
    expect(columns.map((column) => column.id)).toEqual(["overdue", "today", "tomorrow", "week", "later", "none"]);
    expect(columns.map((column) => column.tasks.length)).toEqual([1, 1, 0, 0, 0, 3]);
    expect(columns[0].droppable).toBe(false);
    expect(columns.slice(1).every((column) => column.droppable)).toBe(true);
  });
});

describe("applyKanbanMove", () => {
  it("sets the status, and completion with it", () => {
    const open = task("a", { status: "next" });
    expect(applyKanbanMove(open, "status", "in_progress", context)).toMatchObject({ status: "in_progress", completed: false });
    expect(applyKanbanMove(open, "status", "done", context)).toMatchObject({ status: "done", completed: true });
    const done = task("b", { status: "done", completed: true });
    expect(applyKanbanMove(done, "status", "next", context)).toMatchObject({ status: "next", completed: false });
    expect(applyKanbanMove(open, "status", "next", context)).toBeNull();
    expect(applyKanbanMove(open, "status", "nonsense", context)).toBeNull();
  });

  it("treats a task without a status as inbox", () => {
    expect(kanbanColumnOf(task("a"), "status", context)).toBe("inbox");
    expect(applyKanbanMove(task("a"), "status", "inbox", context)).toBeNull();
  });

  it("sets the priority", () => {
    expect(applyKanbanMove(task("a", { priority: 4 }), "priority", "1", context)?.priority).toBe(1);
    expect(applyKanbanMove(task("a", { priority: 2 }), "priority", "2", context)).toBeNull();
    expect(applyKanbanMove(task("a"), "priority", "9", context)).toBeNull();
  });

  it("moves between projects and clears the links that only make sense inside one", () => {
    const linked = task("a", { projectId: "p1", milestoneId: "m1", parentId: "t0" });
    expect(applyKanbanMove(linked, "project", "p2", context)).toMatchObject({ projectId: "p2", milestoneId: null, parentId: null });
    expect(applyKanbanMove(linked, "project", NO_PROJECT_COLUMN, context)).toMatchObject({ projectId: null });
    expect(applyKanbanMove(linked, "project", "p1", context)).toBeNull();
    expect(applyKanbanMove(linked, "project", "unknown", context)).toBeNull();
  });

  it("assigns due dates, clears them, and refuses Overdue", () => {
    const dated = task("a", { dueDate: "2026-09-20", dueTime: "09:30" });
    expect(applyKanbanMove(dated, "due", "today", context)).toMatchObject({ dueDate: TODAY, dueTime: "09:30" });
    expect(applyKanbanMove(dated, "due", "none", context)).toMatchObject({ dueDate: null, dueTime: null });
    expect(applyKanbanMove(task("b", { dueDate: TODAY }), "due", "overdue", context)).toBeNull();
    expect(applyKanbanMove(task("b", { dueDate: TODAY }), "due", "today", context)).toBeNull();
  });
});

describe("isTaskBlocked", () => {
  it("is blocked while a blocker is not completed", () => {
    const byId = new Map([["open", { completed: false }], ["done", { completed: true }]]);
    expect(isTaskBlocked({ relations: [{ type: "blocked_by", taskId: "open" }] }, byId)).toBe(true);
    expect(isTaskBlocked({ relations: [{ type: "blocked_by", taskId: "done" }] }, byId)).toBe(false);
    expect(isTaskBlocked({ relations: [{ type: "related", taskId: "open" }] }, byId)).toBe(false);
    expect(isTaskBlocked({}, byId)).toBe(false);
  });
});

describe("persisted preferences", () => {
  it("round-trips the layout and grouping and falls back to safe defaults", () => {
    expect(loadTaskLayout()).toBe("list");
    expect(loadKanbanGroupBy()).toBe("status");
    saveTaskLayout("board");
    saveKanbanGroupBy("due");
    expect(loadTaskLayout()).toBe("board");
    expect(loadKanbanGroupBy()).toBe("due");
    localStorage.setItem("prior.tasks.groupBy", "bogus");
    expect(loadKanbanGroupBy()).toBe("status");
  });
});
