import { describe, expect, it } from "vitest";
import type { Habit, Task } from "../types";
import { habitProgressForDay, waitingTaskCount } from "./navCounts";
import { formatSyncedAgo } from "./syncStatus";

function task(overrides: Partial<Task>): Task {
  return {
    id: crypto.randomUUID(), title: "Task", description: "", dueDate: null, priority: 4,
    completed: false, important: false, urgent: false, createdAt: "", updatedAt: "", deletedAt: null,
    ...overrides,
  };
}

function habit(overrides: Partial<Habit>): Habit {
  return {
    id: crypto.randomUUID(), title: "Habit", important: false, urgent: false, interval: 1, unit: "day",
    startDate: "2026-09-01", completedDates: [], createdAt: "", updatedAt: "", deletedAt: null,
    ...overrides,
  };
}

describe("waitingTaskCount", () => {
  it("counts open waiting or delegated tasks only", () => {
    expect(waitingTaskCount([
      task({ status: "waiting" }),
      task({ assigneeName: "Alex" }),
      task({ status: "waiting", completed: true }),
      task({ status: "waiting", deletedAt: "2026-09-20T00:00:00Z" }),
      task({ status: "next" }),
    ])).toBe(2);
  });
});

describe("habitProgressForDay", () => {
  it("counts habits scheduled that day and the ones already done", () => {
    const day = new Date(2026, 8, 22); // Tuesday
    expect(habitProgressForDay([
      habit({ completedDates: ["2026-09-22"] }),
      habit({}),
      habit({ unit: "week", daysOfWeek: [1] }), // Mondays only
      habit({ deletedAt: "2026-09-20T00:00:00Z" }),
    ], day)).toEqual({ done: 1, total: 2 });
  });
});

describe("formatSyncedAgo", () => {
  const now = Date.UTC(2026, 8, 22, 12, 0, 0);
  it("says just now under a minute, then uses relative wording", () => {
    expect(formatSyncedAgo(now - 20_000, now, "en", "just now")).toBe("just now");
    expect(formatSyncedAgo(now - 5 * 60_000, now, "en", "just now")).toMatch(/5 min/);
    expect(formatSyncedAgo(now - 3 * 3_600_000, now, "en", "just now")).toMatch(/3 h/);
  });
});
