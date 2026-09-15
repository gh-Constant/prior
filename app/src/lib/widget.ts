import { invoke } from "@tauri-apps/api/core";
import type { Task } from "../types";

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

export async function updateAndroidWidget(tasks: Task[]): Promise<void> {
  if (!isAndroidTauri()) return;
  const items = tasks
    .filter((task) => !task.completed && !task.deletedAt)
    .sort((left, right) => priority(left) - priority(right) || right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, 3)
    .map((task) => task.title);
  await invoke("widget_set_items", { items });
}
