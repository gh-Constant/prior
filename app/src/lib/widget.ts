import { invoke } from "@tauri-apps/api/core";
import type { Habit, Task } from "../types";
import { habitStatus } from "./habits";

function isAndroidTauri(): boolean {
  return typeof window !== "undefined" &&
    "__TAURI_INTERNALS__" in window &&
    navigator.userAgent.toLowerCase().includes("android");
}

function priority(task: Task): number {
  if (task.important && task.urgent) return 0;
  if (task.important) return 1;
  if (task.urgent) return 2;
  return 3;
}

export async function updateAndroidWidget(tasks: Task[], habits: Habit[] = []): Promise<void> {
  if (!isAndroidTauri()) return;
  const taskItems = tasks
    .filter((task) => !task.completed && !task.deletedAt)
    .sort((left, right) => priority(left) - priority(right) || right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, 3)
    .map((task) => task.title);
  const habitItems = habits
    .filter((habit) => !habit.deletedAt && ["due", "overdue"].includes(habitStatus(habit)))
    .sort((left, right) => Number(right.urgent) - Number(left.urgent) || Number(right.important) - Number(left.important))
    .map((habit) => `↻ ${habit.title}`);
  await invoke("widget_set_items", { items: [...taskItems, ...habitItems].slice(0, 3) });
}
