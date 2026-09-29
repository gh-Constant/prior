import type { Habit, Task } from "../types";
import { addDays, eventsInRange, loadCalendarState, mondayOf, type CalendarEvent } from "./calendar";
import { quadrantFor } from "./priority";
import { isAndroid, isMac } from "./platform";

/**
 * Home-screen widget snapshot (macOS and Android).
 *
 * Widgets run outside the webview and cannot touch the app's database, so the
 * app exports a small JSON snapshot. On macOS it lands in the shared App Group
 * container and the Swift widgets read it on their timeline refresh (every
 * ~15 min); on Android the Glance widgets read it from SharedPreferences.
 * Keep this model in sync with
 * app/src-tauri/macos-widgets/PriorWidgets/Snapshot.swift and
 * app/src-tauri/gen/android/.../PriorWidget.kt.
 */

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
  calendar: { items: WidgetCalendarItem[] };
};

export type WidgetCalendarItem = {
  id: string;
  title: string;
  date: string;
  startTime: string | null;
  color: string;
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

function toCalendarItem(event: CalendarEvent): WidgetCalendarItem {
  return { id: event.id, title: event.title, date: event.date, startTime: event.startTime, color: event.color };
}

export function buildWidgetSnapshot(tasks: Task[], now = new Date(), habits: Habit[] = []): WidgetSnapshot {
  const today = dayKey(now);
  const live = tasks.filter(isLive);
  const todayTasks = live.filter((task) => isTodayTask(task, today));
  const doneToday = tasks.filter(
    (task) => task.completed && task.deletedAt == null && typeof task.updatedAt === "string" && task.updatedAt.slice(0, 10) === today,
  ).length;
  const inboxTasks = live.filter((task) => task.status === "inbox" || task.status == null);
  const matrix = { focus: 0, plan: 0, quick: 0, later: 0 };
  for (const task of live) matrix[quadrantFor(task)] += 1;
  const weekStart = mondayOf(now);
  const calendarEvents = eventsInRange(loadCalendarState(), habits, weekStart, addDays(weekStart, 6))
    .map(toCalendarItem)
    .slice(0, MAX_WIDGET_ITEMS);
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
    calendar: { items: calendarEvents },
  };
}

/** Write the snapshot for the macOS and Android widgets. No-op elsewhere; best-effort. */
let lastSnapshotAt = 0;
let lastSnapshotJson = "";
const SNAPSHOT_MIN_INTERVAL_MS = 10_000;

export async function refreshWidgetSnapshot(tasks: Task[], habits: Habit[] = []): Promise<void> {
  const android = isAndroid();
  if (!android && !isMac()) return;
  const now = Date.now();
  const snapshotJson = JSON.stringify(buildWidgetSnapshot(tasks, new Date(), habits));
  // A startup refresh can first observe an empty SQLite store and then receive
  // the real rows a moment later. Only identical snapshots are throttled; data
  // changes must reach the widget immediately.
  if (snapshotJson === lastSnapshotJson && now - lastSnapshotAt < SNAPSHOT_MIN_INTERVAL_MS) return;
  lastSnapshotAt = now;
  lastSnapshotJson = snapshotJson;
  // Widgets are best-effort: never break the app for them.
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke(android ? "widget_set_snapshot" : "widget_refresh_snapshot", { snapshotJson });
}

/** Deep-link target opened from a widget tap, e.g. "prior://widget/today". */
export function parseWidgetUrl(raw: string): "today" | "inbox" | "calendar" | "eisenhower" | null {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (parsed.protocol !== "prior:" || parsed.host !== "widget") return null;
  const view = parsed.pathname.replace(/^\/+/, "");
  return view === "today" || view === "inbox" || view === "calendar" || view === "eisenhower" ? view : null;
}
