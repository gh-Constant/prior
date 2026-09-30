-- Task reminders and checklists (specs/REMINDERS.md, specs/CHECKLISTS.md).
-- reminder_at is an absolute instant (RFC 3339, UTC) or NULL. checklist is
-- an ordered array of {id, title, done, position}, at most 100 items.
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS reminder_at TEXT;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS checklist JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE task_changes ADD COLUMN IF NOT EXISTS reminder_at TEXT;
ALTER TABLE task_changes ADD COLUMN IF NOT EXISTS checklist JSONB NOT NULL DEFAULT '[]'::jsonb;
