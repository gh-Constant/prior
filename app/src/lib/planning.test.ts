import { describe, expect, it } from "vitest";
import type { Task } from "../types";
import type { CalendarState } from "./calendar";
import { blocksAsCalendarEvents, busyFromCalendar, nextWorkDay, parsePlanningEstimates, pinBlock, postponeTask, unpinTask } from "./planning";

const task: Task = { id: "t1", title: "Write the report", description: "", dueDate: null, priority: 4, completed: false, important: false, urgent: false, createdAt: "2026-09-01T10:00:00.000Z", updatedAt: "2026-09-01T10:00:00.000Z", deletedAt: null };

describe("planning state", () => {
  it("reads busy time from enabled calendars, with buffers, locked all-day events and habits", () => {
    const state: CalendarState = {
      showHabits: true,
      sources: [
        { id: "work", name: "Work", type: "local", color: "#000", enabled: true, events: [
          { id: "meeting", sourceId: "work", title: "Standup", date: "2026-10-01", startTime: "09:30", endTime: "10:00", color: "#000", kind: "event" },
          { id: "holiday", sourceId: "work", title: "Holiday", date: "2026-10-02", startTime: null, endTime: null, color: "#000", kind: "event", locked: true },
          { id: "birthday", sourceId: "work", title: "Birthday", date: "2026-10-01", startTime: null, endTime: null, color: "#000", kind: "event" },
        ] },
        { id: "family", name: "Family", type: "local", color: "#111", enabled: true, planningFree: true, events: [
          { id: "dinner", sourceId: "family", title: "Dinner", date: "2026-10-01", startTime: "11:00", endTime: "12:00", color: "#111", kind: "event" },
        ] },
        { id: "off", name: "Off", type: "local", color: "#222", enabled: false, events: [
          { id: "hidden", sourceId: "off", title: "Hidden", date: "2026-10-01", startTime: "14:00", endTime: "15:00", color: "#222", kind: "event" },
        ] },
      ],
    };
    const habit = { id: "h", title: "Run", important: false, urgent: false, interval: 1, unit: "day" as const, startDate: "2026-09-01", timeOfDay: "07:00", completedDates: [], createdAt: "", updatedAt: "", deletedAt: null };
    const busy = busyFromCalendar(state, [habit], "2026-10-01", 2);
    expect(busy).toContainEqual({ date: "2026-10-01", start: 570, end: 600, buffer: true });
    expect(busy).toContainEqual({ date: "2026-10-02", start: 0, end: 1440 });
    expect(busy).toContainEqual({ date: "2026-10-01", start: 420, end: 465 });
    expect(busy.some((block) => block.start === 660)).toBe(false);
    expect(busy.some((block) => block.start === 840)).toBe(false);
    expect(busy.filter((block) => block.date === "2026-10-01" && block.end === 1440)).toEqual([]);
  });

  it("keeps only valid estimates for known tasks", () => {
    const parsed = parsePlanningEstimates(JSON.stringify({ tasks: [
      { id: "t1", minutes: 62, energy: "deep", value: 7 },
      { id: "unknown", minutes: 30, energy: "light" },
      { id: "t1x", minutes: "a lot" },
    ] }), [task, { ...task, id: "t1x" }]);
    expect([...parsed.entries()]).toEqual([["t1", { minutes: 60, energy: "deep", value: 4 }]]);
    expect(parsePlanningEstimates("not json", [task]).size).toBe(0);
  });

  it("locks, unlocks and postpones a task", () => {
    const pinned = pinBlock(task, { date: "2026-10-01", start: 570 }, 45);
    expect(pinned).toMatchObject({ scheduledDate: "2026-10-01", scheduledTime: "09:30", estimatedMinutes: 45 });
    expect(unpinTask(pinned)).toMatchObject({ scheduledDate: "2026-10-01", scheduledTime: null });
    // Friday 2 October → Monday 5 October.
    expect(nextWorkDay("2026-10-02", { workDays: [1, 2, 3, 4, 5] })).toBe("2026-10-05");
    expect(postponeTask(pinned, "2026-10-02", { workDays: [1, 2, 3, 4, 5] })).toMatchObject({ scheduledDate: "2026-10-05", scheduledTime: null });
  });

  it("shows blocks in range as read-only calendar entries", () => {
    const events = blocksAsCalendarEvents([
      { id: "t1:2026-10-01:540", taskId: "t1", date: "2026-10-01", start: 540, end: 600, part: 1, parts: 1, fixed: false, energy: "deep", late: false },
      { id: "t1:2026-10-09:540", taskId: "t1", date: "2026-10-09", start: 540, end: 600, part: 1, parts: 1, fixed: false, energy: "deep", late: false },
    ], new Map([["t1", task]]), "2026-10-01", "2026-10-07", "red");
    expect(events).toEqual([expect.objectContaining({ id: "plan:t1:2026-10-01:540", kind: "task", taskId: "t1", startTime: "09:00", endTime: "10:00", title: "Write the report", locked: false })]);
  });
});
