ALTER TABLE tasks
    ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS due_date TEXT,
    ADD COLUMN IF NOT EXISTS priority INTEGER NOT NULL DEFAULT 4;

ALTER TABLE task_changes
    ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS due_date TEXT,
    ADD COLUMN IF NOT EXISTS priority INTEGER NOT NULL DEFAULT 4;

ALTER TABLE tasks
    DROP CONSTRAINT IF EXISTS tasks_priority_check;
ALTER TABLE tasks
    ADD CONSTRAINT tasks_priority_check CHECK (priority BETWEEN 1 AND 4);

ALTER TABLE task_changes
    DROP CONSTRAINT IF EXISTS task_changes_priority_check;
ALTER TABLE task_changes
    ADD CONSTRAINT task_changes_priority_check CHECK (priority BETWEEN 1 AND 4);
