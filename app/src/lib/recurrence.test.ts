import { describe, expect, it } from "vitest";
import type { Task, TaskRecurrence } from "../types";
import { createTranslator } from "./i18n/translate";
import { dictionaries } from "./i18n/locales";
import { buildNextOccurrence, describeRecurrence, nextDueDate, normalizeRecurrence, presetOf, presetRecurrence } from "./recurrence";

// The same vectors as server/internal/tasks/recurrence_test.go: the client and
// the server must compute the same next date.
const cases: Array<{ name: string; rule: TaskRecurrence; due: string | null; completedOn: string; today: string; want: string }> = [
  { name: "daily", rule: { interval: 1, unit: "day" }, due: "2026-10-01", completedOn: "2026-10-01", today: "2026-10-01", want: "2026-10-02" },
  { name: "every 3 days", rule: { interval: 3, unit: "day" }, due: "2026-10-01", completedOn: "2026-10-01", today: "2026-10-01", want: "2026-10-04" },
  { name: "weekdays from friday", rule: { interval: 1, unit: "week", daysOfWeek: [1, 2, 3, 4, 5] }, due: "2026-10-02", completedOn: "2026-10-02", today: "2026-10-02", want: "2026-10-05" },
  { name: "weekdays within the week", rule: { interval: 1, unit: "week", daysOfWeek: [1, 2, 3, 4, 5] }, due: "2026-10-05", completedOn: "2026-10-05", today: "2026-10-05", want: "2026-10-06" },
  { name: "every 2 weeks monday thursday, from monday", rule: { interval: 2, unit: "week", daysOfWeek: [1, 4] }, due: "2026-10-05", completedOn: "2026-10-05", today: "2026-10-05", want: "2026-10-08" },
  { name: "every 2 weeks monday thursday, from thursday", rule: { interval: 2, unit: "week", daysOfWeek: [1, 4] }, due: "2026-10-08", completedOn: "2026-10-08", today: "2026-10-08", want: "2026-10-19" },
  { name: "sunday counts as the end of the week", rule: { interval: 1, unit: "week", daysOfWeek: [0, 1] }, due: "2026-10-04", completedOn: "2026-10-04", today: "2026-10-04", want: "2026-10-05" },
  { name: "weekly without days", rule: { interval: 1, unit: "week" }, due: "2026-10-01", completedOn: "2026-10-01", today: "2026-10-01", want: "2026-10-08" },
  { name: "monthly clamps the 31st", rule: { interval: 1, unit: "month" }, due: "2026-01-31", completedOn: "2026-01-31", today: "2026-01-31", want: "2026-02-28" },
  { name: "monthly keeps the 31st while skipping", rule: { interval: 1, unit: "month" }, due: "2026-01-31", completedOn: "2026-04-10", today: "2026-04-10", want: "2026-04-30" },
  { name: "monthly keeps the 31st when it exists", rule: { interval: 1, unit: "month" }, due: "2026-01-31", completedOn: "2026-03-02", today: "2026-03-02", want: "2026-03-31" },
  { name: "yearly feb 29", rule: { interval: 1, unit: "year" }, due: "2024-02-29", completedOn: "2024-02-29", today: "2024-02-29", want: "2025-02-28" },
  { name: "yearly feb 29 back to a leap year", rule: { interval: 1, unit: "year" }, due: "2024-02-29", completedOn: "2028-01-01", today: "2028-01-01", want: "2028-02-29" },
  { name: "basis completion", rule: { interval: 2, unit: "day", basis: "completion" }, due: "2026-10-01", completedOn: "2026-10-05", today: "2026-10-05", want: "2026-10-07" },
  { name: "basis due skips the past", rule: { interval: 2, unit: "day" }, due: "2026-10-01", completedOn: "2026-10-05", today: "2026-10-05", want: "2026-10-05" },
  { name: "daily overdue lands today", rule: { interval: 1, unit: "day" }, due: "2026-09-20", completedOn: "2026-10-01", today: "2026-10-01", want: "2026-10-01" },
  { name: "no due date counts from today", rule: { interval: 1, unit: "day" }, due: null, completedOn: "2026-10-01", today: "2026-10-01", want: "2026-10-02" },
  { name: "until inclusive", rule: { interval: 1, unit: "week", until: "2026-10-12" }, due: "2026-10-05", completedOn: "2026-10-05", today: "2026-10-05", want: "2026-10-12" },
  { name: "month interval across a year end", rule: { interval: 3, unit: "month" }, due: "2026-11-30", completedOn: "2026-11-30", today: "2026-11-30", want: "2027-02-28" },
];

describe("nextDueDate", () => {
  for (const item of cases) {
    it(item.name, () => {
      expect(nextDueDate(item.rule, { dueDate: item.due, completedOn: item.completedOn, today: item.today })).toBe(item.want);
    });
  }

  it("stops past the end date", () => {
    expect(nextDueDate({ interval: 1, unit: "week", until: "2026-10-10" }, { dueDate: "2026-10-05", today: "2026-10-05" })).toBeNull();
  });

  it("has no next date for an unusable rule or day", () => {
    expect(nextDueDate({ interval: 0, unit: "day" }, { dueDate: null, today: "2026-10-01" })).toBeNull();
    expect(nextDueDate({ interval: 1, unit: "day" }, { dueDate: null, today: "not a date" })).toBeNull();
  });
});

