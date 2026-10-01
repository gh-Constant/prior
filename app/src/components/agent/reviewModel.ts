import type {
  AgentMessage,
  QuadrantKey,
  Area,
  EntityUpdateFields,
  Habit,
  Project,
  ProposedEntityUpdate,
  ProposedTaskUpdate,
  Task,
  TaskPriority,
  TaskUpdateFields,
} from "../../types";
import type { Note } from "../../lib/notes";
import { collaborationStore } from "../../lib/collaborationStore";
import { habitScheduleLabel } from "../../lib/habits";
import { quadrantFor } from "../../lib/priority";

/** What the review cards know about the user's current data, to show "before" values. */
export type ProposalContext = {
  readonly tasks: readonly Pick<Task, "id" | "title" | "description" | "dueDate" | "priority" | "important" | "urgent" | "status" | "scheduledDate" | "assigneeName" | "followUpDate" | "completed" | "checklist" | "reminderAt" | "assigneeId" | "milestoneId" | "parentId" | "relations">[];
  readonly projects: readonly Pick<Project, "id" | "name" | "description" | "status" | "health" | "startDate" | "targetDate" | "projectType" | "milestones">[];
  readonly areas: readonly Pick<Area, "id" | "name">[];
  readonly habits: readonly Pick<Habit, "id" | "title" | "important" | "urgent" | "interval" | "unit" | "daysOfWeek" | "endDate">[];
  readonly notes: readonly Pick<Note, "id" | "title" | "favorite">[];
};

export const EMPTY_CONTEXT: ProposalContext = { tasks: [], projects: [], areas: [], habits: [], notes: [] };

/** One side of a diff row, kept as data so the view can format it in the user's language. */
export type DiffValue =
  | { readonly kind: "none" }
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "date"; readonly value: string }
  | { readonly kind: "datetime"; readonly value: string }
  | { readonly kind: "priority"; readonly value: TaskPriority }
  | { readonly kind: "status"; readonly value: string }
  | { readonly kind: "flag"; readonly flag: "important" | "urgent" | "favorite"; readonly on: boolean }
  | { readonly kind: "done"; readonly done: boolean }
  | { readonly kind: "person"; readonly name: string }
  | { readonly kind: "checklist"; readonly items: readonly string[] }
  | { readonly kind: "additions"; readonly items: readonly string[] }
  | { readonly kind: "note"; readonly mode: "rewrite" | "append"; readonly text: string }
  | { readonly kind: "i18n"; readonly key: string; readonly params?: Readonly<Record<string, string | number>> };

export type DiffRow = {
  readonly key: string;
  /** Key under `agentui.field`. */
  readonly field: string;
  /** Absent when the previous value is unknown (the item changed or was removed since). */
  readonly before: DiffValue | null;
  readonly after: DiffValue;
};

const NONE: DiffValue = { kind: "none" };

function text(value: string | null | undefined): DiffValue {
  return value ? { kind: "text", text: value } : NONE;
}

function date(value: string | null | undefined): DiffValue {
  return value ? { kind: "date", value } : NONE;
}

function same(a: DiffValue | null, b: DiffValue): boolean {
  return a !== null && JSON.stringify(a) === JSON.stringify(b);
}

/** A project member's display name from the local collaboration cache. */
export function personName(userId: string): string {
  for (const entry of collaborationStore.list()) {
    const member = entry.members.find((candidate) => candidate.userId === userId);
    if (member) return member.displayName || member.email;
  }
  return "?";
}

function milestoneName(id: string | null | undefined, ctx: ProposalContext): string | null {
  if (!id) return null;
  for (const project of ctx.projects) {
    const found = project.milestones?.find((milestone) => milestone.id === id);
    if (found) return found.name;
  }
  return null;
}

function blockedCount(relations: ReadonlyArray<{ type: string }> | undefined): number {
  return relations?.filter((relation) => relation.type === "blocked_by").length ?? 0;
}

