import type { Habit, Task } from "../types";
import { dateKey, habitOccurrenceDates } from "./habits";

/**
 * Open tasks the user is waiting on: the same rule the Waiting view uses
 * (explicit "waiting" status, or delegated to someone).
 */
export function waitingTaskCount(tasks: readonly Task[]): number {
  return tasks.filter((task) => !task.deletedAt && !task.completed && (task.status === "waiting" || Boolean(task.assigneeName))).length;
}

export type HabitProgress = { readonly done: number; readonly total: number };

/** Habits scheduled for the given day, and how many of them are already checked off. */
export function habitProgressForDay(habits: readonly Habit[], reference = new Date()): HabitProgress {
  const day = new Date(reference.getFullYear(), reference.getMonth(), reference.getDate());
  const key = dateKey(day);
  let done = 0;
  let total = 0;
  for (const habit of habits) {
    if (habit.deletedAt) continue;
    if (!habitOccurrenceDates(habit, day, day).includes(key)) continue;
    total += 1;
    if ((habit.completedDates ?? []).includes(key)) done += 1;
  }
  return { done, total };
}
