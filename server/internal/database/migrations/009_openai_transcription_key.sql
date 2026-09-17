-- Store each user's OpenAI transcription key alongside the existing
-- encrypted assistant settings. The HTTP layer seals the value before it is
-- written when SETTINGS_ENCRYPTION_KEY is configured.
ALTER TABLE user_settings
    ADD COLUMN IF NOT EXISTS openai_api_key TEXT NOT NULL DEFAULT '';
