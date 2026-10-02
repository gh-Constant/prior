import { describe, expect, it } from "vitest";
import { MAX_ASSIGNEES, addedAssignees, assigneeFields, isAssignedTo, normalizeAssigneeIds, resolveAssigneeIds, taskAssigneeIds, toggleAssignee } from "./assignees";
import { buildTask, normalizeTask } from "./localStore";
import type { Task } from "../types";

const task: Task = { id: "t1", title: "Ship", description: "", dueDate: null, priority: 4, completed: false, important: false, urgent: false, createdAt: "2026-09-01T10:00:00.000Z", updatedAt: "2026-09-01T10:00:00.000Z", deletedAt: null };
const draft = { title: "Ship", important: false, urgent: false };
const stamp = "2026-09-02T00:00:00.000Z";

describe("assignee lists", () => {
  it("normalizes arrays and JSON text: trimmed, unique, ordered, capped", () => {
    expect(normalizeAssigneeIds([" a ", "b", "a", "", 3, null])).toEqual(["a", "b"]);
    expect(normalizeAssigneeIds('["x","y","x"]')).toEqual(["x", "y"]);
    expect(normalizeAssigneeIds("not json")).toEqual([]);
    expect(normalizeAssigneeIds(null)).toEqual([]);
    expect(normalizeAssigneeIds(Array.from({ length: 30 }, (_, index) => `u${index}`))).toHaveLength(MAX_ASSIGNEES);
  });

  it("falls back to the single assigneeId of data that predates several assignees", () => {
    expect(taskAssigneeIds({ assigneeId: "bob" })).toEqual(["bob"]);
    expect(taskAssigneeIds({ assigneeId: "bob", assigneeIds: [] })).toEqual(["bob"]);
    expect(taskAssigneeIds({ assigneeId: "bob", assigneeIds: ["cleo", "bob"] })).toEqual(["cleo", "bob"]);
    expect(taskAssigneeIds({})).toEqual([]);
    expect(assigneeFields(["cleo", "bob"])).toEqual({ assigneeId: "cleo", assigneeIds: ["cleo", "bob"] });
    expect(assigneeFields([])).toEqual({ assigneeId: null, assigneeIds: [] });
    expect(isAssignedTo({ assigneeIds: ["a", "b"] }, "b")).toBe(true);
    expect(isAssignedTo({ assigneeId: "a" }, "b")).toBe(false);
    expect(isAssignedTo({ assigneeIds: ["a"] }, null)).toBe(false);
  });

  it("toggles a person: appended when added, removed when present, capped", () => {
    expect(toggleAssignee(["a"], "b")).toEqual(["a", "b"]);
    expect(toggleAssignee(["a", "b"], "a")).toEqual(["b"]);
    expect(toggleAssignee([], "a")).toEqual(["a"]);
    const full = Array.from({ length: MAX_ASSIGNEES }, (_, index) => `u${index}`);
    expect(toggleAssignee(full, "extra")).toEqual(full);
    expect(toggleAssignee(full, "u0")).toHaveLength(MAX_ASSIGNEES - 1);
  });

  it("lists who is newly added", () => {
    expect(addedAssignees(["a"], ["a", "b", "c"])).toEqual(["b", "c"]);
    expect(addedAssignees([], [])).toEqual([]);
  });

  it("follows the server's rule when only assigneeId is sent", () => {
    const previous = { assigneeId: "a", assigneeIds: ["a", "b"] };
    expect(resolveAssigneeIds({}, previous)).toEqual(["a", "b"]);
    expect(resolveAssigneeIds({ assigneeId: "a" }, previous)).toEqual(["a", "b"]);
    expect(resolveAssigneeIds({ assigneeId: "c" }, previous)).toEqual(["c"]);
    expect(resolveAssigneeIds({ assigneeId: null }, previous)).toEqual([]);
    expect(resolveAssigneeIds({ assigneeIds: ["b"], assigneeId: "a" }, previous)).toEqual(["b"]);
    expect(resolveAssigneeIds({ assigneeIds: [] }, previous)).toEqual([]);
    expect(resolveAssigneeIds({ assigneeId: "a" })).toEqual(["a"]);
  });
});

describe("task normalization with several assignees", () => {
  it("turns a single assigneeId into a one-person list and keeps assigneeId as the first", () => {
    expect(normalizeTask({ ...task, assigneeId: "bob" })).toMatchObject({ assigneeId: "bob", assigneeIds: ["bob"] });
    expect(normalizeTask(task)).toMatchObject({ assigneeId: null, assigneeIds: [] });
    expect(normalizeTask({ ...task, assigneeId: "stale", assigneeIds: ["cleo", "bob"] })).toMatchObject({ assigneeId: "cleo", assigneeIds: ["cleo", "bob"] });
    // SQLite returns the JSON column as text.
    expect(normalizeTask({ ...task, assigneeIds: '["x","y"]' as unknown as string[] })).toMatchObject({ assigneeId: "x", assigneeIds: ["x", "y"] });
  });

  it("keeps the other assignees when a caller re-sends the same first assignee, like the server", () => {
    const stored = normalizeTask({ ...task, assigneeIds: ["a", "b"] });
    expect(buildTask({ ...draft, assigneeId: "a" }, stored, stamp, "t1").assigneeIds).toEqual(["a", "b"]);
    expect(buildTask({ ...draft, assigneeId: "c" }, stored, stamp, "t1")).toMatchObject({ assigneeId: "c", assigneeIds: ["c"] });
    expect(buildTask({ ...draft, assigneeIds: ["b", "a"] }, stored, stamp, "t1")).toMatchObject({ assigneeId: "b", assigneeIds: ["b", "a"] });
    expect(buildTask(draft, stored, stamp, "t1").assigneeIds).toEqual(["a", "b"]);
    expect(buildTask({ ...draft, assigneeIds: [] }, stored, stamp, "t1")).toMatchObject({ assigneeId: null, assigneeIds: [] });
  });
});
