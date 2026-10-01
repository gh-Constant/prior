// The one client path that persists a task update which may complete a
// recurring task (specs/RECURRING_TASKS.md): changeTask (rows, board drops,
// matrix, detail panel), the composer's status, and assistant review cards all
// go through it.
import type { Task } from "../types";
import { localStore } from "./localStore";
import { buildNextOccurrence } from "./recurrence";

export type TaskUpdateResult = {
  /** The task as saved. */
  readonly saved: Task;
  /** The next occurrence, when this update completed a recurring task. */
  readonly next: Task | null;
};

/**
 * Saves `task`. When the update completes a recurring task (it was not
 * completed before) the completed task stops repeating and its next
 * occurrence is created. Reopening a task never creates anything, and the
 * completed task keeping no rule means another device that pulls it cannot
 * create a duplicate.
 */
export async function updateTaskAndRepeat(task: Task, previous: Task | undefined, now: Date = new Date()): Promise<TaskUpdateResult> {
  if (!task.completed || previous?.completed || !task.recurrence) {
    return { saved: await localStore.updateTask(task), next: null };
  }
  const occurrence = buildNextOccurrence(task, now, previous);
  // The next occurrence first: if the second write fails, the series is not lost.
  const next = occurrence ? await localStore.saveTask(occurrence) : null;
  const saved = await localStore.updateTask({ ...task, recurrence: null });
  return { saved, next };
}
