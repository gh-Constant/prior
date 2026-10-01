# Recurring tasks

A task can repeat. Completing it creates the next occurrence; the completed task stays as history and no longer repeats. Habits (one check-in per day, with their own schedule) are a separate concept and are not merged with this.

## Data

`Task.recurrence?: TaskRecurrence | null`:

| Field | Meaning |
| --- | --- |
| `interval` | Repeat every N units, 1–365. |
| `unit` | `day`, `week`, `month` or `year`. |
| `daysOfWeek` | Weekly rules only: JS weekdays, 0 = Sunday. Empty or absent means the due date's weekday. |
| `basis` | `completion` counts the next date from the day the task is completed (Todoist "every!"). Absent means `due`: count from the due date (Todoist "every"). |
| `until` | Last allowed occurrence (`YYYY-MM-DD`, inclusive), or none. |

The canonical form omits `daysOfWeek` for non-weekly rules, `basis` when it is `due`, and `until` when it is not a real date. A missing or invalid value normalizes to `null` (`normalizeRecurrence`).

It is kept in sync across every layer like the other optional task fields:

- `app/src/types.ts` (`TaskRecurrence`, `Task`, `TaskDraft`), `app/src/lib/localStore.ts` (localStorage as an object; SQLite column `recurrence TEXT`, JSON, NULL when none; migration `013_task_recurrence.sql`, registered in `src-tauri/src/lib.rs`).
- PostgreSQL migration `033_task_recurrence.sql`: `recurrence JSONB`, NULL when none, on `tasks` and `task_changes` (so pull and the change log carry it). Go: `tasks.Task.Recurrence`, validated by `tasks.NormalizeRecurrence` in `validateTask`.
- Older clients that do not send the field keep the stored rule (`FieldPresent("recurrence")`, `resolveIssueFieldsTx`), exactly like `relations`. An explicit `null` clears it.
- MCP: `create_task` and `update_task` take `recurrence` (`interval`, `unit`, `days_of_week`, `basis`, `until`; `null` clears), the assistant's `create_task`/`update_task` take it too (shown on the review card), and the data export lists it (`tasks.json` as an object, `tasks.csv` as a short sentence).

## Next date

`nextDueDate(rule, { dueDate, completedOn, today })` in `app/src/lib/recurrence.ts`, mirrored by `tasks.NextDueDate` in `server/internal/tasks/recurrence.go`. Both are tested against the same vectors.

- The base is the due date (today when the task has none) for `due`, and the completion day for `completion`.
- `day`: add `interval` days. `week` without days: add `7 * interval` days. `week` with days: the next listed weekday later in the same week (weeks run Monday to Sunday), otherwise the first listed weekday `interval` weeks later. `month` and `year`: add `interval` months or years.
- Month-end handling: the day of the month is clamped to the month length but remembered while the algorithm loops over missed occurrences (Jan 31 gives Feb 28, then Mar 31 when skipping). Nothing remembers the original day between two completions, so a series started on the 31st that is completed on time becomes Jan 31, Feb 28, Mar 28. This is a deliberate simplification (no extra stored field). Feb 29 yearly rules behave the same way (Feb 28 in common years).
- `due` rules skip occurrences already in the past, so the next one is today or later (Todoist behaviour).
- When the result is after `until`, there is no next occurrence and the series ends.

## Completing

`buildNextOccurrence(task, now, previous)` copies the completed task into a new open one: new id; same title, description, priority, importance, urgency, area, project, assignee, parent, milestone, people, estimate, relations and rule; status `next` when the completed task was in progress, waiting or done (otherwise the previous status, so an inbox task stays in the inbox); due date from `nextDueDate`, due time kept; `scheduledDate` and `reminderAt` shifted by the same number of days as the due date (local time of day kept); follow-up and waiting-on cleared; checklist copied with new ids, unchecked.

The client path is `updateTaskAndRepeat` (`app/src/lib/recurringTasks.ts`), used by `changeTask` (rows, board drops, matrix, detail panel, Today and Waiting), by the composer when it sets the status to done, and by assistant review cards. It saves the next occurrence first, then the completed task with `recurrence: null`, then App shows a toast "Next: <date>". Reopening a task, or saving an already-completed one, never creates anything. Because the completed task carries no rule, another device that pulls it cannot create a duplicate. Quick-add, the Android widget and mail-to-task only create tasks.

The MCP server does the same when an update or `complete_task` completes a repeating task (`saveTaskCompletion`), through `Store.Push`, and returns `{task, nextOccurrence}`. The server uses the UTC date as "today" and shifts reminders by 24-hour days, because it does not know the user's time zone.

## UI

- `RecurrencePicker` (composer and detail panel, next to the due date and the reminder): Doesn't repeat, Every day, Every weekday (Mon–Fri), Every week on the due date's weekday, Every month on the due date's day, Every year on the due date, and Custom, an inline editor with interval, unit, weekday toggles (weekly), "Repeat from completion date" and an end date. Choosing a rule on a task without a due date sets the due date to today. On phones the editor is part of the task bottom sheet, with 44px targets and 16px inputs.
- `RecurrenceChip` (repeat glyph and a short summary such as "Daily" or "Every 2 weeks") on task rows, board cards and the assistant's cards. `describeRecurrence` produces the wording ("Every 2 weeks on Mon, Thu", "Every month on the 15th", ", from completion", ", until …").
- Quick add (composer title, Today quick-add): `every day`, `every weekday`, `every week`, `every month`, `every year`, `every 2 weeks`, `every other day`, `every monday` (lists: `every mon, wed and fri`), and `every!` for "from completion"; French `tous les jours`, `chaque jour`, `toutes les semaines`, `tous les 2 jours`, `tous les mois`, `chaque année`, `chaque lundi`, `tous les lundis et jeudis`, and `en semaine` only after `tous les jours` / `chaque jour`. The phrase is removed from the title; with no date in the line, the first due date is today (or the next listed weekday).
- Strings live in the `recurrence` i18n namespace (en, fr, es, de, pt).