/**
 * The fields a task edit really changes, each with its current value when it is known.
 * Fields whose proposed value equals the current one are left out.
 */
export function taskDiffRows(update: Pick<ProposedTaskUpdate, "taskId" | "changes">, ctx: ProposalContext): DiffRow[] {
  const changes: TaskUpdateFields = update.changes;
  const task = ctx.tasks.find((candidate) => candidate.id === update.taskId);
  const rows: DiffRow[] = [];
  const push = (key: string, field: string, before: DiffValue | null, after: DiffValue) => {
    if (!same(before, after)) rows.push({ key, field, before, after });
  };
  if (changes.title !== undefined) push("title", "title", task ? text(task.title) : null, text(changes.title));
  if (changes.status !== undefined) push("status", "status", task?.status ? { kind: "status", value: task.status } : null, { kind: "status", value: changes.status });
  if (changes.completed !== undefined && changes.status === undefined) push("completed", "completion", task ? { kind: "done", done: task.completed } : null, { kind: "done", done: changes.completed });
  if (changes.priority !== undefined) push("priority", "priority", task ? { kind: "priority", value: task.priority } : null, { kind: "priority", value: changes.priority });
  if (changes.dueDate !== undefined) push("due", "due", task ? date(task.dueDate) : null, date(changes.dueDate));
  if (changes.scheduledDate !== undefined) push("scheduled", "scheduled", task ? date(task.scheduledDate) : null, date(changes.scheduledDate));
  if (changes.followUpDate !== undefined) push("followUp", "followUp", task ? date(task.followUpDate) : null, date(changes.followUpDate));
  if (changes.reminderAt !== undefined) push("reminder", "reminder", task ? (task.reminderAt ? { kind: "datetime", value: task.reminderAt } : NONE) : null, changes.reminderAt ? { kind: "datetime", value: changes.reminderAt } : NONE);
  if (changes.important !== undefined) push("important", "important", task ? { kind: "flag", flag: "important", on: task.important } : null, { kind: "flag", flag: "important", on: changes.important });
  if (changes.urgent !== undefined) push("urgent", "urgent", task ? { kind: "flag", flag: "urgent", on: task.urgent } : null, { kind: "flag", flag: "urgent", on: changes.urgent });
  if (changes.assigneeName !== undefined) push("assignee", "waitingOn", task ? text(task.assigneeName) : null, text(changes.assigneeName));
  if (changes.assigneeId !== undefined) {
    push("assigneeId", "assignee", task ? (task.assigneeId ? { kind: "person", name: personName(task.assigneeId) } : NONE) : null, changes.assigneeId ? { kind: "person", name: personName(changes.assigneeId) } : NONE);
  }
  if (changes.milestoneId !== undefined) {
    const before = milestoneName(task?.milestoneId, ctx);
    const after = milestoneName(changes.milestoneId, ctx);
    push("milestone", "milestone", task ? (before ? text(before) : task.milestoneId ? { kind: "i18n", key: "agentui.value.milestoneSet" } : NONE) : null, after ? text(after) : changes.milestoneId ? { kind: "i18n", key: "agentui.value.milestoneSet" } : NONE);
  }
  if (changes.parentId !== undefined) {
    const parent = (id: string | null | undefined): DiffValue => {
      if (!id) return NONE;
      const found = ctx.tasks.find((candidate) => candidate.id === id);
      return found ? text(found.title) : { kind: "i18n", key: "agent.cards.existingTask" };
    };
    push("parent", "parent", task ? parent(task.parentId) : null, parent(changes.parentId));
  }
  if (changes.relations !== undefined) {
    const count = (n: number): DiffValue => (n ? { kind: "i18n", key: "agent.cards.blockedBy", params: { count: n } } : NONE);
    push("relations", "blockedBy", task ? count(blockedCount(task.relations)) : null, count(blockedCount(changes.relations)));
  }
  if (changes.checklist !== undefined) {
    push("checklist", "checklist", task ? { kind: "checklist", items: (task.checklist ?? []).map((item) => item.title) } : null, { kind: "checklist", items: changes.checklist.map((item) => item.title) });
  }
  if (changes.description !== undefined) push("description", "description", task ? text(task.description) : null, text(changes.description));
  return rows;
}

