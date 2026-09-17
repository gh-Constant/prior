-- Per-user assistant settings (OpenRouter/OpenAI keys, web search). The API keys are
-- stored sealed with AES-256-GCM when SETTINGS_ENCRYPTION_KEY is configured;
-- only the owning user can read it through the authenticated /v1/settings
-- endpoints, and it is never logged.
CREATE TABLE IF NOT EXISTS user_settings (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    openrouter_api_key TEXT NOT NULL DEFAULT '',
    web_search BOOLEAN NOT NULL DEFAULT TRUE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
