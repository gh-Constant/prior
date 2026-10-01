-- Recurring tasks (specs/RECURRING_TASKS.md): a JSON repeat rule
-- {interval, unit, daysOfWeek?, basis?, until?}, NULL when the task does not
-- repeat. Older clients that do not send the field keep the stored value
-- (see tasks.Task.FieldPresent).
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS recurrence JSONB;
ALTER TABLE task_changes ADD COLUMN IF NOT EXISTS recurrence JSONB;