function cap(value: string): string {
  return value[0].toUpperCase() + value.slice(1);
}

function projectStatus(value: string | undefined): DiffValue {
  return value ? { kind: "i18n", key: `collab.editor.status${cap(value)}` } : NONE;
}

function projectHealth(value: string | null | undefined): DiffValue {
  if (!value) return { kind: "i18n", key: "collab.editor.healthNotSet" };
  return { kind: "i18n", key: value === "On track" ? "collab.editor.healthOnTrack" : value === "At risk" ? "collab.editor.healthAtRisk" : "collab.editor.healthOffTrack" };
}

function projectType(value: string | undefined): DiffValue {
  return { kind: "i18n", key: value === "software" ? "common.workhub.typeSoftware" : "common.workhub.typeStandard" };
}

/** The same for changes to a project, habit, note or area. */
export function entityDiffRows(update: Pick<ProposedEntityUpdate, "kind" | "targetId" | "changes">, ctx: ProposalContext): DiffRow[] {
  const changes: EntityUpdateFields = update.changes;
  const project = update.kind === "project" ? ctx.projects.find((item) => item.id === update.targetId) : undefined;
  const habit = update.kind === "habit" ? ctx.habits.find((item) => item.id === update.targetId) : undefined;
  const note = update.kind === "note" ? ctx.notes.find((item) => item.id === update.targetId) : undefined;
  const area = update.kind === "area" ? ctx.areas.find((item) => item.id === update.targetId) : undefined;
  const rows: DiffRow[] = [];
  const push = (key: string, field: string, before: DiffValue | null, after: DiffValue) => {
    if (!same(before, after)) rows.push({ key, field, before, after });
  };
  const name = changes.name ?? changes.title;
  if (name !== undefined) {
    const current = project?.name ?? habit?.title ?? note?.title ?? area?.name;
    push("name", "name", current !== undefined ? text(current) : null, text(name));
  }
  if (changes.description !== undefined) push("description", "description", project ? text(project.description) : null, text(changes.description));
  if (changes.status !== undefined) push("status", "status", project ? projectStatus(project.status) : null, projectStatus(changes.status));
  if (changes.health !== undefined) push("health", "health", project ? projectHealth(project.health) : null, projectHealth(changes.health));
  if (changes.startDate !== undefined) push("start", "start", project ? date(project.startDate) : null, date(changes.startDate));
  if (changes.targetDate !== undefined) push("target", "target", project ? date(project.targetDate) : null, date(changes.targetDate));
  if (changes.projectType !== undefined) push("type", "type", project ? projectType(project.projectType) : null, projectType(changes.projectType));
  if (changes.icon !== undefined) push("icon", "icon", null, { kind: "i18n", key: "agent.updates.newIcon" });
  if (changes.addMilestones?.length) {
    rows.push({ key: "milestones", field: "milestones", before: null, after: { kind: "additions", items: changes.addMilestones.map((milestone) => milestone.name) } });
  }
  if (changes.important !== undefined) push("important", "important", habit ? { kind: "flag", flag: "important", on: habit.important } : null, { kind: "flag", flag: "important", on: changes.important });
  if (changes.urgent !== undefined) push("urgent", "urgent", habit ? { kind: "flag", flag: "urgent", on: habit.urgent } : null, { kind: "flag", flag: "urgent", on: changes.urgent });
  if (changes.interval !== undefined || changes.unit !== undefined || changes.daysOfWeek !== undefined) {
    const label = (source: Pick<Habit, "interval" | "unit" | "daysOfWeek"> | undefined) => (source ? { kind: "text", text: habitScheduleLabel(source) } as const : null);
    const merged = { interval: changes.interval ?? habit?.interval ?? 1, unit: changes.unit ?? habit?.unit ?? "day", daysOfWeek: changes.daysOfWeek ?? habit?.daysOfWeek };
    push("schedule", "schedule", habit ? label(habit) : null, label(merged) ?? NONE);
  }
  if (changes.endDate !== undefined) push("end", "endDate", habit ? date(habit.endDate) : null, date(changes.endDate));
  if (changes.checkInToday !== undefined) rows.push({ key: "checkin", field: "checkIn", before: null, after: { kind: "i18n", key: changes.checkInToday ? "agent.updates.checkIn" : "agent.updates.undoCheckIn" } });
  if (changes.favorite !== undefined) push("favorite", "favorite", note ? { kind: "flag", flag: "favorite", on: note.favorite } : null, { kind: "flag", flag: "favorite", on: changes.favorite });
  if (changes.bodyMarkdown !== undefined) rows.push({ key: "body", field: "note", before: null, after: { kind: "note", mode: "rewrite", text: changes.bodyMarkdown } });
  if (changes.appendMarkdown !== undefined) rows.push({ key: "append", field: "note", before: null, after: { kind: "note", mode: "append", text: changes.appendMarkdown } });
  return rows;
}

