# Reminders and local notifications

Prior has no push server: every device schedules its own notifications from its local data.

## Data

- Tasks: optional `reminderAt`, an absolute instant (RFC 3339). The server stores it normalized to UTC (`tasks.reminder_at`, `task_changes.reminder_at`, migration `029_task_reminders_checklists.sql`); SQLite migration `011_task_reminders_checklists.sql`; localStorage copies carry it as-is. Old data without the field normalizes to no reminder (`normalizeReminder`).
- Habits: the existing `timeOfDay` (HH:mm). A habit is reminded on each scheduled day (`habitOccurrenceDates`) at that local time, unless the day is already checked in.
- The field travels through the normal sync path (`Store.Push`, change log, pull), the MCP tools (`reminder_at`), the assistant's `create_task`/`update_task` (`reminderAt`, shown on review cards) and the data export (`tasks.csv`).

## Setting a reminder

`ReminderPicker` (task detail panel and composer) offers presets computed by `reminderPresets`: at due time (09:00 when the task has a date but no time), 10 minutes before, 1 hour before, the morning of (09:00, when the task is due later that day), in 1 hour, tomorrow morning, and a custom `datetime-local`. Past presets are hidden. Setting the first reminder asks for notification permission.

## Scheduling

`app/src/lib/reminders.ts` is pure: `planNotifications(tasks, habits, settings, now)` returns the notifications of the next 7 days, at most 64, soonest first. Completed and deleted tasks are skipped; reminders inside quiet hours move to their end. Each notification has a stable 31-bit id (FNV-1a of `task:<id>:<reminderAt>` or `habit:<id>:<day>`), so a moved reminder gets a new id and the old one is cancelled.

`app/src/lib/notificationScheduler.ts` applies the plan. `App` calls `notificationScheduler.sync(tasks, habits)` whenever the task or habit state changes, which covers every local change and every sync, plus when the settings change or the app becomes visible again.

| Platform | How |
| --- | --- |
| Android | `tauri-plugin-notification` schedules alarms (`Schedule.at`, allowWhileIdle) that fire with the app closed and survive reboots. The plugin uses exact alarms when `canScheduleExactAlarms()` allows it and falls back to inexact `setAndAllowWhileIdle` otherwise; the manifest declares the optional `SCHEDULE_EXACT_ALARM`. `POST_NOTIFICATIONS` is requested at runtime on Android 13+. A "Reminders" channel (high importance) is created once. Previously scheduled ids are kept in `prior.notifications.scheduled.v1` and cancelled when they leave the plan. |
| Desktop | Timers while Prior runs (also hidden in the tray/background); the plugin shows the notification when it fires. The plugin does not schedule on desktop. |
| Web | Timers while the tab is open, shown with the Notification API. |

Tapping a notification opens its target: `prior://task/<id>` opens the task, `prior://habit/<id>` the Habits view. Android reports taps through the plugin's `onAction`; the web through `notification.onclick`. The same URLs are handled by the deep-link handler (Android intent filters for the `task`, `habit` and `new-task` hosts).

## Settings

Settings → Notifications (`NotificationSettings`), stored per device in `prior.notifications.v1` because permissions are per device: a global switch, habit reminders, quiet hours (a window that may wrap past midnight) and a "Send a test" button.

`notificationScheduler.notifyNow` shows an immediate notification (used by mentions in comments).
