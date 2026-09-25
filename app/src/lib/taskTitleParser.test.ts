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
});