/** Counts shown in the panel header and drive its Apply / done states. */
export type ReviewSummary = {
  readonly tasks: number;
  readonly projects: number;
  readonly areas: number;
  readonly habits: number;
  readonly notes: number;
  readonly folders: number;
  readonly changes: number;
  readonly total: number;
  readonly applied: number;
  readonly pending: number;
  /** Pending and still ticked: what "Apply all" will do. */
  readonly ready: number;
};

type Flagged = { readonly selected: boolean; readonly added?: boolean };

export function summarizeProposals(message: Pick<AgentMessage, "proposedAreas" | "proposedProjects" | "proposedTasks" | "proposedTaskUpdates" | "proposedUpdates" | "proposedHabits" | "proposedNotes" | "proposedFolders">): ReviewSummary {
  const lists: Array<readonly Flagged[]> = [
    message.proposedAreas ?? [], message.proposedProjects ?? [], message.proposedTasks ?? [], message.proposedTaskUpdates ?? [],
    message.proposedUpdates ?? [], message.proposedHabits ?? [], message.proposedNotes ?? [], message.proposedFolders ?? [],
  ];
  const all = lists.flat();
  const applied = all.filter((item) => item.added).length;
  return {
    tasks: message.proposedTasks?.length ?? 0,
    projects: message.proposedProjects?.length ?? 0,
    areas: message.proposedAreas?.length ?? 0,
    habits: message.proposedHabits?.length ?? 0,
    notes: message.proposedNotes?.length ?? 0,
    folders: message.proposedFolders?.length ?? 0,
    changes: (message.proposedTaskUpdates?.length ?? 0) + (message.proposedUpdates?.length ?? 0),
    total: all.length,
    applied,
    pending: all.length - applied,
    ready: all.filter((item) => item.selected && !item.added).length,
  };
}

export function hasProposals(message: Parameters<typeof summarizeProposals>[0]): boolean {
  return summarizeProposals(message).total > 0;
}

export function getQuadrantBadge(task: Pick<Task, "important" | "urgent">): { key: QuadrantKey; label: string } {
  // NOTE: UI labels come from agent.quadrant.* in the cards.
  // The English label here is kept for backward compatibility only.
  const key = quadrantFor(task);
  switch (key) {
    case "focus":
      return { key, label: "Focus (Do First)" };
    case "plan":
      return { key, label: "Plan (Schedule)" };
    case "quick":
      return { key, label: "Quick (Delegate)" };
    case "later":
      return { key, label: "Later (Eliminate)" };
  }
}
