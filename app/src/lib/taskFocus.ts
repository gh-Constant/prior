import type { Task } from "../types";

function effectiveStatus(task: Task): string {
  return task.status ?? "next";
}

function isDueBy(task: Task, today: string): boolean {
  return Boolean(task.dueDate && task.dueDate <= today);
}

function isScheduledBy(task: Task, today: string): boolean {
  return Boolean(task.scheduledDate && task.scheduledDate <= today);
}

/**
 * Score the small set of tasks that deserve attention on the Today dashboard.
 * Importance and urgency are intentionally independent from dates: a task can
 * be the right thing to do now even when it has no due date.
 */
export function taskFocusScore(task: Task, today: string): number {
  if (task.completed) return Number.NEGATIVE_INFINITY;

  const status = effectiveStatus(task);
  const hasImmediateSignal = isDueBy(task, today) || isScheduledBy(task, today) || task.important || task.urgent;
  if (status === "backlog" || status === "waiting") return Number.NEGATIVE_INFINITY;
  if (status === "inbox" && !hasImmediateSignal) return Number.NEGATIVE_INFINITY;

  let score = 0;
  if (task.dueDate && task.dueDate < today) score += 1600;
  else if (task.dueDate === today) score += 1350;
  if (task.scheduledDate && task.scheduledDate <= today) score += 1200;
  if (task.urgent) score += 500;
  if (task.important) score += 350;
  if (status === "in_progress") score += 250;
  if (status === "next") score += 150;
  score += (5 - (task.priority ?? 4)) * 25;
  return score;
}

export function rankFocusTasks(tasks: readonly Task[], today: string): Task[] {
  return tasks
    .filter((task) => Number.isFinite(taskFocusScore(task, today)))
    .sort((left, right) => taskFocusScore(right, today) - taskFocusScore(left, today) || right.updatedAt.localeCompare(left.updatedAt));
}
