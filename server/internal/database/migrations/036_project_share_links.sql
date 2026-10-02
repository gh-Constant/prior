-- Reusable share links (specs/AGILE_COLLABORATION.md, "Share links"): the
-- project owner creates an editor or viewer link that is not tied to an email;
-- anyone with an account who opens it and confirms joins with that role.
-- Only a hash of the token is stored, like project_invites. Creating a link
-- for a role again rotates it, so at most one link per role is active.
CREATE TABLE IF NOT EXISTS project_share_links (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    created_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('editor', 'viewer')),
    token_hash BYTEA NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ,
    use_count INTEGER NOT NULL DEFAULT 0 CHECK (use_count >= 0),
    max_uses INTEGER CHECK (max_uses IS NULL OR max_uses > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS project_share_links_active_role
    ON project_share_links(project_id, role) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS project_share_links_created_by_idx ON project_share_links(created_by);
