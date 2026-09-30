-- Account security and compliance (specs/AUTH.md, specs/ACCOUNT.md):
-- email verification, password reset, two-factor authentication and the
-- language used for account emails.

ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ;
-- Google accounts are verified by Google. Password accounts start
-- unverified until they open the link sent at registration.
UPDATE users SET email_verified_at = COALESCE(last_login_at, created_at, now())
WHERE email_verified_at IS NULL AND google_sub IS NOT NULL AND email_verified;

-- Language for account emails (en, fr, de, es, pt), taken from the client.
ALTER TABLE users ADD COLUMN IF NOT EXISTS locale TEXT NOT NULL DEFAULT 'en';

-- TOTP (RFC 6238). The secret is sealed with TOTP_ENCRYPTION_KEY
-- (AES-256-GCM). A pending secret waits for its first code before 2FA is on.
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_secret TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_pending_secret TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_enabled_at TIMESTAMPTZ;
-- Last accepted 30-second step: a code can never be used twice.
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_last_step BIGINT NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_failed_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_locked_until TIMESTAMPTZ;

-- Single-use recovery codes, only their SHA-256 hash is stored.
CREATE TABLE IF NOT EXISTS totp_recovery_codes (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    code_hash BYTEA NOT NULL,
    used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, code_hash)
);

-- One-use emailed tokens (password reset: 30 minutes, email verification:
-- 24 hours). Only the SHA-256 hash is stored.
CREATE TABLE IF NOT EXISTS auth_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    purpose TEXT NOT NULL CHECK (purpose IN ('password_reset', 'email_verify')),
    token_hash BYTEA NOT NULL UNIQUE,
    -- The address the token was sent to: a verification link only verifies
    -- the address it was sent to, even if the account email changed since.
    email TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS auth_tokens_user_idx ON auth_tokens(user_id, purpose, created_at DESC);

-- Short-lived sign-in challenges when 2FA is on: password and Google sign-in
-- return one of these instead of a session.
CREATE TABLE IF NOT EXISTS auth_challenges (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash BYTEA NOT NULL UNIQUE,
    device_name TEXT NOT NULL DEFAULT '',
    platform TEXT NOT NULL DEFAULT '',
    attempts INTEGER NOT NULL DEFAULT 0,
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS auth_challenges_user_idx ON auth_challenges(user_id);
