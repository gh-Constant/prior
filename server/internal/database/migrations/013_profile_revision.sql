-- Unified revision plane for user profile.
-- profile_revision shares server_revision_seq with tasks/habits so Pull can
-- order profile changes on the same timeline. display_name_updated_at lets
-- OAuth logins preserve a newer user-chosen display name.
ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_revision BIGINT NOT NULL DEFAULT nextval('server_revision_seq');
ALTER TABLE users ADD COLUMN IF NOT EXISTS display_name_updated_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS users_profile_revision_idx ON users(profile_revision);
