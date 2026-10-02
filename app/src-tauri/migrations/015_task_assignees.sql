-- Several assignees per task: an ordered JSON array of user ids. assignee_id keeps the first one
-- (older clients know only one). Existing single assignees become one-element lists.
ALTER TABLE tasks ADD COLUMN assignee_ids TEXT NOT NULL DEFAULT '[]';
UPDATE tasks SET assignee_ids = json_array(assignee_id) WHERE assignee_id IS NOT NULL AND assignee_id <> '';
