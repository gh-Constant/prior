import { describe, expect, it } from "vitest";
import type { Task } from "../types";
import { buildProposedTaskUpdate, buildSystemPrompt, parseAiResponse } from "./ai";

const task: Task = {
  id: "t1", title: "Plan trip", description: "", dueDate: null, priority: 4, completed: false, important: true, urgent: false,
  createdAt: "2026-09-01T00:00:00Z", updatedAt: "2026-09-01T00:00:00Z", deletedAt: null,
  checklist: [{ id: "c1", title: "Book flights", done: false, position: 0 }],
};

describe("assistant checklist and reminder tools", () => {
  it("creates tasks with a checklist and a reminder", () => {
    const parsed = parseAiResponse(JSON.stringify({ reply: "ok", tasks: [{ title: "Pack", checklist: ["Passport", { title: "Charger" }, "", 3], reminderAt: "2026-10-01T09:00:00+02:00" }] }));
    expect(parsed.tasks[0].checklist).toEqual(["Passport", "Charger"]);
    expect(parsed.tasks[0].reminderAt).toBe("2026-10-01T07:00:00.000Z");
  });

  it("updates checklists keeping item ids and sets or clears reminders", () => {
    const tasksById = new Map([[task.id, task]]);
    const update = buildProposedTaskUpdate({ taskId: "t1", changes: { checklist: [{ title: "book flights", done: true }, { title: "Reserve hotel" }], reminderAt: "2026-10-01T09:00:00Z" } }, tasksById)!;
    expect(update.changes.checklist).toEqual([
      { id: "c1", title: "book flights", done: true, position: 0 },
      expect.objectContaining({ title: "Reserve hotel", done: false, position: 1 }),
    ]);
    expect(update.changes.reminderAt).toBe("2026-10-01T09:00:00.000Z");
    // Unchanged checklist and absent reminder produce no change at all.
    expect(buildProposedTaskUpdate({ taskId: "t1", changes: { checklist: [{ title: "Book flights", done: false }] } }, tasksById)).toBeNull();
    const cleared = buildProposedTaskUpdate({ taskId: "t1", changes: { reminderAt: null } }, new Map([[task.id, { ...task, reminderAt: "2026-10-01T09:00:00.000Z" }]]))!;
    expect(cleared.changes).toEqual({ reminderAt: null });
  });

  it("describes checklists and reminders to the model", () => {
    const prompt = buildSystemPrompt([{ ...task, reminderAt: "2026-10-01T09:00:00.000Z" }], []);
    expect(prompt).toContain("checklist 0/1: [ ] Book flights");
    expect(prompt).toContain("reminder 2026-10-01T09:00:00.000Z");
    expect(prompt).toContain("checklist of subtasks");
  });
});
