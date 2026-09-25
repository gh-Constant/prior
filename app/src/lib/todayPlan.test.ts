import { describe, expect, it } from "vitest";
import type { Habit, Task } from "../types";
import { avatarTone, completedOn, daysSince, firstFreeSlot, formatClock, groupWaitingTasks, habitStreak, initials, looksLikeEmail, mergeBusySpans, parseClock, remainingFreeMinutes } from "./todayPlan";

const h = (hours: number, minutes = 0) => hours * 60 + minutes;

function task(overrides: Partial<Task>): Task {
  return { id: "t", title: "Task", description: "", dueDate: null, priority: 4, completed: false, important: false, urgent: false, createdAt: "2026-09-01T09:00:00", updatedAt: "2026-09-01T09:00:00", deletedAt: null, ...overrides };
}

describe("day timeline math", () => {
  it("merges and clips busy spans to the visible day", () => {
    expect(mergeBusySpans([{ start: h(8), end: h(9, 30) }, { start: h(9, 15), end: h(10) }, { start: h(18, 30), end: h(20) }]))
      .toEqual([{ start: h(9), end: h(10) }, { start: h(18, 30), end: h(19) }]);
  });

  it("finds the first 45-minute gap after now and stops at the next event", () => {
    const busy = [{ start: h(12, 30), end: h(13, 30) }];
    expect(firstFreeSlot(busy, h(10, 42))).toEqual({ start: h(10, 45), end: h(12, 30) });
    // Only 20 minutes before lunch: the next usable gap is after it.
    expect(firstFreeSlot(busy, h(12, 10))).toEqual({ start: h(13, 30), end: h(15, 30) });
  });

  it("returns no slot once the day is over or fully booked", () => {
    expect(firstFreeSlot([], h(19, 5))).toBeNull();
    expect(firstFreeSlot([{ start: h(9), end: h(19) }], h(9))).toBeNull();
  });

  it("starts at the beginning of the day before 9:00", () => {
    expect(firstFreeSlot([], h(7))).toEqual({ start: h(9), end: h(11) });
  });

  it("counts the free minutes left today", () => {
    expect(remainingFreeMinutes([{ start: h(12, 30), end: h(13, 30) }], h(9))).toBe(h(9));
    expect(remainingFreeMinutes([{ start: h(12, 30), end: h(13, 30) }], h(13))).toBe(h(5, 30));
    expect(remainingFreeMinutes([], h(20))).toBe(0);
  });

  it("parses and formats wall-clock times", () => {
    expect(parseClock("09:05")).toBe(h(9, 5));
    expect(parseClock("25:00")).toBeNull();
    expect(parseClock(null)).toBeNull();
    expect(formatClock(h(9, 5))).toBe("9:05");
  });
});

describe("people and ages", () => {
  it("counts calendar days since a timestamp", () => {
    const now = new Date(2026, 8, 23, 8, 0);
    expect(daysSince(new Date(2026, 8, 20, 22, 0).toISOString(), now)).toBe(3);
    expect(daysSince(new Date(2026, 8, 23, 7, 0).toISOString(), now)).toBe(0);
    expect(daysSince("not a date", now)).toBeNull();
  });

  it("derives initials and a stable avatar tone", () => {
    expect(initials("Alex Rivera")).toBe("AR");
    expect(initials("sam")).toBe("SA");
    expect(initials("  ")).toBe("?");
    expect(avatarTone("Alex Rivera")).toBe(avatarTone("alex rivera"));
  });

  it("recognizes an email-like assignee", () => {
    expect(looksLikeEmail("alex@example.com")).toBe(true);
    expect(looksLikeEmail("Alex Rivera")).toBe(false);
  });

  it("groups waiting items by person, oldest first, unassigned last", () => {
    const groups = groupWaitingTasks([
      task({ id: "a", assigneeName: "Alex", updatedAt: "2026-09-10T00:00:00" }),
      task({ id: "b", assigneeName: " alex ", updatedAt: "2026-09-05T00:00:00" }),
      task({ id: "c", status: "waiting" }),
      task({ id: "d", assigneeName: "Sam" }),
    ]);
    expect(groups.map((group) => group.name)).toEqual(["Alex", "Sam", null]);
    expect(groups[0].tasks.map((item) => item.id)).toEqual(["b", "a"]);
  });
});

describe("habits and completions", () => {
  const habit: Habit = { id: "h", title: "Walk", important: false, urgent: false, interval: 1, unit: "day", startDate: "2026-09-18", completedDates: ["2026-09-20", "2026-09-21", "2026-09-22"], createdAt: "", updatedAt: "", deletedAt: null };

  it("counts the streak without breaking on today's open occurrence", () => {
    expect(habitStreak(habit, new Date(2026, 8, 23, 10))).toBe(3);
    expect(habitStreak({ ...habit, completedDates: [...habit.completedDates, "2026-09-23"] }, new Date(2026, 8, 23, 10))).toBe(4);
    expect(habitStreak({ ...habit, completedDates: ["2026-09-21"] }, new Date(2026, 8, 23, 10))).toBe(0);
  });

  it("lists tasks completed today by their last update", () => {
    const day = new Date(2026, 8, 23, 12);
    const done = completedOn([
      task({ id: "today", completed: true, updatedAt: new Date(2026, 8, 23, 9).toISOString() }),
      task({ id: "yesterday", completed: true, updatedAt: new Date(2026, 8, 22, 9).toISOString() }),
      task({ id: "open", updatedAt: new Date(2026, 8, 23, 9).toISOString() }),
    ], day);
    expect(done.map((item) => item.id)).toEqual(["today"]);
  });
});
