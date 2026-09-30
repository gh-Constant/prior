import type { Task } from "../types";
import type { ProjectActivityEntry } from "../components/collaboration/types";

/**
 * Assigns a task (null unassigns). The assignee also joins the task's
 * people, so it stays in their lists and they can see its comments.
 */
export function withAssignee(task: Task, personId: string | null): Task {
  const people = task.peopleIds ?? [];
  return { ...task, assigneeId: personId, peopleIds: personId && !people.includes(personId) ? [...people, personId] : people };
}

/** A shared task someone else is responsible for (not mine to do). */
export function isAssignedToSomeoneElse(task: Pick<Task, "assigneeId">, userId: string | null | undefined): boolean {
  return Boolean(userId && task.assigneeId && task.assigneeId !== userId);
}

/** "My tasks": everything assigned to the user, across projects. */
export function tasksAssignedTo(tasks: readonly Task[], userId: string | null | undefined): Task[] {
  if (!userId) return [];
  return tasks.filter((task) => !task.deletedAt && task.assigneeId === userId);
}

function localDay(iso: string): string | null {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return null;
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/**
 * The activity grid from this device's copy of a project when the server
 * history is unavailable (offline, or a project never synced). Completion
 * uses the last edit of a completed task, attributed to the current user.
 */
export function localProjectActivity(tasks: readonly Task[], userId: string | null): ProjectActivityEntry[] {
  const byDay = new Map<string, ProjectActivityEntry>();
  const bump = (date: string | null, field: "completed" | "created") => {
    if (!date) return;
    const entry = byDay.get(date) ?? { date, userId, completed: 0, created: 0 };
    entry[field] += 1;
    byDay.set(date, entry);
  };
  for (const task of tasks) {
    if (task.deletedAt) continue;
    bump(localDay(task.createdAt), "created");
    if (task.completed) bump(localDay(task.updatedAt), "completed");
  }
  return [...byDay.values()].sort((left, right) => left.date.localeCompare(right.date));
}

/**
 * Tasks a sync just assigned to the user (they were not theirs before),
 * edited recently enough to be news rather than old history.
 */
export function newlyAssignedToMe(before: ReadonlyMap<string, Pick<Task, "assigneeId">>, after: readonly Task[], userId: string | null | undefined, now = Date.now(), windowMs = 15 * 60_000): Task[] {
  if (!userId) return [];
  return after.filter((task) => !task.deletedAt && !task.completed && task.assigneeId === userId
    && before.get(task.id)?.assigneeId !== userId
    && now - Date.parse(task.updatedAt) < windowMs);
}
