-- Project-scoped collaboration. Existing projects remain private until the
-- owner explicitly adds a member; the legacy user_id remains the owner.
CREATE TABLE IF NOT EXISTS project_members (
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'editor' CHECK (role IN ('owner', 'editor', 'viewer')),
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (project_id, user_id)
);

CREATE INDEX IF NOT EXISTS project_members_user_idx ON project_members(user_id, status, project_id);

CREATE TABLE IF NOT EXISTS project_invites (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    inviter_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    invitee_email TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'editor' CHECK (role IN ('editor', 'viewer')),
    token_hash BYTEA NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    accepted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS project_invites_project_idx ON project_invites(project_id, accepted_at, expires_at);
CREATE INDEX IF NOT EXISTS project_invites_email_idx ON project_invites(invitee_email, accepted_at, expires_at);

CREATE TABLE IF NOT EXISTS task_people (
    task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'participant' CHECK (role IN ('owner', 'participant')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (task_id, user_id)
);

CREATE INDEX IF NOT EXISTS task_people_user_idx ON task_people(user_id, task_id);

ALTER TABLE tasks
    ADD COLUMN IF NOT EXISTS people_ids JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE task_changes
    ADD COLUMN IF NOT EXISTS people_ids JSONB NOT NULL DEFAULT '[]'::jsonb;
