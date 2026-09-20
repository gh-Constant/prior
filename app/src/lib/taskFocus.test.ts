import { describe, expect, it } from "vitest";
import type { Task } from "../types";
import { rankFocusTasks } from "./taskFocus";

function task(id: string, fields: Partial<Task> = {}): Task {
  return {
    id,
    title: id,
    description: "",
    dueDate: null,
    priority: 4,
    status: "next",
    completed: false,
    important: false,
    urgent: false,
    createdAt: "2026-09-20T08:00:00.000Z",
    updatedAt: "2026-09-20T08:00:00.000Z",
    deletedAt: null,
    ...fields,
  };
}

describe("rankFocusTasks", () => {
  it("includes important tasks without a due date", () => {
    expect(rankFocusTasks([task("routine"), task("important", { important: true })], "2026-09-20").map((item) => item.id)).toEqual(["important", "routine"]);
  });

  it("prioritizes overdue and due-today work over routine next actions", () => {
    const tasks = [
      task("routine"),
      task("today", { dueDate: "2026-09-20" }),
      task("overdue", { dueDate: "2026-09-19" }),
    ];
    expect(rankFocusTasks(tasks, "2026-09-20").map((item) => item.id)).toEqual(["overdue", "today", "routine"]);
  });

  it("does not pull untriaged, waiting, or backlog work into focus", () => {
    const tasks = [
      task("inbox", { status: "inbox" }),
      task("waiting", { status: "waiting" }),
      task("backlog", { status: "backlog" }),
      task("urgent-inbox", { status: "inbox", urgent: true }),
    ];
    expect(rankFocusTasks(tasks, "2026-09-20").map((item) => item.id)).toEqual(["urgent-inbox"]);
  });
});
