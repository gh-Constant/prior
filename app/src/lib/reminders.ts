// Reminder planning (specs/REMINDERS.md). Pure functions: which local
// notifications should exist in the rolling window, given tasks, habits and
// the device's notification settings. The scheduler (notificationScheduler)
// turns the plan into platform notifications.
import type { Habit, Task } from "../types";
import { dateKey, habitOccurrenceDates } from "./habits";

export const REMINDER_WINDOW_DAYS = 7;
export const REMINDER_LIMIT = 64;
const SETTINGS_KEY = "prior.notifications.v1";
export const NOTIFICATION_SETTINGS_EVENT = "prior-notification-settings";

export type NotificationSettings = {
  /** Every Prior notification on this device. */
  enabled: boolean;
  /** Habit reminders at their time of day, on scheduled days. */
  habits: boolean;
  /** Quiet hours as HH:mm, or null. A window may wrap past midnight. */
  quietStart: string | null;
  quietEnd: string | null;
};

export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = { enabled: true, habits: true, quietStart: null, quietEnd: null };

function validTime(value: unknown): string | null {
  return typeof value === "string" && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value) ? value : null;
}

/** Notification settings are per device: permissions are per device too. */
export function getNotificationSettings(): NotificationSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULT_NOTIFICATION_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<NotificationSettings>;
    return {
      enabled: parsed.enabled !== false,
      habits: parsed.habits !== false,
      quietStart: validTime(parsed.quietStart),
      quietEnd: validTime(parsed.quietEnd),
    };
  } catch {
    return DEFAULT_NOTIFICATION_SETTINGS;
  }
}

export function saveNotificationSettings(settings: NotificationSettings): void {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* storage unavailable */ }
  if (typeof window !== "undefined") window.dispatchEvent(new Event(NOTIFICATION_SETTINGS_EVENT));
}

export type PlannedNotification = {
  /** Stable 31-bit id, required by native schedulers. */
  id: number;
  key: string;
  kind: "task" | "habit";
  entityId: string;
  title: string;
  at: Date;
  /** Deep link opened when the notification is tapped. */
  target: string;
};

/** FNV-1a, folded to a positive 31-bit integer. */
export function notificationId(key: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < key.length; index += 1) {
    hash ^= key.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 1) || 1;
}

function minutesOf(time: string): number {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

/** Moves an instant inside quiet hours to the end of the quiet window. */
export function outsideQuietHours(at: Date, settings: Pick<NotificationSettings, "quietStart" | "quietEnd">): Date {
  if (!settings.quietStart || !settings.quietEnd || settings.quietStart === settings.quietEnd) return at;
  const start = minutesOf(settings.quietStart);
  const end = minutesOf(settings.quietEnd);
  const minute = at.getHours() * 60 + at.getMinutes();
  const wraps = start > end;
  const inside = wraps ? minute >= start || minute < end : minute >= start && minute < end;
  if (!inside) return at;
  const result = new Date(at);
  result.setHours(Math.floor(end / 60), end % 60, 0, 0);
  if (wraps && minute >= start) result.setDate(result.getDate() + 1);
  return result;
}

function atLocal(day: string, time: string): Date {
  const [year, month, date] = day.split("-").map(Number);
  const [hours, minutes] = time.split(":").map(Number);
  return new Date(year, month - 1, date, hours, minutes, 0, 0);
}

/**
 * Every notification that should be scheduled now: task reminders and habit
 * reminders inside the rolling window, soonest first, capped.
 */
export function planNotifications(tasks: readonly Task[], habits: readonly Habit[], settings: NotificationSettings, now = new Date(), windowDays = REMINDER_WINDOW_DAYS, limit = REMINDER_LIMIT): PlannedNotification[] {
  if (!settings.enabled) return [];
  const horizon = now.getTime() + windowDays * 86_400_000;
  const plan: PlannedNotification[] = [];
  for (const task of tasks) {
    if (task.completed || task.deletedAt || !task.reminderAt) continue;
    const time = Date.parse(task.reminderAt);
    if (!Number.isFinite(time) || time > horizon) continue;
    // A reminder that passed while the app was closed fires once, now.
    if (time < now.getTime() - 60_000) continue;
    const key = `task:${task.id}:${task.reminderAt}`;
    plan.push({ id: notificationId(key), key, kind: "task", entityId: task.id, title: task.title, at: outsideQuietHours(new Date(Math.max(time, now.getTime())), settings), target: `prior://task/${encodeURIComponent(task.id)}` });
  }
  if (settings.habits) {
    const end = new Date(horizon);
    for (const habit of habits) {
      if (habit.deletedAt || !habit.timeOfDay) continue;
      const done = new Set(habit.completedDates);
      for (const day of habitOccurrenceDates(habit, now, end)) {
        if (done.has(day)) continue;
        const at = atLocal(day, habit.timeOfDay);
        if (at.getTime() < now.getTime() || at.getTime() > horizon) continue;
        const key = `habit:${habit.id}:${day}`;
        plan.push({ id: notificationId(key), key, kind: "habit", entityId: habit.id, title: habit.title, at: outsideQuietHours(at, settings), target: `prior://habit/${encodeURIComponent(habit.id)}` });
      }
    }
  }
  return plan.sort((left, right) => left.at.getTime() - right.at.getTime()).slice(0, limit);
}

export type ReminderPreset = "due" | "10min" | "1h" | "morning" | "inOneHour" | "tomorrowMorning";

const MORNING = "09:00";

/** The presets that make sense for a task's due date and time. */
export function reminderPresets(task: Pick<Task, "dueDate" | "dueTime">, now = new Date()): Array<{ preset: ReminderPreset; at: string }> {
  const result: Array<{ preset: ReminderPreset; at: string }> = [];
  const add = (preset: ReminderPreset, at: Date) => {
    if (at.getTime() > now.getTime()) result.push({ preset, at: at.toISOString() });
  };
  if (task.dueDate) {
    if (task.dueTime) {
      const due = atLocal(task.dueDate, task.dueTime);
      add("due", due);
      add("10min", new Date(due.getTime() - 10 * 60_000));
      add("1h", new Date(due.getTime() - 60 * 60_000));
    } else {
      add("due", atLocal(task.dueDate, MORNING));
    }
    // "The morning of" only helps when the task is due later that day.
    if (task.dueTime && task.dueTime > MORNING) add("morning", atLocal(task.dueDate, MORNING));
  }
  add("inOneHour", new Date(now.getTime() + 60 * 60_000));
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  add("tomorrowMorning", atLocal(dateKey(tomorrow), MORNING));
  return result;
}

/** Value for <input type="datetime-local"> in the device time zone. */
export function toDateTimeLocal(iso: string | null | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return "";
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function fromDateTimeLocal(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

/** Parses prior://task/<id>, prior://habit/<id> and prior://new-task. */
export function parseNotificationTarget(url: string): { kind: "task" | "habit"; id: string } | { kind: "new-task" } | null {
  let parsed: URL;
  try { parsed = new URL(url); } catch { return null; }
  if (parsed.protocol !== "prior:") return null;
  const id = decodeURIComponent(parsed.pathname.replace(/^\/+/, ""));
  if (parsed.host === "new-task") return { kind: "new-task" };
  if ((parsed.host === "task" || parsed.host === "habit") && id) return { kind: parsed.host, id };
  return null;
}
