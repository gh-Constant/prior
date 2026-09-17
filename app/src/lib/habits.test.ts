import { describe, expect, it } from "vitest";
import type { Habit } from "../types";
import { habitCompletionDate, habitOccurrenceDates, habitStatus } from "./habits";

function makeHabit(options: Partial<Habit> = {}): Habit {
  return {
    id: "h1", title: "Read", important: false, urgent: false, interval: 1, unit: "day",
    startDate: "2026-09-10", completedDates: [], createdAt: "2026-09-10T00:00:00.000Z",
    updatedAt: "2026-09-10T00:00:00.000Z", deletedAt: null, ...options,
  };
}

describe("habit recurrence", () => {
  it("generates daily and weekly occurrences", () => {
    expect(habitOccurrenceDates(makeHabit(), new Date("2026-09-12T12:00:00"), new Date("2026-09-14T12:00:00"))).toEqual(["2026-09-12", "2026-09-13", "2026-09-14"]);
    expect(habitOccurrenceDates(makeHabit({ unit: "week" }), new Date("2026-09-10T12:00:00"), new Date("2026-09-30T12:00:00"))).toEqual(["2026-09-10", "2026-09-17", "2026-09-24"]);
  });

  it("marks missed occurrences overdue and completes the oldest pending date", () => {
    const habit = makeHabit({ interval: 2, completedDates: ["2026-09-10"] });
    const reference = new Date("2026-09-13T12:00:00");
    expect(habitStatus(habit, reference)).toBe("overdue");
    expect(habitCompletionDate(habit, reference)).toBe("2026-09-12");
  });

  it("keeps a daily habit overdue when today is complete but an earlier occurrence was missed", () => {
    const habit = makeHabit({ completedDates: ["2026-09-10", "2026-09-12"] });
    expect(habitStatus(habit, new Date("2026-09-12T12:00:00"))).toBe("overdue");
  });

  it("handles month end anchors without creating invalid dates", () => {
    const habit = makeHabit({ startDate: "2026-01-31", unit: "month" });
    expect(habitOccurrenceDates(habit, new Date("2026-01-01"), new Date("2026-05-31"))).toEqual(["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30", "2026-05-31"]);
  });

  it("supports selected weekly weekdays and an end date", () => {
    const habit = makeHabit({ unit: "week", daysOfWeek: [6], endDate: "2026-09-26", completedDates: ["2026-09-12", "2026-09-19", "2026-09-26"] });
    expect(habitOccurrenceDates(habit, new Date("2026-09-10"), new Date("2026-10-10"))).toEqual(["2026-09-12", "2026-09-19", "2026-09-26"]);
    expect(habitStatus(habit, new Date("2026-09-27T12:00:00"))).toBe("ended");
  });

  it("supports every other selected weekday", () => {
    const habit = makeHabit({ unit: "week", interval: 2, daysOfWeek: [1, 6], startDate: "2026-09-07" });
    expect(habitOccurrenceDates(habit, new Date("2026-09-07"), new Date("2026-09-30"))).toEqual(["2026-09-07", "2026-09-12", "2026-09-21", "2026-09-26"]);
  });
});
