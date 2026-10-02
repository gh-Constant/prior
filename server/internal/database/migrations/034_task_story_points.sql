-- Story points (specs/SCRUM.md): the size of a task for agile projects, a
-- multiple of 0.5 between 0 and 999, NULL when not estimated. Older clients
-- that do not send the field keep the stored value (see tasks.Task.FieldPresent).
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS story_points DOUBLE PRECISION;
ALTER TABLE task_changes ADD COLUMN IF NOT EXISTS story_points DOUBLE PRECISION;
