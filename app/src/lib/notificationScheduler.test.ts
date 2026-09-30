import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Task } from "../types";
import { NOTIFICATION_OPEN_EVENT, notificationScheduler } from "./notificationScheduler";
import { saveNotificationSettings, DEFAULT_NOTIFICATION_SETTINGS } from "./reminders";

class FakeNotification {
  static permission: NotificationPermission = "granted";
  static created: FakeNotification[] = [];
  static requestPermission = vi.fn(async () => FakeNotification.permission);
  onclick: (() => void) | null = null;
  constructor(public title: string, public options: NotificationOptions) { FakeNotification.created.push(this); }
  close() {}
}

const base: Task = { id: "t1", title: "Call the bank", description: "", dueDate: null, priority: 4, completed: false, important: false, urgent: false, createdAt: "", updatedAt: "", deletedAt: null };

describe("web notification scheduler", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 30, 8, 0));
    localStorage.clear();
    FakeNotification.created = [];
    FakeNotification.permission = "granted";
    vi.stubGlobal("Notification", FakeNotification);
  });
  afterEach(async () => {
    await notificationScheduler.sync([], []);
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("fires a reminder at its time and opens the task when clicked", async () => {
    await notificationScheduler.sync([{ ...base, reminderAt: new Date(2026, 8, 30, 8, 30).toISOString() }], []);
    expect(notificationScheduler.pendingKeys()).toHaveLength(1);
    vi.advanceTimersByTime(29 * 60_000);
    expect(FakeNotification.created).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(FakeNotification.created.map((item) => item.title)).toEqual(["Call the bank"]);
    const opened = vi.fn();
    window.addEventListener(NOTIFICATION_OPEN_EVENT, opened);
    FakeNotification.created[0].onclick?.();
    expect((opened.mock.calls[0][0] as CustomEvent).detail).toEqual({ target: "prior://task/t1" });
    window.removeEventListener(NOTIFICATION_OPEN_EVENT, opened);
  });

  it("cancels reminders of completed tasks and when notifications are off", async () => {
    const task = { ...base, reminderAt: new Date(2026, 8, 30, 9, 0).toISOString() };
    await notificationScheduler.sync([task], []);
    expect(notificationScheduler.pendingKeys()).toHaveLength(1);
    await notificationScheduler.sync([{ ...task, completed: true }], []);
    expect(notificationScheduler.pendingKeys()).toHaveLength(0);
    await notificationScheduler.sync([task], []);
    saveNotificationSettings({ ...DEFAULT_NOTIFICATION_SETTINGS, enabled: false });
    await notificationScheduler.sync([task], []);
    expect(notificationScheduler.pendingKeys()).toHaveLength(0);
  });

  it("schedules nothing without permission", async () => {
    FakeNotification.permission = "denied";
    await notificationScheduler.sync([{ ...base, reminderAt: new Date(2026, 8, 30, 9, 0).toISOString() }], []);
    expect(notificationScheduler.pendingKeys()).toHaveLength(0);
  });
});
