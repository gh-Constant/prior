# Automatic time blocking

Prior blocks time in the calendar for the user's open tasks, in their free working hours, and moves the blocks forward when plans change.

## References and product choices

Research of 1 October 2026 on the tools that do this well:

- **Motion**: places every task by priority and deadline, re-plans continuously, warns when a deadline cannot be met. Retained: continuous re-planning, deadline warnings, task splitting.
- **Reclaim**: protects focus time, respects working hours and buffers around meetings, keeps habits. Retained: working hours, buffers, lunch, a daily cap on planned time.
- **SkedPal / Akiflow / Sunsama**: chunks long work into blocks of a min/max length; "time map" of when kinds of work happen; a calm daily plan the user can lock. Retained: min/max block length, a peak window for deep work, locking a block.
- Scheduling literature: greedy list scheduling with a weighted cost is the standard answer for interactive planners (optimal methods are too slow and too unstable for a plan the user sees change); earliest-deadline-first pressure, best-fit packing (short tasks fill small gaps so long gaps stay whole) and a repair pass for missed deadlines fix the known weaknesses of plain greedy.

Prior never moves calendar events and never writes to tasks on its own: the plan is derived state. The user locks a block to make it real.

## Engine (`app/src/lib/timeBlocking.ts`)

Pure and deterministic, tested in `timeBlocking.test.ts`.

1. **Candidates**: open tasks that are not waiting or done, not parents of open sub-tasks, and, for inbox items, with a date, priority 1–2 or importance; backlog items need a date.
2. **Estimate**: the user's `estimatedMinutes`, else Prior AI's (Jev), else a local guess (keywords in five languages, checklist size, description length, `defaultMinutes`). The share of checked checklist items shrinks it. Effort is deep or light.
3. **Order**: weight (priority 8/5/3/1.5, important +3, urgent +2, in progress +2.5, next +1, AI importance only when the user set nothing) × deadline pressure (overdue 6, today 6, tomorrow 3.5, falling with distance; planned for today +0.8); deep work ×1.3 so it picks first. Blockers (`relations` `blocked_by`) always come before the tasks they block, and those start after the blocker's last block.
4. **Free time**: working days and hours, from now (rounded to 5 minutes) for today, minus lunch, calendar events ± buffer, habits with a time (45 min), locked all-day events (whole day), and fixed task blocks.
5. **Placement**: each task, in order, takes the cheapest slot for each chunk (max 6 chunks). Cost, roughly in hours of delay: earliness × urgency × weight; +4 + 180/remaining to split (a split leaves at least a min block); crumbs left behind; short tasks prefer small gaps; deep work −3 in the peak window, light work pays to sit there in proportion to the deep work still to place; −8 to keep the previous plan's slot, −2 its day; −12 on the task's scheduled day; +500 past the deadline. The daily cap is respected.
6. **Repair**: tasks that miss a future deadline inside the horizon move to the front and the plan is rebuilt (3 rounds, best plan kept).
7. **Fixed**: a task with `scheduledDate` + `scheduledTime` in the future is a fixed block of its estimated length. The block in progress (from the previous plan) stays where it is until it ends. A task scheduled on a later date without time is not planned before that day and prefers it.

Result: blocks (date, start, end, part/parts, fixed, energy, late), issues (`late`, `overdue`, `unscheduled`) and per-day capacity.

## State (`app/src/lib/planning.ts`, `hooks/useTimeBlocking.ts`)

- Settings are the `preferences/planning` account document (synced; the API accepts the key). Defaults: Monday–Friday 9:00–18:00, lunch 12:00–13:00, 10 min buffer, 5 min break, blocks 25–90 min, 6 h per day, 7 days, peak in the morning, 30 min default, AI on.
- Busy time comes from the calendar state (local, ICS and Google caches). A calendar marked "Makes me busy" off (`planningFree`) is ignored.
- The previous plan is kept per account on the device for stability.
- The plan is recomputed when tasks, habits, calendar or settings change, and every 5 minutes, so blocks that were missed move forward.

## Prior AI (Jev)

When the account has Prior AI and the setting is on, the hook sends tasks without a cached estimate (new or edited) to `POST /v1/agent/complete` with `purpose: "planning"`, at most 30 per call, debounced, once per task and content. The API answers only with the decision model (see `AI.md`); failures back off 30 minutes and the local guess stays. Cost: roughly a few hundred input tokens per task, once, at about $0.04 per million: negligible. Accounts without Prior AI get the local guess only.

## Interface

- **Today**: a "Your plan" card lists today's remaining blocks (complete, open, part, deep work, late) with planned/free time and deadline warnings; planned blocks appear hatched in the day timeline.
- **Calendar**: hatched blocks with a sparkle in day, week, month and agenda views; locked blocks are solid with a lock. A block opens a dialog: mark done, open the task, lock this time (`scheduledDate`/`scheduledTime`/`estimatedMinutes`), let Prior choose the time again, not today (planned from the next working day), settings. The rail has an "Automatic planning" switch and settings; a banner lists tasks that may miss their deadline or found no time. Calendar settings have "Makes me busy".
- **Settings → Time blocking**: every setting above; also in ⌘K.

## Not included

Writing blocks to Google Calendar (Prior only reads Google), moving the user's own events, planning tasks assigned to someone else, drag-and-drop of blocks.
