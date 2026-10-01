// Local notifications (specs/REMINDERS.md). No push server: every device
// schedules its own reminders from its local data.
//
// - Android: the Tauri notification plugin schedules alarms that fire with
//   the app closed (exact when allowed, inexact otherwise), survive reboots,
//   and report taps through onAction.
// - Desktop (Tauri) and the web: timers while the app or tab is open; the
//   notification is shown by the plugin (desktop) or the Notification API.
import type { Habit, Task } from "../types";
import { translateStored } from "./i18n";
import { isAndroid, isTauri } from "./platform";
import { getNotificationSettings, notificationId, planNotifications, type PlannedNotification } from "./reminders";

export const NOTIFICATION_OPEN_EVENT = "prior-notification-open";
const SCHEDULED_KEY = "prior.notifications.scheduled.v1";
const CHANNEL_ID = "reminders";

export type PermissionState = "granted" | "denied" | "default" | "unsupported";

type Shown = { id: number; key: string; title: string; body: string; target: string };

function openTarget(target: string): void {
  if (typeof window === "undefined") return;
  try { window.focus(); } catch { /* not focusable */ }
  window.dispatchEvent(new CustomEvent(NOTIFICATION_OPEN_EVENT, { detail: { target } }));
}

function bodyFor(item: Pick<PlannedNotification, "kind">): string {
  return item.kind === "habit" ? translateStored("reminders.notification.habitBody") : translateStored("reminders.notification.taskBody");
}

async function plugin() {
  return import("@tauri-apps/plugin-notification");
}

export async function notificationPermission(): Promise<PermissionState> {
  if (isTauri()) {
    try {
      return (await (await plugin()).isPermissionGranted()) ? "granted" : "default";
    } catch {
      return "unsupported";
    }
  }
  if (typeof Notification === "undefined") return "unsupported";
  return Notification.permission;
}

/** Asks for permission (Android 13+ runtime prompt, browser prompt). */
export async function requestNotificationPermission(): Promise<PermissionState> {
  if (isTauri()) {
    try {
      const api = await plugin();
      if (await api.isPermissionGranted()) return "granted";
      const result = await api.requestPermission();
      return result === "granted" ? "granted" : result === "denied" ? "denied" : "default";
    } catch {
      return "unsupported";
    }
  }
  if (typeof Notification === "undefined") return "unsupported";
  if (Notification.permission !== "default") return Notification.permission;
  return Notification.requestPermission();
}

async function showNow(item: Shown): Promise<void> {
  if (isTauri()) {
    const api = await plugin();
    api.sendNotification({ id: item.id, title: item.title, body: item.body, extra: { target: item.target }, autoCancel: true, ...(isAndroid() ? { channelId: CHANNEL_ID } : {}) });
    return;
  }
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
  const notification = new Notification(item.title, { body: item.body, tag: item.key });
  notification.onclick = () => {
    notification.close();
    openTarget(item.target);
  };
}

/** Shows a notification right away, outside the reminder schedule (the Focus timer). */
export async function notifyNow(key: string, title: string, body: string): Promise<void> {
  try {
    await showNow({ id: 2_000_000_001, key, title, body, target: "" });
  } catch {
    // Notifications are optional.
  }
}

function readScheduled(): number[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(SCHEDULED_KEY) ?? "[]") as unknown;
    return Array.isArray(parsed) ? parsed.filter((value): value is number => Number.isInteger(value)) : [];
  } catch {
    return [];
  }
}

function writeScheduled(ids: number[]): void {
  try { localStorage.setItem(SCHEDULED_KEY, JSON.stringify(ids)); } catch { /* storage unavailable */ }
}

class Scheduler {
  private timers = new Map<string, number>();
  private listenerAttached = false;
  private channelReady = false;
  private running: Promise<void> = Promise.resolve();

  /** Reconciles scheduled notifications with the current plan. */
  sync(tasks: readonly Task[], habits: readonly Habit[], now = new Date()): Promise<void> {
    const plan = planNotifications(tasks, habits, getNotificationSettings(), now);
    this.running = this.running.then(() => this.apply(plan)).catch((error) => console.warn("Prior could not schedule reminders:", error));
    return this.running;
  }

