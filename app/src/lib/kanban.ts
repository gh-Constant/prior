import type { Project, Task, TaskPriority, TaskStatus } from "../types";
import { TASK_GROUP_ORDER, groupTasksByStatus } from "./taskGroups";

/**
 * Pure column building and move semantics for the "All tasks" Kanban
 * (specs/KANBAN.md). The board component only renders what these functions
 * return and asks them for the patch a drop implies.
 */

export type KanbanGroupBy = "status" | "priority" | "project" | "due";
export const KANBAN_GROUP_BYS: readonly KanbanGroupBy[] = ["status", "priority", "project", "due"];
export const DEFAULT_KANBAN_GROUP_BY: KanbanGroupBy = "status";

export type DueBucket = "overdue" | "today" | "tomorrow" | "week" | "later" | "none";
export const DUE_BUCKET_ORDER: readonly DueBucket[] = ["overdue", "today", "tomorrow", "week", "later", "none"];

export type KanbanGlyph =
  | { readonly kind: "status"; readonly status: TaskStatus }
  | { readonly kind: "priority"; readonly priority: TaskPriority }
  | { readonly kind: "project"; readonly project: Pick<Project, "id" | "icon" | "projectType"> | null }
  | { readonly kind: "due"; readonly bucket: DueBucket };

export type KanbanColumnData = {
  readonly id: string;
  /** Translation key of a fixed label (statuses, priorities, due buckets). */
  readonly labelKey?: string;
  /** Literal label (project names). */
  readonly label?: string;
  readonly glyph: KanbanGlyph;
  readonly tasks: Task[];
  /** False for derived columns that cannot be assigned (Overdue). */
  readonly droppable: boolean;
  /** Offered a "+" button to create a task directly in the column. */
  readonly canAdd: boolean;
};

export type KanbanContext = {
  readonly projects: readonly Pick<Project, "id" | "name" | "icon" | "projectType" | "status">[];
  /** Local date key (YYYY-MM-DD) of today. */
  readonly today: string;
  /** Completed tasks to show in the status board's Done column when the list filter hides them. */
  readonly doneTasks?: readonly Task[];
};

/** Column id of "no project" (a project id can never start with two underscores). */
export const NO_PROJECT_COLUMN = "__none";
const WEEK_DAYS = 7;

function parseKey(key: string): Date {
  return new Date(Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 1, Number(key.slice(8, 10)));
}

export function dateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function addDaysToKey(key: string, days: number): string {
  const date = parseKey(key);
  date.setDate(date.getDate() + days);
  return dateKey(date);
}

function dayOffset(from: string, to: string): number {
  return Math.round((Date.UTC(Number(to.slice(0, 4)), Number(to.slice(5, 7)) - 1, Number(to.slice(8, 10))) - Date.UTC(Number(from.slice(0, 4)), Number(from.slice(5, 7)) - 1, Number(from.slice(8, 10)))) / 86_400_000);
}

/** Which due-date column a date belongs to. "This week" is today+2 … today+6. */
export function dueBucket(dueDate: string | null | undefined, today: string): DueBucket {
  if (!dueDate) return "none";
  const offset = dayOffset(today, dueDate.slice(0, 10));
  if (!Number.isFinite(offset)) return "none";
  if (offset < 0) return "overdue";
  if (offset === 0) return "today";
  if (offset === 1) return "tomorrow";
  if (offset < WEEK_DAYS) return "week";
  return "later";
}

/**
 * The date a drop on a due-date column assigns. "This week" is the coming
 * Friday when it falls within today+2 … today+6, otherwise today+3, so the
 * card always lands in the column it was dropped on. Overdue cannot be a
 * target (null).
 */
export function dueDropDate(bucket: DueBucket, today: string): string | null | undefined {
  switch (bucket) {
    case "today": return today;
    case "tomorrow": return addDaysToKey(today, 1);
    case "week": {
      for (let offset = 2; offset < WEEK_DAYS; offset += 1) {
        const candidate = addDaysToKey(today, offset);
        if (parseKey(candidate).getDay() === 5) return candidate;
      }
      return addDaysToKey(today, 3);
    }
    case "later": return addDaysToKey(today, WEEK_DAYS);
    case "none": return null;
    case "overdue": return undefined;
  }
}

const PRIORITIES: readonly TaskPriority[] = [1, 2, 3, 4];

