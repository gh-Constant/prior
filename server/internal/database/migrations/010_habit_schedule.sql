ALTER TABLE habits
    ADD COLUMN IF NOT EXISTS end_date TEXT;

ALTER TABLE habits
    ADD COLUMN IF NOT EXISTS days_of_week JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE habit_changes
    ADD COLUMN IF NOT EXISTS end_date TEXT;

ALTER TABLE habit_changes
    ADD COLUMN IF NOT EXISTS days_of_week JSONB NOT NULL DEFAULT '[]'::jsonb;
