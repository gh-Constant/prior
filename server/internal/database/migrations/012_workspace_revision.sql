-- Unified revision plane for workspace collections.
-- Each workspace row carries a revision from workspace_revision_seq so Pull can
-- report a single workspaceRevision watermark alongside tasks/habits/profile.
CREATE SEQUENCE IF NOT EXISTS workspace_revision_seq AS BIGINT START WITH 1;

ALTER TABLE areas ADD COLUMN IF NOT EXISTS revision BIGINT NOT NULL DEFAULT nextval('workspace_revision_seq');
ALTER TABLE projects ADD COLUMN IF NOT EXISTS revision BIGINT NOT NULL DEFAULT nextval('workspace_revision_seq');
ALTER TABLE note_folders ADD COLUMN IF NOT EXISTS revision BIGINT NOT NULL DEFAULT nextval('workspace_revision_seq');
ALTER TABLE notes ADD COLUMN IF NOT EXISTS revision BIGINT NOT NULL DEFAULT nextval('workspace_revision_seq');

CREATE INDEX IF NOT EXISTS areas_user_revision_idx ON areas(user_id, revision);
CREATE INDEX IF NOT EXISTS projects_user_revision_idx ON projects(user_id, revision);
CREATE INDEX IF NOT EXISTS note_folders_user_revision_idx ON note_folders(user_id, revision);
CREATE INDEX IF NOT EXISTS notes_user_revision_idx ON notes(user_id, revision);
