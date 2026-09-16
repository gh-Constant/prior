import { describe, expect, it } from "vitest";
import type { Task } from "../types";
import { defaultTaskFilters, filterTasks } from "./taskFilters";

const reference = new Date("2026-09-15T12:00:00.000Z");

function makeTask(id: string, createdAt: string, options: Partial<Task> = {}): Task {
  return {
    id,
    title: `Task ${id}`,
    description: "",
    dueDate: null,
    priority: 4,
    completed: false,
    important: false,
    urgent: false,
    createdAt,
    updatedAt: createdAt,
    deletedAt: null,
    ...options,
  };
}

describe("filterTasks", () => {
  it("hides completed tasks by default and keeps recent tasks first", () => {
    const tasks = [
      makeTask("old", "2026-09-01T12:00:00.000Z"),
      makeTask("done", "2026-09-15T10:00:00.000Z", { completed: true }),
      makeTask("new", "2026-09-15T11:00:00.000Z"),
    ];

    expect(filterTasks(tasks, defaultTaskFilters, reference).map((task) => task.id)).toEqual(["new", "old"]);
  });

  it("combines search, priority, and completed filters", () => {
    const tasks = [
      makeTask("urgent", "2026-09-15T10:00:00.000Z", { title: "Call the client", urgent: true }),
      makeTask("both", "2026-09-15T11:00:00.000Z", { title: "Plan the launch", important: true, urgent: true }),
      makeTask("done", "2026-09-15T09:00:00.000Z", { title: "Plan the launch", completed: true, important: true, urgent: true }),
    ];

    expect(filterTasks(tasks, { ...defaultTaskFilters, query: "launch", priority: "both" }, reference).map((task) => task.id)).toEqual(["both"]);
    expect(filterTasks(tasks, { ...defaultTaskFilters, status: "completed" }, reference).map((task) => task.id)).toEqual(["done"]);
  });

  it("filters the explicit P1–P4 task priority separately from the matrix flags", () => {
    const tasks = [
      makeTask("p1", "2026-09-15T10:00:00.000Z", { priority: 1, important: false }),
      makeTask("p4", "2026-09-15T11:00:00.000Z", { priority: 4, important: true }),
    ];

    expect(filterTasks(tasks, { ...defaultTaskFilters, taskPriority: "p1" }, reference).map((task) => task.id)).toEqual(["p1"]);
    expect(filterTasks(tasks, { ...defaultTaskFilters, priority: "important" }, reference).map((task) => task.id)).toEqual(["p4"]);
  });

  it("filters tasks added today or earlier", () => {
    const tasks = [
      makeTask("today", "2026-09-15T08:00:00.000Z"),
      makeTask("week", "2026-09-12T08:00:00.000Z"),
      makeTask("older", "2026-09-01T08:00:00.000Z"),
    ];

    expect(filterTasks(tasks, { ...defaultTaskFilters, date: "today" }, reference).map((task) => task.id)).toEqual(["today"]);
    expect(filterTasks(tasks, { ...defaultTaskFilters, date: "older" }, reference).map((task) => task.id)).toEqual(["older"]);
  });
});
