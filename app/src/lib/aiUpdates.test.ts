import { beforeEach, describe, expect, it } from "vitest";
import { buildSystemPrompt, parseAiResponse } from "./ai";
import { collaborationStore } from "./collaborationStore";
import type { Habit, Project, Task } from "../types";
import type { Note } from "./notes";

const now = new Date().toISOString();
const project: Project = { id: "p1", areaId: null, name: "Launch", description: "", status: "active", projectType: "software", milestones: [{ id: "m1", name: "Beta", targetDate: "2026-11-01" }], createdAt: now, updatedAt: now, deletedAt: null };
const base = { description: "", dueDate: null, priority: 4 as const, completed: false, important: false, urgent: false, createdAt: now, updatedAt: now, deletedAt: null };
const parent: Task = { ...base, id: "t-parent", title: "Ship beta", projectId: "p1" };
const child: Task = { ...base, id: "t-child", title: "Write docs", projectId: "p1" };
const other: Task = { ...base, id: "t-other", title: "Personal errand" };
const habit: Habit = { id: "h1", title: "Run", important: false, urgent: false, interval: 1, unit: "day", startDate: "2026-09-01", completedDates: [], createdAt: now, updatedAt: now, deletedAt: null };
const note = { id: "n1", title: "Meeting", body: "Notes", folderId: null, projectId: null, favorite: false, createdAt: now, updatedAt: now, deletedAt: null } as Note;

describe("assistant changes to existing items", () => {
  beforeEach(() => {
    localStorage.clear();
    collaborationStore.merge([{ project, role: "owner", members: [
      { userId: "u-me", email: "me@example.com", displayName: "Me", role: "owner", status: "active", createdAt: now },
      { userId: "u-lea", email: "lea@example.com", displayName: "Léa Martin", role: "editor", status: "active", createdAt: now },
    ] }]);
  });

  it("describes ids, members, milestones and completed work in the prompt", () => {
    const prompt = buildSystemPrompt([parent, { ...child, assigneeId: "u-lea", milestoneId: "m1" }, { ...other, completed: true }], [habit], false, [note], [], [], [project]);
    expect(prompt).toContain("[id: p1]");
    expect(prompt).toContain('shared with "Me"');
    expect(prompt).toContain('assignee: "Léa Martin"');
    expect(prompt).toContain('milestone: "Beta"');
    expect(prompt).toContain("[id: h1]");
    expect(prompt).toContain("Recently completed tasks");
    expect(prompt).toContain("update_project");
  });

  it("keeps only valid changes to real projects, habits and notes", () => {
    const raw = JSON.stringify({
      reply: "ok",
      updates: [
        { kind: "project", targetId: "p1", changes: { status: "paused", projectType: "software", addMilestones: [{ name: "Beta" }, { name: "GA", targetDate: "2026-12-01" }] } },
        { kind: "habit", targetId: "h1", changes: { checkInToday: true } },
        { kind: "note", targetId: "n1", changes: { appendMarkdown: "- decided" } },
        { kind: "project", targetId: "unknown", changes: { status: "paused" } },
        { kind: "habit", targetId: "h1", changes: { title: "Run" } },
      ],
    });
    const { updates } = parseAiResponse(raw, [], { projects: [project], habits: [habit], notes: [note] });
    expect(updates).toHaveLength(3);
    expect(updates[0]).toMatchObject({ kind: "project", targetTitle: "Launch", changes: { status: "paused", addMilestones: [{ name: "GA", targetDate: "2026-12-01" }] } });
    expect(updates[0].changes.projectType).toBeUndefined();
    expect(updates[1].changes).toEqual({ checkInToday: true });
    expect(updates[2].changes).toEqual({ appendMarkdown: "- decided" });
  });

  it("resolves assignees, milestones, parents and blockers against the project", () => {
    const raw = JSON.stringify({
      reply: "ok",
      tasks: [
        { title: "Test beta", projectName: "Launch", assignee: "léa", milestone: "beta", parentTaskId: "t-parent", blockedBy: ["t-child", "nope"] },
        { title: "Stranger task", projectName: "Launch", assignee: "Bob" },
      ],
      taskUpdates: [
        { taskId: "t-child", changes: { assignee: "lea@example.com", parentTaskId: "t-other", blockedBy: ["t-parent"] } },
      ],
    });
    const result = parseAiResponse(raw, [parent, child, other], { projects: [project] });
    expect(result.tasks[0]).toMatchObject({ assigneeId: "u-lea", assigneeLabel: "Léa Martin", milestoneId: "m1", parentId: "t-parent", blockedByTaskIds: ["t-child"] });
    // Bob is not a member: he stays a free-text delegate, never an assignee.
    expect(result.tasks[1]).toMatchObject({ assigneeName: "Bob" });
    expect(result.tasks[1].assigneeId).toBeUndefined();
    // A parent from another project is refused; the rest applies.
    expect(result.taskUpdates[0].changes).toEqual({ assigneeId: "u-lea", relations: [{ type: "blocked_by", taskId: "t-parent" }] });
  });
});