describe("normalizeRecurrence", () => {
  it("accepts objects and JSON text, and returns the canonical form", () => {
    expect(normalizeRecurrence({ interval: 2, unit: "week", daysOfWeek: [4, 1, 4], basis: "due", until: "2026-12-31" })).toEqual({ interval: 2, unit: "week", daysOfWeek: [1, 4], until: "2026-12-31" });
    expect(normalizeRecurrence('{"interval":1,"unit":"day","basis":"completion"}')).toEqual({ interval: 1, unit: "day", basis: "completion" });
    expect(normalizeRecurrence({ interval: 1, unit: "day", daysOfWeek: [1] })).toEqual({ interval: 1, unit: "day" });
  });

  it("turns missing or invalid values into null", () => {
    for (const bad of [undefined, null, "", "{", 3, [], { interval: 0, unit: "day" }, { interval: 366, unit: "day" }, { interval: 1, unit: "hour" }, { unit: "day" }, { interval: "2", unit: "day" }]) {
      expect(normalizeRecurrence(bad)).toBeNull();
    }
    expect(normalizeRecurrence({ interval: 1, unit: "day", until: "2026-02-30" })).toEqual({ interval: 1, unit: "day" });
  });
});

describe("buildNextOccurrence", () => {
  const now = new Date(2026, 9, 1, 12, 0, 0);
  const base: Task = {
    id: "old", title: "Water plants", description: "Balcony", priority: 2, status: "done", completed: true, important: true, urgent: false,
    dueDate: "2026-10-01", dueTime: "09:30", scheduledDate: "2026-09-30", scheduledTime: "08:00",
    reminderAt: new Date(2026, 9, 1, 9, 0, 0).toISOString(), followUpDate: "2026-10-01", followUpTime: "10:00",
    areaId: "area", projectId: "project", assigneeId: "user", assigneeName: "Lea", parentId: "parent", milestoneId: "m1",
    peopleIds: ["user"], estimatedMinutes: 15, relations: [{ type: "related", taskId: "other" }],
    checklist: [{ id: "a", title: "Fern", done: true, position: 0 }, { id: "b", title: "Cactus", done: true, position: 1 }],
    recurrence: { interval: 1, unit: "week", daysOfWeek: [1, 4] },
    createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-10-01T10:00:00.000Z", deletedAt: null, serverRevision: 12,
  };

  it("copies the task into a fresh open occurrence and shifts its dates", () => {
    const next = buildNextOccurrence(base, now, { status: "in_progress" })!;
    expect(next.id).not.toBe("old");
    expect(next).toMatchObject({
      title: "Water plants", description: "Balcony", priority: 2, important: true, urgent: false, completed: false, status: "next",
      areaId: "area", projectId: "project", assigneeId: "user", parentId: "parent", milestoneId: "m1", peopleIds: ["user"], estimatedMinutes: 15,
      dueTime: "09:30", scheduledTime: "08:00", followUpDate: null, followUpTime: null, assigneeName: "",
      relations: [{ type: "related", taskId: "other" }], recurrence: { interval: 1, unit: "week", daysOfWeek: [1, 4] }, deletedAt: null,
    });
    // Thursday 2026-10-01 -> Monday 2026-10-05: everything dated moves 4 days.
    expect(next.dueDate).toBe("2026-10-05");
    expect(next.scheduledDate).toBe("2026-10-04");
    const reminder = new Date(next.reminderAt!);
    expect([reminder.getFullYear(), reminder.getMonth(), reminder.getDate(), reminder.getHours()]).toEqual([2026, 9, 5, 9]);
    expect(next.createdAt).toBe(now.toISOString());
    expect(next.serverRevision).toBeUndefined();
  });

  it("gives the checklist new ids and unchecks it", () => {
    const next = buildNextOccurrence(base, now)!;
    expect(next.checklist).toHaveLength(2);
    expect(next.checklist!.map((item) => item.done)).toEqual([false, false]);
    expect(next.checklist!.map((item) => item.title)).toEqual(["Fern", "Cactus"]);
    expect(next.checklist![0]!.id).not.toBe("a");
    expect(base.checklist![0]!.done).toBe(true);
  });

  it("only reopens statuses that were in motion", () => {
    expect(buildNextOccurrence(base, now, { status: "inbox" })!.status).toBe("inbox");
    expect(buildNextOccurrence(base, now, { status: "backlog" })!.status).toBe("backlog");
    expect(buildNextOccurrence(base, now, { status: "waiting" })!.status).toBe("next");
    expect(buildNextOccurrence(base, now)!.status).toBe("next");
  });

  it("counts from today for a task without a due date", () => {
    const next = buildNextOccurrence({ ...base, dueDate: null, scheduledDate: null, reminderAt: null, recurrence: { interval: 1, unit: "day" } }, now)!;
    expect(next.dueDate).toBe("2026-10-02");
    expect(next.scheduledDate).toBeNull();
    expect(next.reminderAt).toBeNull();
  });

  it("returns null at the end of the series and for a task that does not repeat", () => {
    expect(buildNextOccurrence({ ...base, recurrence: { interval: 1, unit: "day", until: "2026-10-01" } }, now)).toBeNull();
    expect(buildNextOccurrence({ ...base, recurrence: null }, now)).toBeNull();
  });
});

