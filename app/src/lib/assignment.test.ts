import { describe, expect, it } from "vitest";
import { isAssignedToSomeoneElse, localProjectActivity, newlyAssignedToMe, tasksAssignedTo, withAssignee, withAssignees } from "./assignment";
import { activityLevel, activityWeeks, currentStreak } from "../components/collaboration/ProjectActivity";
import type { Task } from "../types";

const base: Task = { id: "t1", title: "Ship", description: "", dueDate: null, priority: 4, projectId: "p1", peopleIds: ["me"], completed: false, important: false, urgent: false, createdAt: "2026-09-01T10:00:00.000Z", updatedAt: "2026-09-01T10:00:00.000Z", deletedAt: null };

describe("task assignment", () => {
  it("assigns a task and adds the assignee to its people once", () => {
    const assigned = withAssignee(base, "bob");
    expect(assigned).toMatchObject({ assigneeId: "bob", peopleIds: ["me", "bob"] });
    expect(withAssignee(assigned, "bob").peopleIds).toEqual(["me", "bob"]);
    expect(withAssignee(assigned, null)).toMatchObject({ assigneeId: null, peopleIds: ["me", "bob"] });
  });

  it("assigns several people in order, keeping assigneeId as the first and adding each to the people", () => {
    const assigned = withAssignees(base, ["bob", "me", "cleo", "bob"]);
    expect(assigned).toMatchObject({ assigneeId: "bob", assigneeIds: ["bob", "me", "cleo"], peopleIds: ["me", "bob", "cleo"] });
    expect(withAssignees(assigned, ["cleo"])).toMatchObject({ assigneeId: "cleo", assigneeIds: ["cleo"] });
    expect(withAssignees(assigned, [])).toMatchObject({ assigneeId: null, assigneeIds: [] });
  });

  it("lists a task under every assignee in My tasks, and only hides it from people who are not one", () => {
    const shared = { ...base, id: "s", assigneeId: "bob", assigneeIds: ["bob", "me"] };
    const bobOnly = { ...base, id: "b", assigneeId: "bob", assigneeIds: ["bob"] };
    const legacy = { ...base, id: "l", assigneeId: "me" };
    const all = [shared, bobOnly, legacy];
    expect(tasksAssignedTo(all, "me").map((task) => task.id)).toEqual(["s", "l"]);
    expect(tasksAssignedTo(all, "bob").map((task) => task.id)).toEqual(["s", "b"]);
    expect(all.filter((task) => !isAssignedToSomeoneElse(task, "me")).map((task) => task.id)).toEqual(["s", "l"]);
  });

  it("notifies each newly added assignee once, never the ones who were already assigned", () => {
    const now = Date.parse("2026-09-30T12:00:00Z");
    const task = { ...base, id: "a", assigneeId: "bob", assigneeIds: ["bob", "me"], updatedAt: "2026-09-30T11:58:00Z" };
    const before = new Map([["a", { assigneeId: "bob", assigneeIds: ["bob"] }]]);
    expect(newlyAssignedToMe(before, [task], "me", now)).toHaveLength(1);
    expect(newlyAssignedToMe(before, [task], "bob", now)).toHaveLength(0);
    expect(newlyAssignedToMe(new Map([["a", { assigneeId: "bob", assigneeIds: ["bob", "me"] }]]), [task], "me", now)).toHaveLength(0);
    // An older server only sends assigneeId: it counts as a one-person list.
    expect(newlyAssignedToMe(new Map([["a", { assigneeId: "bob" }]]), [{ ...task, assigneeIds: undefined }], "me", now)).toHaveLength(0);
    expect(newlyAssignedToMe(new Map(), [task], "me", now)).toHaveLength(1);
  });

  it("finds my tasks and hides tasks someone else owns from my day", () => {
    const mine = { ...base, id: "a", assigneeId: "me" };
    const theirs = { ...base, id: "b", assigneeId: "bob" };
    const nobody = { ...base, id: "c" };
    expect(tasksAssignedTo([mine, theirs, nobody], "me").map((task) => task.id)).toEqual(["a"]);
    expect(tasksAssignedTo([mine], null)).toEqual([]);
    expect([mine, theirs, nobody].filter((task) => !isAssignedToSomeoneElse(task, "me")).map((task) => task.id)).toEqual(["a", "c"]);
  });

  it("notifies only fresh assignments to me", () => {
    const now = Date.parse("2026-09-30T12:00:00Z");
    const fresh = { ...base, id: "a", assigneeId: "me", updatedAt: "2026-09-30T11:58:00Z" };
    const old = { ...base, id: "b", assigneeId: "me", updatedAt: "2026-09-20T11:58:00Z" };
    const already = { ...base, id: "c", assigneeId: "me", updatedAt: "2026-09-30T11:59:00Z" };
    const before = new Map([["c", { assigneeId: "me" }], ["a", { assigneeId: "bob" }]]);
    expect(newlyAssignedToMe(before, [fresh, old, already], "me", now).map((task) => task.id)).toEqual(["a"]);
  });

  it("builds a local activity history from task dates", () => {
    const done = { ...base, id: "d", completed: true, updatedAt: new Date(2026, 8, 3, 12).toISOString(), createdAt: new Date(2026, 8, 2, 12).toISOString() };
    expect(localProjectActivity([done], "me")).toEqual([
      { date: "2026-09-02", userId: "me", completed: 0, created: 1 },
      { date: "2026-09-03", userId: "me", completed: 1, created: 0 },
    ]);
  });
});

describe("activity grid", () => {
  it("lays out 53 weeks ending with the current one", () => {
    const today = new Date(2026, 8, 30);
    const weeks = activityWeeks(today, true);
    expect(weeks).toHaveLength(53);
    expect(weeks[0][0].getDay()).toBe(1);
    expect(weeks[52].some((day) => day.getDate() === 30 && day.getMonth() === 8)).toBe(true);
    expect(activityWeeks(today, false)[0][0].getDay()).toBe(0);
  });

  it("scales levels to the busiest day and counts streaks", () => {
    expect([0, 1, 2, 3, 4, 8].map((count) => activityLevel(count, 8))).toEqual([0, 1, 1, 2, 2, 4]);
    const counts = new Map([["2026-09-28", 1], ["2026-09-29", 2]]);
    expect(currentStreak(counts, new Date(2026, 8, 30))).toBe(2);
    expect(currentStreak(counts, new Date(2026, 8, 29))).toBe(2);
    expect(currentStreak(new Map(), new Date(2026, 8, 30))).toBe(0);
  });
});
