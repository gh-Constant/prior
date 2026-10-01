import { describe, expect, it } from "vitest";
import { parseTaskTitle } from "./taskTitleParser";

describe("task title parser", () => {
  const now = new Date(2026, 8, 19, 10, 0, 0);

  it("extracts relative dates and times while keeping a clean title", () => {
    const parsed = parseTaskTitle("Doing my homework tomorrow at 3pm", { now });

    expect(parsed.cleanTitle).toBe("Doing my homework");
    expect(parsed.fields).toMatchObject({ dueDate: "2026-09-20", dueTime: "15:00" });
    expect(parsed.tokens.map((token) => token.field)).toEqual(["dueDate", "dueTime"]);
    expect(parsed.tokens[0]?.label).toContain("Due date");
  });

  it("accepts #Name as a project or area shorthand, preferring projects", () => {
    const parsed = parseTaskTitle("Call Lea demain à 15h #Launch website", {
      now,
      projects: [{ id: "project-1", name: "Launch website" }, { id: "project-2", name: "Launch" }],
      areas: [{ id: "area-1", name: "Launch website" }],
    });
    expect(parsed.cleanTitle).toBe("Call Lea");
    expect(parsed.fields).toMatchObject({ dueDate: "2026-09-20", dueTime: "15:00", projectId: "project-1" });
    expect(parsed.fields.areaId).toBeUndefined();
    expect(parseTaskTitle("Plan #Home", { now, areas: [{ id: "area-2", name: "Home" }] }).fields).toMatchObject({ areaId: "area-2" });
    expect(parseTaskTitle("Tag#Home stays text", { now, areas: [{ id: "area-2", name: "Home" }] }).fields.areaId).toBeUndefined();
  });

  it("extracts explicit workflow, ownership, project, area, and flag fields", () => {
    const parsed = parseTaskTitle("Ship it tomorrow project:Website area:Work responsible:Alex p2 status:waiting !urgent", {
      now,
      projects: [{ id: "project-1", name: "Website" }],
      areas: [{ id: "area-1", name: "Work" }],
    });

    expect(parsed.cleanTitle).toBe("Ship it");
    expect(parsed.fields).toMatchObject({
      dueDate: "2026-09-20",
      projectId: "project-1",
      areaId: "area-1",
      assigneeName: "Alex",
      priority: 2,
      status: "waiting",
      urgent: true,
    });
  });

  it("leaves a clicked token in the title and stops parsing it", () => {
    const parsed = parseTaskTitle("Call tomorrow", { now });
    const token = parsed.tokens[0];
    expect(token).toBeDefined();

    const kept = parseTaskTitle("Call tomorrow", { now }, [token!.key]);
    expect(kept.cleanTitle).toBe("Call tomorrow");
    expect(kept.fields).toEqual({});
    expect(kept.tokens).toEqual([]);
  });

  it("supports French relative dates and times", () => {
    const parsed = parseTaskTitle("Réviser demain à 18h30", { now, lang: "fr-FR" });

    expect(parsed.cleanTitle).toBe("Réviser");
    expect(parsed.fields).toMatchObject({ dueDate: "2026-09-20", dueTime: "18:30" });
  });

  describe("recurrence phrases", () => {
    // Saturday 2026-09-19.
    const rule = (value: unknown) => JSON.parse(String(value));

    it("reads English phrases, strips them and sets the first due date", () => {
      const daily = parseTaskTitle("Water plants every day", { now });
      expect(daily.cleanTitle).toBe("Water plants");
      expect(rule(daily.fields.recurrence)).toEqual({ interval: 1, unit: "day" });
      expect(daily.fields.dueDate).toBe("2026-09-19");
      expect(daily.tokens.map((token) => token.field)).toEqual(["recurrence"]);
      expect(daily.tokens[0]?.label).toBe("Repeat · Every day");

      const weekdays = parseTaskTitle("Standup every weekday", { now });
      expect(rule(weekdays.fields.recurrence)).toEqual({ interval: 1, unit: "week", daysOfWeek: [1, 2, 3, 4, 5] });
      expect(weekdays.fields.dueDate).toBe("2026-09-21");

      const monday = parseTaskTitle("Gym every monday", { now });
      expect(monday.cleanTitle).toBe("Gym");
      expect(rule(monday.fields.recurrence)).toEqual({ interval: 1, unit: "week", daysOfWeek: [1] });
      expect(monday.fields.dueDate).toBe("2026-09-21");

      expect(rule(parseTaskTitle("Gym every mon, wed and fri", { now }).fields.recurrence)).toEqual({ interval: 1, unit: "week", daysOfWeek: [1, 3, 5] });
      expect(rule(parseTaskTitle("Sync every 2 weeks", { now }).fields.recurrence)).toEqual({ interval: 2, unit: "week" });
      expect(rule(parseTaskTitle("Sync every other day", { now }).fields.recurrence)).toEqual({ interval: 2, unit: "day" });
      expect(rule(parseTaskTitle("Pay rent every month", { now }).fields.recurrence)).toEqual({ interval: 1, unit: "month" });
      expect(rule(parseTaskTitle("Renew domain every year", { now }).fields.recurrence)).toEqual({ interval: 1, unit: "year" });
    });

    it("counts from completion with every!", () => {
      const parsed = parseTaskTitle("Change filter every! 3 months", { now });
      expect(parsed.cleanTitle).toBe("Change filter");
      expect(rule(parsed.fields.recurrence)).toEqual({ interval: 3, unit: "month", basis: "completion" });
    });

    it("keeps an explicit date instead of the computed first one", () => {
      const parsed = parseTaskTitle("Review every 2 weeks tomorrow", { now });
      expect(parsed.cleanTitle).toBe("Review");
      expect(parsed.fields.dueDate).toBe("2026-09-20");
      expect(rule(parsed.fields.recurrence)).toEqual({ interval: 2, unit: "week" });
    });

    it("reads French phrases", () => {
      const options = { now, lang: "fr-FR" };
      const daily = parseTaskTitle("Arroser les plantes tous les jours", options);
      expect(daily.cleanTitle).toBe("Arroser les plantes");
      expect(rule(daily.fields.recurrence)).toEqual({ interval: 1, unit: "day" });
      expect(daily.tokens[0]?.label).toBe("Repeat · Tous les jours");
      expect(rule(parseTaskTitle("Sport chaque jour", options).fields.recurrence)).toEqual({ interval: 1, unit: "day" });
      expect(rule(parseTaskTitle("Réunion toutes les semaines", options).fields.recurrence)).toEqual({ interval: 1, unit: "week" });
      expect(rule(parseTaskTitle("Vitamines tous les 2 jours", options).fields.recurrence)).toEqual({ interval: 2, unit: "day" });
      expect(rule(parseTaskTitle("Loyer tous les mois", options).fields.recurrence)).toEqual({ interval: 1, unit: "month" });
      expect(rule(parseTaskTitle("Assurance chaque année", options).fields.recurrence)).toEqual({ interval: 1, unit: "year" });
      expect(rule(parseTaskTitle("Courses tous les jours en semaine", options).fields.recurrence)).toEqual({ interval: 1, unit: "week", daysOfWeek: [1, 2, 3, 4, 5] });
      const monday = parseTaskTitle("Piscine chaque lundi", options);
      expect(monday.cleanTitle).toBe("Piscine");
      expect(rule(monday.fields.recurrence)).toEqual({ interval: 1, unit: "week", daysOfWeek: [1] });
      expect(monday.fields.dueDate).toBe("2026-09-21");
      expect(rule(parseTaskTitle("Cours tous les lundis et jeudis", options).fields.recurrence)).toEqual({ interval: 1, unit: "week", daysOfWeek: [1, 4] });
    });

    it("does not mistake ordinary words for a repeat", () => {
      for (const title of ["Weekly report", "Check every item", "Appeler en semaine", "Call on monday", "Every", "Plan tous"]) {
        const parsed = parseTaskTitle(title, { now, lang: "fr-FR" });
        expect(parsed.fields.recurrence, title).toBeUndefined();
      }
      expect(parseTaskTitle("Call on monday", { now }).fields.dueDate).toBe("2026-09-21");
    });

    it("stops parsing a repeat the user clicked away", () => {
      const parsed = parseTaskTitle("Gym every monday", { now });
      const kept = parseTaskTitle("Gym every monday", { now }, [parsed.tokens[0]!.key]);
      expect(kept.fields.recurrence).toBeUndefined();
    });
  });
});
