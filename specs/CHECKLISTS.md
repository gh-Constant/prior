# Task checklists

A task has an ordered checklist of up to 100 items `{id, title, done, position}` (`ChecklistItem` in `app/src/types.ts`, `tasks.ChecklistItem` in Go).

- Storage: JSONB `checklist` on `tasks` and `task_changes` (PostgreSQL migration 029), JSON text in SQLite (migration 011), the array in localStorage. Old data without the field normalizes to an empty checklist. The server (`NormalizeChecklist`) and the client (`normalizeChecklist`) both validate ids (unique, 1–64 characters) and titles (1–400 characters), drop invalid items on the client, and renumber positions 0..n-1.
- Sync: the checklist is part of the task snapshot, so it travels through `Store.Push`, the change log and pull like every other field. A checklist change is an ordinary task update: last write wins for the whole checklist.
- XP: checking an item earns nothing (anti-farming, `GAMIFICATION.md`); only completing the task does. `TestChecklistAndReminderSyncWithoutXPPostgres` pins it.
- UI: `ChecklistEditor` in the task detail panel and in the composer. Enter adds the next item, Backspace on an empty item deletes it, Alt+↑/↓ or dragging the handle reorders (with a live-region announcement), arrow keys move between items. Titles are saved on blur so typing does not create one sync write per key. Task rows show a "3/5" chip (`ChecklistProgressChip`).
- MCP: `create_task` and `update_task` take `checklist: [{id?, title, done?}]` (replaces the whole list; keep ids to keep items).
- Assistant: `create_task` takes `checklist: ["…"]`; `update_task` takes `changes.checklist: [{title, done}]` and keeps the ids of items whose title matches. Review cards list the new checklist or show "Checklist: done/total".
- Export: the `checklist` column of `tasks.csv` reads `[x] done; [ ] open`.
