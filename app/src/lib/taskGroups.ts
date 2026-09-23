import type { Task, TaskStatus } from "../types";

/** Display order of the status groups in "All tasks" (list and board). */
export const TASK_GROUP_ORDER: readonly TaskStatus[] = ["in_progress", "next", "inbox", "waiting", "backlog", "done"];

export type TaskStatusGroup = {
  readonly status: TaskStatus;
  readonly tasks: Task[];
};

/** Stable workflow status of a task, normalising legacy/missing values. */
export function taskGroupStatus(task: Pick<Task, "completed" | "status">): TaskStatus {
  if (task.completed) return "done";
  const status = task.status;
  return status && TASK_GROUP_ORDER.includes(status) && status !== "done" ? status : "inbox";
}

/**
 * Buckets tasks by workflow status while keeping the incoming order inside
 * each bucket, so the active sort option still applies within a group.
 * `placement` lets callers pin a task to another group (e.g. a task that was
 * just completed stays in place while its exit animation plays).
 */
export function groupTasksByStatus(tasks: readonly Task[], placement?: (task: Task) => TaskStatus | undefined): TaskStatusGroup[] {
  const buckets = new Map<TaskStatus, Task[]>(TASK_GROUP_ORDER.map((status) => [status, []]));
  for (const task of tasks) {
    const status = placement?.(task) ?? taskGroupStatus(task);
    buckets.get(status)?.push(task);
  }
  return TASK_GROUP_ORDER.map((status) => ({ status, tasks: buckets.get(status) ?? [] }));
}

export type DueTone = "overdue" | "today" | "tomorrow" | "upcoming";

function localDayStart(value: Date): number {
  const day = new Date(value);
  day.setHours(0, 0, 0, 0);
  return day.getTime();
}

/** Relative position of an ISO due date against the local calendar day. */
export function dueTone(dueDate: string, reference = new Date()): DueTone {
  const due = new Date(`${dueDate.slice(0, 10)}T00:00:00`).getTime();
  const today = localDayStart(reference);
  if (!Number.isFinite(due)) return "upcoming";
  if (due < today) return "overdue";
  if (due === today) return "today";
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (due === tomorrow.getTime()) return "tomorrow";
  return "upcoming";
}

/** Initials for an avatar, from a free-form assignee name. */
export function initialsFor(name: string): string {
  const parts = name.trim().split(/[\s._@-]+/).filter(Boolean);
  if (!parts.length) return "";
  if (parts.length === 1) return parts[0].slice(0, 2).toLocaleUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toLocaleUpperCase();
}
