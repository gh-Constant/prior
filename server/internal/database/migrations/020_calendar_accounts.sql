-- Google Calendar connections. Refresh tokens are sealed with
-- SETTINGS_ENCRYPTION_KEY before they are stored and are never returned to
-- the client.
CREATE TABLE IF NOT EXISTS calendar_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider TEXT NOT NULL DEFAULT 'google',
    email TEXT NOT NULL,
    refresh_token TEXT NOT NULL DEFAULT '',
    scopes TEXT NOT NULL DEFAULT '',
    connected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, provider, email)
);

CREATE INDEX IF NOT EXISTS calendar_accounts_user_idx ON calendar_accounts(user_id, provider);
