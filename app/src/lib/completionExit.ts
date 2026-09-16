import { useCallback, useEffect, useState } from "react";
import type { Task } from "../types";
import { filterTasks, type TaskFilterState } from "./taskFilters";

export const COMPLETION_EXIT_DURATION_MS = 600;

export type CompletionExitDeadlines = Readonly<Record<string, number>>;

export function retainCompletionExit(
  deadlines: CompletionExitDeadlines,
  taskId: string,
  now = Date.now(),
  duration = COMPLETION_EXIT_DURATION_MS,
): CompletionExitDeadlines {
  const deadline = now + duration;
  if ((deadlines[taskId] ?? 0) >= deadline) return deadlines;
  return { ...deadlines, [taskId]: deadline };
}

export function releaseCompletionExit(deadlines: CompletionExitDeadlines, taskId: string): CompletionExitDeadlines {
  if (!(taskId in deadlines)) return deadlines;
  const next = { ...deadlines };
  delete next[taskId];
  return next;
}

export function pruneCompletionExits(deadlines: CompletionExitDeadlines, now = Date.now()): CompletionExitDeadlines {
  const entries = Object.entries(deadlines);
  const activeEntries = entries.filter(([, deadline]) => deadline > now);
  return activeEntries.length === entries.length ? deadlines : Object.fromEntries(activeEntries);
}

export function filterTasksWithExitingCompletions(
  tasks: Task[],
  filters: TaskFilterState,
  deadlines: CompletionExitDeadlines,
  reference = new Date(),
  now = Date.now(),
): Task[] {
  const visible = filterTasks(tasks, filters, reference);
  if (filters.status !== "open") return visible;

  const visibleIds = new Set(visible.map((task) => task.id));
  const retained = filterTasks(tasks, { ...filters, status: "all" }, reference).filter((task) => (
    task.completed
    && !visibleIds.has(task.id)
    && (deadlines[task.id] ?? 0) > now
  ));

  if (!retained.length) return visible;
  return filterTasks([...visible, ...retained], { ...filters, status: "all" }, reference);
}

export function useCompletionExits() {
  const [deadlines, setDeadlines] = useState<CompletionExitDeadlines>({});

  useEffect(() => {
    const activeDeadlines = Object.values(deadlines);
    if (!activeDeadlines.length) return undefined;

    const nextDeadline = Math.min(...activeDeadlines);
    const timeout = window.setTimeout(() => {
      setDeadlines((current) => pruneCompletionExits(current));
    }, Math.max(0, nextDeadline - Date.now()));

    return () => window.clearTimeout(timeout);
  }, [deadlines]);

  const retain = useCallback((taskId: string) => {
    setDeadlines((current) => retainCompletionExit(current, taskId));
  }, []);

  const release = useCallback((taskId: string) => {
    setDeadlines((current) => releaseCompletionExit(current, taskId));
  }, []);

  return { deadlines, retain, release };
}
