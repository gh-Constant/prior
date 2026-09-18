-- Project planning is intentionally kept as JSON metadata so cycles can carry
-- issue IDs without expanding the task schema. ACL-protected collaboration
-- updates and workspace sync both validate this document before saving it.
ALTER TABLE projects
    ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE projects
    DROP CONSTRAINT IF EXISTS projects_metadata_object_check;

ALTER TABLE projects
    ADD CONSTRAINT projects_metadata_object_check CHECK (jsonb_typeof(metadata) = 'object');
