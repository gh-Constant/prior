-- Gmail connections for the mail inbox. One refresh token per (user,
-- google account): Google issues a single durable offline token per grant,
-- so reconnecting the same Gmail address replaces the stored token.
-- The refresh token is sealed with AES-256-GCM when SETTINGS_ENCRYPTION_KEY
-- is configured, readable only by the owning user, and never logged.
CREATE TABLE IF NOT EXISTS mail_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider TEXT NOT NULL DEFAULT 'gmail',
    email TEXT NOT NULL,
    refresh_token TEXT NOT NULL DEFAULT '',
    scopes TEXT NOT NULL DEFAULT '',
    connected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, provider, email)
);

CREATE INDEX IF NOT EXISTS mail_accounts_user_idx ON mail_accounts(user_id, provider);
