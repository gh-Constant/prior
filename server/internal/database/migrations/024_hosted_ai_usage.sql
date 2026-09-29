-- Per-user, per-day Prior AI usage so plan quotas (agent tokens) survive
-- restarts and can be reported in the admin dashboard.
CREATE TABLE IF NOT EXISTS hosted_ai_usage (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    day DATE NOT NULL,
    purpose TEXT NOT NULL,
    requests INTEGER NOT NULL DEFAULT 0,
    tokens BIGINT NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, day, purpose)
);
