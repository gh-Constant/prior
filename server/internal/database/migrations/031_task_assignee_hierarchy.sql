-- Linear-style issue fields (specs/AGILE_COLLABORATION.md):
-- one assignee (a project member), a parent task (sub-issues), a project
-- milestone (defined in the project's metadata, like cycles) and relations
-- ([{type: "blocked_by" | "related", taskId}]). Older clients that do not
-- send these fields keep the stored values (see tasks.Task.FieldPresent).
ALTER TABLE tasks
    ADD COLUMN IF NOT EXISTS assignee_id UUID REFERENCES users(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS parent_id UUID,
    ADD COLUMN IF NOT EXISTS milestone_id TEXT,
    ADD COLUMN IF NOT EXISTS relations JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE task_changes
    ADD COLUMN IF NOT EXISTS assignee_id UUID REFERENCES users(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS parent_id UUID,
    ADD COLUMN IF NOT EXISTS milestone_id TEXT,
    ADD COLUMN IF NOT EXISTS relations JSONB NOT NULL DEFAULT '[]'::jsonb;

CREATE INDEX IF NOT EXISTS tasks_assignee_idx ON tasks(assignee_id) WHERE assignee_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS task_changes_assignee_idx ON task_changes(assignee_id) WHERE assignee_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS tasks_parent_idx ON tasks(parent_id) WHERE parent_id IS NOT NULL;