describe("describeRecurrence", () => {
  const en = createTranslator("en", dictionaries.en, dictionaries.en).t;
  const fr = createTranslator("fr", dictionaries.fr, dictionaries.en).t;

  it("describes rules in English", () => {
    expect(describeRecurrence({ interval: 1, unit: "day" }, en, "en")).toBe("Every day");
    expect(describeRecurrence({ interval: 3, unit: "day" }, en, "en")).toBe("Every 3 days");
    expect(describeRecurrence({ interval: 1, unit: "week", daysOfWeek: [1, 2, 3, 4, 5] }, en, "en")).toBe("Every weekday");
    expect(describeRecurrence({ interval: 2, unit: "week", daysOfWeek: [4, 1] }, en, "en")).toBe("Every 2 weeks on Mon, Thu");
    expect(describeRecurrence({ interval: 1, unit: "week" }, en, "en")).toBe("Every week");
    expect(describeRecurrence({ interval: 1, unit: "month" }, en, "en", { dueDate: "2026-10-15" })).toBe("Every month on the 15th");
    expect(describeRecurrence({ interval: 1, unit: "month" }, en, "en", { dueDate: "2026-10-22" })).toBe("Every month on the 22nd");
    expect(describeRecurrence({ interval: 1, unit: "month" }, en, "en")).toBe("Every month");
    expect(describeRecurrence({ interval: 1, unit: "year" }, en, "en", { dueDate: "2026-10-03" })).toBe("Every year on October 3");
    expect(describeRecurrence({ interval: 2, unit: "year" }, en, "en")).toBe("Every 2 years");
  });

  it("adds the basis and the end date", () => {
    expect(describeRecurrence({ interval: 1, unit: "day", basis: "completion" }, en, "en")).toBe("Every day, from completion");
    expect(describeRecurrence({ interval: 1, unit: "day", until: "2026-12-31" }, en, "en")).toMatch(/^Every day, until .*2026/);
  });

  it("has compact labels for chips", () => {
    expect(describeRecurrence({ interval: 1, unit: "day" }, en, "en", { short: true })).toBe("Daily");
    expect(describeRecurrence({ interval: 1, unit: "week", daysOfWeek: [1, 2, 3, 4, 5] }, en, "en", { short: true })).toBe("Weekdays");
    expect(describeRecurrence({ interval: 2, unit: "week" }, en, "en", { short: true })).toBe("Every 2 weeks");
    expect(describeRecurrence({ interval: 1, unit: "month" }, en, "en", { short: true, dueDate: "2026-10-15" })).toBe("Monthly");
  });

  it("describes rules in French", () => {
    expect(describeRecurrence({ interval: 1, unit: "day" }, fr, "fr")).toBe("Tous les jours");
    expect(describeRecurrence({ interval: 2, unit: "week", daysOfWeek: [1, 4] }, fr, "fr")).toMatch(/^Toutes les 2 semaines : lun\.?, jeu\.?$/);
    expect(describeRecurrence({ interval: 1, unit: "month" }, fr, "fr", { dueDate: "2026-10-15" })).toBe("Tous les mois le 15");
  });
});

describe("presets", () => {
  it("builds each preset against the due date's weekday", () => {
    expect(presetRecurrence("daily", "2026-10-01")).toEqual({ interval: 1, unit: "day" });
    expect(presetRecurrence("weekdays", "2026-10-01")).toEqual({ interval: 1, unit: "week", daysOfWeek: [1, 2, 3, 4, 5] });
    expect(presetRecurrence("weekly", "2026-10-01")).toEqual({ interval: 1, unit: "week", daysOfWeek: [4] });
    expect(presetRecurrence("monthly", "2026-10-01")).toEqual({ interval: 1, unit: "month" });
    expect(presetRecurrence("yearly", "2026-10-01")).toEqual({ interval: 1, unit: "year" });
  });

  it("recognises which preset a rule is", () => {
    expect(presetOf(null, "2026-10-01")).toBe("none");
    expect(presetOf({ interval: 1, unit: "day" }, null)).toBe("daily");
    expect(presetOf({ interval: 1, unit: "week", daysOfWeek: [1, 2, 3, 4, 5] }, null)).toBe("weekdays");
    expect(presetOf({ interval: 1, unit: "week", daysOfWeek: [4] }, "2026-10-01")).toBe("weekly");
    expect(presetOf({ interval: 1, unit: "week", daysOfWeek: [5] }, "2026-10-01")).toBe("custom");
    expect(presetOf({ interval: 2, unit: "day" }, null)).toBe("custom");
    expect(presetOf({ interval: 1, unit: "month", basis: "completion" }, null)).toBe("custom");
  });
});
