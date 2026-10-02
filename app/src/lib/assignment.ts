import type { Task } from "../types";
import type { ProjectActivityEntry } from "../components/collaboration/types";
import { addedAssignees, assigneeFields, isAssignedTo, taskAssigneeIds } from "./assignees";

type Assigned = Pick<Task, "assigneeId" | "assigneeIds">;

/**
 * Assigns a task to these people, in order (an empty list unassigns). Every
 * assignee also joins the task's people, so it stays in their lists and they
 * can see its comments. `assigneeId` stays the first one (older clients).
 */
export function withAssignees(task: Task, personIds: readonly string[]): Task {
  const fields = assigneeFields(personIds);
  const people = task.peopleIds ?? [];
  return { ...task, ...fields, peopleIds: [...people, ...fields.assigneeIds.filter((id) => !people.includes(id))] };
}

/** Assigns a task to one person (null unassigns everybody). */
export function withAssignee(task: Task, personId: string | null): Task {
  return withAssignees(task, personId ? [personId] : []);
}

/** A shared task assigned to others only: someone else is responsible (not mine to do). */
export function isAssignedToSomeoneElse(task: Assigned, userId: string | null | undefined): boolean {
  const assignees = taskAssigneeIds(task);
  return Boolean(userId && assignees.length > 0 && !assignees.includes(userId));
}

/** "My tasks": everything the user is one of the assignees of, across projects. */
export function tasksAssignedTo(tasks: readonly Task[], userId: string | null | undefined): Task[] {
  if (!userId) return [];
  return tasks.filter((task) => !task.deletedAt && isAssignedTo(task, userId));
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
 * Tasks a sync just assigned to the user (they were not among the assignees
 * before: people who already were are not notified again), edited recently
 * enough to be news rather than old history.
 */
export function newlyAssignedToMe(before: ReadonlyMap<string, Assigned>, after: readonly Task[], userId: string | null | undefined, now = Date.now(), windowMs = 15 * 60_000): Task[] {
  if (!userId) return [];
  return after.filter((task) => {
    if (task.deletedAt || task.completed || now - Date.parse(task.updatedAt) >= windowMs) return false;
    const previous = before.get(task.id);
    return addedAssignees(previous ? taskAssigneeIds(previous) : [], taskAssigneeIds(task)).includes(userId);
  });
}
