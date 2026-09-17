CREATE TABLE IF NOT EXISTS areas (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 400),
    color TEXT NOT NULL DEFAULT '',
    icon TEXT,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    deleted_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS projects (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    area_id UUID,
    name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 400),
    description TEXT NOT NULL DEFAULT '',
    icon TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    deleted_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS note_folders (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 400),
    parent_id UUID,
    color TEXT,
    workspace_kind TEXT,
    workspace_id UUID,
    icon TEXT,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    deleted_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS notes (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 400),
    body TEXT NOT NULL DEFAULT '',
    folder_id UUID,
    project_id UUID,
    favorite BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS areas_user_updated_idx ON areas(user_id, updated_at);
CREATE INDEX IF NOT EXISTS projects_user_updated_idx ON projects(user_id, updated_at);
CREATE INDEX IF NOT EXISTS note_folders_user_updated_idx ON note_folders(user_id, updated_at);
CREATE INDEX IF NOT EXISTS notes_user_updated_idx ON notes(user_id, updated_at);
