import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Habit, Task } from "../types";
import { getNotificationSettings, notificationId, outsideQuietHours, parseNotificationTarget, planNotifications, reminderPresets, saveNotificationSettings, DEFAULT_NOTIFICATION_SETTINGS } from "./reminders";
import { normalizeChecklist, normalizeReminder } from "./localStore";

const base: Task = { id: "t1", title: "Call the bank", description: "", dueDate: null, priority: 4, completed: false, important: false, urgent: false, createdAt: "2026-09-01T00:00:00Z", updatedAt: "2026-09-01T00:00:00Z", deletedAt: null };
const habit: Habit = { id: "h1", title: "Stretch", important: false, urgent: false, interval: 1, unit: "day", startDate: "2026-09-01", timeOfDay: "08:30", completedDates: [], createdAt: "2026-09-01T00:00:00Z", updatedAt: "2026-09-01T00:00:00Z", deletedAt: null };
const now = new Date(2026, 8, 30, 7, 0, 0);

describe("reminder planning", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it("schedules open task reminders in the window and skips done, deleted or far ones", () => {
    const soon = new Date(2026, 8, 30, 10, 0).toISOString();
    const far = new Date(2026, 9, 20, 10, 0).toISOString();
    const plan = planNotifications([
      { ...base, reminderAt: soon },
      { ...base, id: "t2", reminderAt: soon, completed: true },
      { ...base, id: "t3", reminderAt: soon, deletedAt: soon },
      { ...base, id: "t4", reminderAt: far },
      { ...base, id: "t5", reminderAt: null },
    ], [], DEFAULT_NOTIFICATION_SETTINGS, now);
    expect(plan.map((item) => item.entityId)).toEqual(["t1"]);
    expect(plan[0].target).toBe("prior://task/t1");
    expect(plan[0].id).toBe(notificationId(`task:t1:${soon}`));
  });

  it("reminds habits on scheduled days not checked in yet", () => {
    const plan = planNotifications([], [{ ...habit, completedDates: ["2026-09-30"] }], DEFAULT_NOTIFICATION_SETTINGS, now, 3);
    expect(plan.map((item) => item.key)).toEqual(["habit:h1:2026-10-01", "habit:h1:2026-10-02"]);
    expect(planNotifications([], [habit], { ...DEFAULT_NOTIFICATION_SETTINGS, habits: false }, now)).toEqual([]);
    expect(planNotifications([{ ...base, reminderAt: new Date(2026, 8, 30, 9).toISOString() }], [habit], { ...DEFAULT_NOTIFICATION_SETTINGS, enabled: false }, now)).toEqual([]);
  });

  it("caps the plan and keeps the soonest", () => {
    const tasks = Array.from({ length: 80 }, (_, index) => ({ ...base, id: `t${index}`, reminderAt: new Date(2026, 8, 30, 8, index).toISOString() }));
    const plan = planNotifications(tasks, [], DEFAULT_NOTIFICATION_SETTINGS, now);
    expect(plan).toHaveLength(64);
    expect(plan[0].entityId).toBe("t0");
  });

  it("defers reminders inside quiet hours, including windows past midnight", () => {
    const settings = { quietStart: "22:00", quietEnd: "07:00" };
    expect(outsideQuietHours(new Date(2026, 8, 30, 23, 15), settings)).toEqual(new Date(2026, 9, 1, 7, 0));
    expect(outsideQuietHours(new Date(2026, 8, 30, 6, 30), settings)).toEqual(new Date(2026, 8, 30, 7, 0));
    expect(outsideQuietHours(new Date(2026, 8, 30, 12, 0), settings)).toEqual(new Date(2026, 8, 30, 12, 0));
    expect(outsideQuietHours(new Date(2026, 8, 30, 12, 30), { quietStart: "12:00", quietEnd: "14:00" })).toEqual(new Date(2026, 8, 30, 14, 0));
  });

  it("offers presets from the due date and time", () => {
    const presets = reminderPresets({ dueDate: "2026-10-02", dueTime: "15:00" }, now);
    const at = Object.fromEntries(presets.map((preset) => [preset.preset, new Date(preset.at)]));
    expect(at.due).toEqual(new Date(2026, 9, 2, 15, 0));
    expect(at["10min"]).toEqual(new Date(2026, 9, 2, 14, 50));
    expect(at["1h"]).toEqual(new Date(2026, 9, 2, 14, 0));
    expect(at.morning).toEqual(new Date(2026, 9, 2, 9, 0));
    expect(reminderPresets({ dueDate: null, dueTime: null }, now).map((preset) => preset.preset)).toEqual(["inOneHour", "tomorrowMorning"]);
    // Past presets are not offered.
    expect(reminderPresets({ dueDate: "2026-09-30", dueTime: "07:05" }, now).map((preset) => preset.preset)).toEqual(["due", "inOneHour", "tomorrowMorning"]);
  });

  it("stores per-device settings", () => {
    expect(getNotificationSettings()).toEqual(DEFAULT_NOTIFICATION_SETTINGS);
    saveNotificationSettings({ enabled: false, habits: true, quietStart: "21:30", quietEnd: "bad" });
    expect(getNotificationSettings()).toEqual({ enabled: false, habits: true, quietStart: "21:30", quietEnd: null });
  });

  it("parses notification and quick-capture links", () => {
    expect(parseNotificationTarget("prior://task/abc")).toEqual({ kind: "task", id: "abc" });
    expect(parseNotificationTarget("prior://habit/h%201")).toEqual({ kind: "habit", id: "h 1" });
    expect(parseNotificationTarget("prior://new-task")).toEqual({ kind: "new-task" });
    expect(parseNotificationTarget("prior://task/")).toBeNull();
    expect(parseNotificationTarget("https://example.com/task/abc")).toBeNull();
  });
});

describe("task field normalization", () => {
  it("normalizes old data without reminders or checklists", () => {
    expect(normalizeReminder(undefined)).toBeNull();
    expect(normalizeReminder("nope")).toBeNull();
    expect(normalizeReminder("2026-10-01T09:00:00+02:00")).toBe("2026-10-01T07:00:00.000Z");
    expect(normalizeChecklist(undefined)).toEqual([]);
    expect(normalizeChecklist("not json")).toEqual([]);
  });

  it("parses SQLite JSON, drops invalid items and renumbers", () => {
    const raw = JSON.stringify([
      { id: "b", title: " Second ", done: true, position: 3 },
      { id: "a", title: "First", done: false, position: 1 },
      { id: "a", title: "Duplicate", done: false, position: 2 },
      { id: "c", title: "   ", position: 4 },
      "junk",
    ]);
    expect(normalizeChecklist(raw)).toEqual([
      { id: "a", title: "First", done: false, position: 0 },
      { id: "b", title: "Second", done: true, position: 1 },
    ]);
    const many = Array.from({ length: 120 }, (_, index) => ({ id: `i${index}`, title: `Item ${index}`, done: false, position: index }));
    expect(normalizeChecklist(many)).toHaveLength(100);
  });
});
