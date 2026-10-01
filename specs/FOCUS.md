# Focus (Pomodoro)

The Focus page (`/focus`, `components/focus/FocusView.tsx`) replaces the Pomodoro card that used to sit on Today. It is a full page, like the Eisenhower matrix, built around one round timer and one task.

- Timer state lives in `lib/pomodoro.ts`: phase (`focus`, `break`, `long`), `endsAt` while running or `remainingMs` while paused, the sessions of the current cycle, the durations (`settings`) and a log of finished focus sessions (14 days, at most 200 entries). It is stored per account under `prior.pomodoro` (scoped storage) and is local to the device.
- One timer for the whole app: `pomodoroStore` + `usePomodoro()` (useSyncExternalStore). `PomodoroRunner`, mounted by App, ends phases on time wherever the user is, writes the log, plays a short Web Audio chime, sends a local notification (`notifyNow`) and shows the countdown in the window title. With "chain sessions" on, the next phase starts by itself.
- Rhythm: 25/5 by default with a 15-minute long break every 4 sessions; presets Classic 25/5, Deep work 50/10, Sprint 15/3; every duration can be changed in the settings dialog. Skipping a focus phase does not count it.
- Task: suggestions are Today's cached AI focus picks and the top of the focus ranking (`rankFocusTasks`), then every open task (`pomodoroTaskOptions`). The picker is a searchable modal (a bottom sheet on phones). The current task card can mark the task done (through `App.changeTask`, so recurrence and celebrations apply) or open it.
- Stats: sessions and minutes today, a 7-day bar chart and today's log.
- Keyboard (desktop): Space start/pause, R reset, S skip, F full screen, Escape leaves full screen. Full screen ("zen") covers the window with only the timer and the task title.
- Today keeps a compact card (`FocusMiniCard`) with the live countdown, play/pause and a link to the page; it is hidden when Focus is turned off in the navigation.
