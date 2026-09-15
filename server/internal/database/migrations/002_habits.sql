ALTER TABLE applied_mutations ADD COLUMN IF NOT EXISTS entity TEXT NOT NULL DEFAULT 'task';

CREATE TABLE IF NOT EXISTS habits (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 400),
    important BOOLEAN NOT NULL DEFAULT FALSE,
    urgent BOOLEAN NOT NULL DEFAULT FALSE,
    interval INTEGER NOT NULL DEFAULT 1 CHECK (interval BETWEEN 1 AND 365),
    unit TEXT NOT NULL DEFAULT 'day' CHECK (unit IN ('day', 'week', 'month', 'year')),
    start_date TEXT NOT NULL,
    completed_dates JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    deleted_at TIMESTAMPTZ,
    revision BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS habits_user_revision_idx ON habits(user_id, revision);

CREATE TABLE IF NOT EXISTS habit_changes (
    revision BIGINT PRIMARY KEY,
    habit_id UUID NOT NULL,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    important BOOLEAN NOT NULL,
    urgent BOOLEAN NOT NULL,
    interval INTEGER NOT NULL,
    unit TEXT NOT NULL,
    start_date TEXT NOT NULL,
    completed_dates JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS habit_changes_user_revision_idx ON habit_changes(user_id, revision);
