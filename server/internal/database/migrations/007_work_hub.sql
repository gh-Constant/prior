ALTER TABLE tasks
    ADD COLUMN IF NOT EXISTS area_id UUID,
    ADD COLUMN IF NOT EXISTS project_id UUID,
    ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'inbox',
    ADD COLUMN IF NOT EXISTS scheduled_date DATE,
    ADD COLUMN IF NOT EXISTS assignee_name TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS follow_up_date DATE;

ALTER TABLE task_changes
    ADD COLUMN IF NOT EXISTS area_id UUID,
    ADD COLUMN IF NOT EXISTS project_id UUID,
    ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'inbox',
    ADD COLUMN IF NOT EXISTS scheduled_date DATE,
    ADD COLUMN IF NOT EXISTS assignee_name TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS follow_up_date DATE;

CREATE INDEX IF NOT EXISTS tasks_user_project_idx ON tasks(user_id, project_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS tasks_user_area_idx ON tasks(user_id, area_id) WHERE deleted_at IS NULL;
