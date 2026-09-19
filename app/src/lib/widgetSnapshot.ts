import type { Task } from "../types";
import { quadrantFor } from "./priority";
import { isMac } from "./platform";

/**
 * macOS widget snapshot.
 *
 * WidgetKit extensions run in a separate sandbox and cannot touch the app's
 * SQLite database, so the app exports a small JSON snapshot into the shared
 * App Group container. The Swift widgets read that file on their timeline
 * refresh (every ~15 min). Keep this model in sync with
 * app/src-tauri/macos-widgets/PriorWidgets/Snapshot.swift.
 */

export const WIDGET_APP_GROUP = "group.fr.constantsuchet.prior";
export const WIDGET_SNAPSHOT_FILE = "prior-widget-snapshot.json";

export type WidgetTaskItem = {
  id: string;
  title: string;
  done: boolean;
  dueDate: string | null;
  priority: number;
};

export type WidgetSnapshot = {
  version: 1;
  app: "prior";
  updatedAt: string;
  today: { open: number; done: number; items: WidgetTaskItem[] };
  inbox: { total: number; items: WidgetTaskItem[] };
  matrix: { focus: number; plan: number; quick: number; later: number };
};

export const MAX_WIDGET_ITEMS = 8;

function dayKey(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function isLive(task: Task): boolean {
  return !task.completed && task.deletedAt == null && task.status !== "waiting" && task.status !== "done" && task.status !== "backlog";
}

function isTodayTask(task: Task, today: string): boolean {
  if (!isLive(task)) return false;
  if (task.status === "in_progress") return true;
  if (task.scheduledDate === today) return true;
  return !!task.dueDate && task.dueDate <= today;
}

function toItem(task: Task): WidgetTaskItem {
  return { id: task.id, title: task.title, done: task.completed, dueDate: task.dueDate, priority: task.priority ?? 4 };
}

function byDueDate(a: WidgetTaskItem, b: WidgetTaskItem): number {
  if (a.dueDate == null && b.dueDate == null) return a.title.localeCompare(b.title);
  if (a.dueDate == null) return 1;
  if (b.dueDate == null) return -1;
  return a.dueDate.localeCompare(b.dueDate) || a.title.localeCompare(b.title);
}

export function buildWidgetSnapshot(tasks: Task[], now = new Date()): WidgetSnapshot {
  const today = dayKey(now);
  const live = tasks.filter(isLive);
  const todayTasks = live.filter((task) => isTodayTask(task, today));
  const doneToday = tasks.filter(
    (task) => task.completed && task.deletedAt == null && typeof task.updatedAt === "string" && task.updatedAt.slice(0, 10) === today,
  ).length;
  const inboxTasks = live.filter((task) => task.status === "inbox" || task.status == null);
  const matrix = { focus: 0, plan: 0, quick: 0, later: 0 };
  for (const task of live) matrix[quadrantFor(task)] += 1;
  return {
    version: 1,
    app: "prior",
    updatedAt: now.toISOString(),
    today: {
      open: todayTasks.length,
      done: doneToday,
      items: todayTasks.map(toItem).sort(byDueDate).slice(0, MAX_WIDGET_ITEMS),
    },
    inbox: {
      total: inboxTasks.length,
      items: inboxTasks.map(toItem).sort(byDueDate).slice(0, MAX_WIDGET_ITEMS),
    },
    matrix,
  };
}

/** Write the snapshot for the macOS widgets. No-op off macOS; best-effort. */
let lastSnapshotAt = 0;
const SNAPSHOT_MIN_INTERVAL_MS = 10_000;

export async function refreshWidgetSnapshot(tasks: Task[]): Promise<void> {
  if (!isMac()) return;
  const now = Date.now();
  if (now - lastSnapshotAt < SNAPSHOT_MIN_INTERVAL_MS) return;
  lastSnapshotAt = now;
  const snapshotJson = JSON.stringify(buildWidgetSnapshot(tasks));
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("widget_refresh_snapshot", { snapshotJson });
    return;
  } catch {
    // Fallback to plugin-fs
  }
  try {
    const { homeDir, join } = await import("@tauri-apps/api/path");
    const { mkdir, writeTextFile } = await import("@tauri-apps/plugin-fs");
    const dir = await join(await homeDir(), "Library", "Group Containers", WIDGET_APP_GROUP);
    await mkdir(dir, { recursive: true });
    await writeTextFile(await join(dir, WIDGET_SNAPSHOT_FILE), snapshotJson);
  } catch {
    // Widgets are best-effort: never break the app for them.
  }
}

/** Deep-link target opened from a widget tap, e.g. "prior://widget/today". */
export function parseWidgetUrl(raw: string): "today" | "inbox" | "eisenhower" | null {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (parsed.protocol !== "prior:" || parsed.host !== "widget") return null;
  const view = parsed.pathname.replace(/^\/+/, "");
  return view === "today" || view === "inbox" || view === "eisenhower" ? view : null;
}
