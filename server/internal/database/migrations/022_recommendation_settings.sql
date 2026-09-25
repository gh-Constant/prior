ALTER TABLE user_settings
    ADD COLUMN IF NOT EXISTS recommendation_openrouter_api_key TEXT NOT NULL DEFAULT '';
