import { describe, expect, it } from "vitest";
import { EMPTY_CONTEXT, entityDiffRows, summarizeProposals, taskDiffRows, type ProposalContext } from "./reviewModel";

const task = { id: "t1", title: "Send invoice", description: "", dueDate: "2026-10-03", priority: 3 as const, important: false, urgent: false, completed: false };

describe("summarizeProposals", () => {
  it("counts every kind and what is still to apply", () => {
    const summary = summarizeProposals({
      proposedTasks: [
        { id: "a", title: "A", description: "", dueDate: null, priority: 4, important: false, urgent: false, reasoning: "", selected: true },
        { id: "b", title: "B", description: "", dueDate: null, priority: 4, important: false, urgent: false, reasoning: "", selected: false },
        { id: "c", title: "C", description: "", dueDate: null, priority: 4, important: false, urgent: false, reasoning: "", selected: true, added: true },
      ],
      proposedTaskUpdates: [{ id: "u", taskId: "t1", taskTitle: "T", changes: {}, reasoning: "", selected: true }],
    });
    expect(summary).toMatchObject({ tasks: 3, changes: 1, total: 4, applied: 1, pending: 3, ready: 2 });
  });

  it("is empty without proposals", () => {
    expect(summarizeProposals({}).total).toBe(0);
  });
});

describe("taskDiffRows", () => {
  const context: ProposalContext = { ...EMPTY_CONTEXT, tasks: [task] };

  it("pairs each changed field with its current value", () => {
    const rows = taskDiffRows({ taskId: "t1", changes: { dueDate: "2026-10-09", priority: 1 } }, context);
    expect(rows.map((row) => row.field)).toEqual(["priority", "due"]);
    expect(rows[0]).toMatchObject({ before: { kind: "priority", value: 3 }, after: { kind: "priority", value: 1 } });
    expect(rows[1]).toMatchObject({ before: { kind: "date", value: "2026-10-03" }, after: { kind: "date", value: "2026-10-09" } });
  });

  it("leaves out fields that do not change", () => {
    expect(taskDiffRows({ taskId: "t1", changes: { title: "Send invoice", priority: 3 } }, context)).toEqual([]);
  });

  it("shows a cleared date as none", () => {
    const [row] = taskDiffRows({ taskId: "t1", changes: { dueDate: null } }, context);
    expect(row.after).toEqual({ kind: "none" });
  });

  it("keeps working when the task is unknown", () => {
    const [row] = taskDiffRows({ taskId: "gone", changes: { priority: 1 } }, context);
    expect(row.before).toBeNull();
    expect(row.after).toEqual({ kind: "priority", value: 1 });
  });

  it("reports completion only when the status is not part of the change", () => {
    expect(taskDiffRows({ taskId: "t1", changes: { completed: true, status: "done" } }, context).map((row) => row.field)).toEqual(["status"]);
    expect(taskDiffRows({ taskId: "t1", changes: { completed: true } }, context).map((row) => row.field)).toEqual(["completion"]);
  });

  it("diffs checklists as item titles", () => {
    const withList: ProposalContext = { ...EMPTY_CONTEXT, tasks: [{ ...task, checklist: [{ id: "1", title: "Draft", done: false, position: 0 }] }] };
    const [row] = taskDiffRows({ taskId: "t1", changes: { checklist: [{ id: "1", title: "Draft", done: false, position: 0 }, { id: "2", title: "Send", done: false, position: 1 }] } }, withList);
    expect(row).toMatchObject({ field: "checklist", before: { kind: "checklist", items: ["Draft"] }, after: { kind: "checklist", items: ["Draft", "Send"] } });
  });
});

describe("entityDiffRows", () => {
  it("diffs a project against the known project", () => {
    const context: ProposalContext = { ...EMPTY_CONTEXT, projects: [{ id: "p1", name: "Launch", description: "", status: "active" }] };
    const rows = entityDiffRows({ kind: "project", targetId: "p1", changes: { name: "Launch v2", status: "paused", targetDate: "2026-12-01" } }, context);
    expect(rows.map((row) => row.field)).toEqual(["name", "status", "target"]);
    expect(rows[0].before).toEqual({ kind: "text", text: "Launch" });
    expect(rows[1].before).toEqual({ kind: "i18n", key: "collab.editor.statusActive" });
  });

  it("lists new milestones and note edits without a previous value", () => {
    const rows = entityDiffRows({ kind: "project", targetId: "p1", changes: { addMilestones: [{ name: "Beta", targetDate: null }] } }, EMPTY_CONTEXT);
    expect(rows[0]).toMatchObject({ field: "milestones", before: null, after: { kind: "additions", items: ["Beta"] } });
    const [note] = entityDiffRows({ kind: "note", targetId: "n1", changes: { appendMarkdown: "- more" } }, EMPTY_CONTEXT);
    expect(note.after).toEqual({ kind: "note", mode: "append", text: "- more" });
  });
});
