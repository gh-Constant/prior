-- Several assignees per task (specs/AGILE_COLLABORATION.md, "Several
-- assignees"). assignee_ids is the ordered list of project member ids (a JSON
-- array of UUID strings, at most 10); the legacy assignee_id column keeps the
-- FIRST assignee so older clients, which only know one, keep working. The
-- server validates every id as a member of the task's project and removes a
-- deleted account from the lists (store.DeleteAccount).
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS assignee_ids JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE task_changes ADD COLUMN IF NOT EXISTS assignee_ids JSONB NOT NULL DEFAULT '[]'::jsonb;

UPDATE tasks SET assignee_ids = jsonb_build_array(assignee_id::text)
WHERE assignee_id IS NOT NULL AND assignee_ids = '[]'::jsonb;
UPDATE task_changes SET assignee_ids = jsonb_build_array(assignee_id::text)
WHERE assignee_id IS NOT NULL AND assignee_ids = '[]'::jsonb;