/** Builds the columns of the board for one grouping, keeping the incoming task order inside each. */
export function buildKanbanColumns(tasks: readonly Task[], groupBy: KanbanGroupBy, context: KanbanContext): KanbanColumnData[] {
  if (groupBy === "priority") {
    return PRIORITIES.map((priority) => ({
      id: String(priority),
      labelKey: `tasks.list.priority${priority}`,
      glyph: { kind: "priority", priority },
      tasks: tasks.filter((task) => (task.priority ?? 4) === priority),
      droppable: true,
      canAdd: true,
    }));
  }
  if (groupBy === "project") {
    const known = new Set(context.projects.map((project) => project.id));
    const used = new Set(tasks.map((task) => task.projectId).filter((id): id is string => Boolean(id)));
    const projects = context.projects.filter((project) => project.status !== "completed" || used.has(project.id));
    return [
      { id: NO_PROJECT_COLUMN, labelKey: "kanban.noProject", glyph: { kind: "project", project: null }, tasks: tasks.filter((task) => !task.projectId || !known.has(task.projectId)), droppable: true, canAdd: true },
      ...projects.map((project): KanbanColumnData => ({
        id: project.id,
        label: project.name,
        glyph: { kind: "project", project },
        tasks: tasks.filter((task) => task.projectId === project.id),
        droppable: true,
        canAdd: true,
      })),
    ];
  }
  if (groupBy === "due") {
    return DUE_BUCKET_ORDER.map((bucket) => ({
      id: bucket,
      labelKey: `kanban.due.${bucket}`,
      glyph: { kind: "due", bucket },
      tasks: tasks.filter((task) => dueBucket(task.dueDate, context.today) === bucket),
      droppable: bucket !== "overdue",
      canAdd: bucket !== "overdue",
    }));
  }
  const groups = groupTasksByStatus(tasks);
  const seen = new Set(tasks.map((task) => task.id));
  return TASK_GROUP_ORDER.map((status) => {
    const group = groups.find((item) => item.status === status)?.tasks ?? [];
    const extra = status === "done" ? (context.doneTasks ?? []).filter((task) => !seen.has(task.id)) : [];
    return {
      id: status,
      labelKey: `tasks.list.groups.${status}`,
      glyph: { kind: "status", status },
      tasks: [...group, ...extra],
      droppable: true,
      canAdd: status !== "done",
    };
  });
}

/** Column a task currently sits in, for one grouping. */
export function kanbanColumnOf(task: Task, groupBy: KanbanGroupBy, context: Pick<KanbanContext, "projects" | "today">): string {
  if (groupBy === "priority") return String(task.priority ?? 4);
  if (groupBy === "due") return dueBucket(task.dueDate, context.today);
  if (groupBy === "project") return task.projectId && context.projects.some((project) => project.id === task.projectId) ? task.projectId : NO_PROJECT_COLUMN;
  return task.completed ? "done" : (TASK_GROUP_ORDER.includes(task.status as TaskStatus) && task.status !== "done" ? task.status as TaskStatus : "inbox");
}

/**
 * The task a drop on `columnId` produces, or null when nothing changes or the
 * column cannot be assigned. The caller saves it with the usual change path.
 */
export function applyKanbanMove(task: Task, groupBy: KanbanGroupBy, columnId: string, context: Pick<KanbanContext, "projects" | "today">): Task | null {
  if (kanbanColumnOf(task, groupBy, context) === columnId) return null;
  if (groupBy === "priority") {
    const priority = Number(columnId) as TaskPriority;
    return PRIORITIES.includes(priority) ? { ...task, priority } : null;
  }
  if (groupBy === "project") {
    if (columnId === NO_PROJECT_COLUMN) return { ...task, projectId: null, milestoneId: null, parentId: null };
    if (!context.projects.some((project) => project.id === columnId)) return null;
    // Milestones and parents belong to one project: they do not follow the task.
    return { ...task, projectId: columnId, milestoneId: null, parentId: null };
  }
  if (groupBy === "due") {
    const date = dueDropDate(columnId as DueBucket, context.today);
    if (date === undefined) return null;
    return date === null ? { ...task, dueDate: null, dueTime: null } : { ...task, dueDate: date };
  }
  if (!TASK_GROUP_ORDER.includes(columnId as TaskStatus)) return null;
  const status = columnId as TaskStatus;
  return { ...task, status, completed: status === "done" };
}

/** True when a task waits on another task that is not done yet. */
export function isTaskBlocked(task: Pick<Task, "relations">, byId: ReadonlyMap<string, Pick<Task, "completed">>): boolean {
  return (task.relations ?? []).some((relation) => relation.type === "blocked_by" && byId.get(relation.taskId)?.completed === false);
}

const LAYOUT_KEY = "prior.tasks.layout";
const GROUP_BY_KEY = "prior.tasks.groupBy";
export type TaskLayout = "list" | "board";

function readStored(key: string): string | null {
  try { return typeof localStorage === "undefined" ? null : localStorage.getItem(key); } catch { return null; }
}

function writeStored(key: string, value: string): void {
  try { if (typeof localStorage !== "undefined") localStorage.setItem(key, value); } catch { /* storage unavailable */ }
}

export function loadTaskLayout(): TaskLayout {
  return readStored(LAYOUT_KEY) === "board" ? "board" : "list";
}

export function saveTaskLayout(layout: TaskLayout): void {
  writeStored(LAYOUT_KEY, layout);
}

export function loadKanbanGroupBy(): KanbanGroupBy {
  const stored = readStored(GROUP_BY_KEY);
  return KANBAN_GROUP_BYS.find((value) => value === stored) ?? DEFAULT_KANBAN_GROUP_BY;
}

export function saveKanbanGroupBy(groupBy: KanbanGroupBy): void {
  writeStored(GROUP_BY_KEY, groupBy);
}