  private async apply(plan: PlannedNotification[]): Promise<void> {
    if ((await notificationPermission()) !== "granted") {
      this.clearTimers();
      if (isAndroid()) await this.cancelNative(readScheduled());
      return;
    }
    if (isAndroid()) {
      await this.applyNative(plan);
      return;
    }
    this.applyTimers(plan);
  }

  private async ensureAndroidSetup(): Promise<void> {
    const api = await plugin();
    if (!this.channelReady) {
      this.channelReady = true;
      try {
        await api.createChannel({ id: CHANNEL_ID, name: translateStored("reminders.channel"), importance: api.Importance.High, vibration: true });
      } catch (error) {
        console.warn("Prior could not create the reminder channel:", error);
      }
    }
    if (!this.listenerAttached) {
      this.listenerAttached = true;
      await api.onAction((notification) => {
        const target = notification.extra?.target;
        if (typeof target === "string") openTarget(target);
      });
    }
  }

  private async cancelNative(ids: number[]): Promise<void> {
    if (!ids.length) return;
    try {
      await (await plugin()).cancel(ids);
    } catch (error) {
      console.warn("Prior could not cancel reminders:", error);
    }
    writeScheduled([]);
  }

  private async applyNative(plan: PlannedNotification[]): Promise<void> {
    await this.ensureAndroidSetup();
    const api = await plugin();
    const wanted = new Set(plan.map((item) => item.id));
    const previous = readScheduled();
    // Cancel what is no longer planned (completed, deleted, moved) and
    // re-register the rest: scheduling an existing id replaces it.
    await this.cancelNative(previous.filter((id) => !wanted.has(id)));
    for (const item of plan) {
      api.sendNotification({
        id: item.id,
        title: item.title,
        body: bodyFor(item),
        channelId: CHANNEL_ID,
        autoCancel: true,
        extra: { target: item.target },
        schedule: api.Schedule.at(item.at, false, true),
      });
    }
    writeScheduled(plan.map((item) => item.id));
  }

  private clearTimers(): void {
    for (const timer of this.timers.values()) window.clearTimeout(timer);
    this.timers.clear();
  }

  private applyTimers(plan: PlannedNotification[]): void {
    const wanted = new Map(plan.map((item) => [item.key, item]));
    for (const [key, timer] of this.timers) {
      if (!wanted.has(key)) {
        window.clearTimeout(timer);
        this.timers.delete(key);
      }
    }
    for (const item of plan) {
      if (this.timers.has(item.key)) continue;
      const delay = Math.max(0, item.at.getTime() - Date.now());
      const timer = window.setTimeout(() => {
        this.timers.delete(item.key);
        void showNow({ id: item.id, key: item.key, title: item.title, body: bodyFor(item), target: item.target }).catch(() => undefined);
      }, delay);
      this.timers.set(item.key, timer);
    }
  }

  /** Immediate notification (mentions, the settings test button). */
  async notifyNow(input: { key: string; title: string; body: string; target: string }): Promise<boolean> {
    const settings = getNotificationSettings();
    if (!settings.enabled || (await notificationPermission()) !== "granted") return false;
    if (isAndroid()) await this.ensureAndroidSetup();
    await showNow({ ...input, id: notificationId(input.key) });
    return true;
  }

  /** Test hook. */
  pendingKeys(): string[] {
    return [...this.timers.keys()];
  }
}

export const notificationScheduler = new Scheduler();

/** Sends a test notification, asking for permission first if needed. */
export async function sendTestNotification(): Promise<PermissionState> {
  const permission = await requestNotificationPermission();
  if (permission !== "granted") return permission;
  await showNow({ id: notificationId(`test:${Date.now()}`), key: "test", title: translateStored("reminders.test.title"), body: translateStored("reminders.test.body"), target: "prior://task/" });
  return permission;
}
