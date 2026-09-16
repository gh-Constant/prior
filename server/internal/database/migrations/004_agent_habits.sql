ALTER TABLE agent_chat_messages
    ADD COLUMN IF NOT EXISTS proposed_habits JSONB NOT NULL DEFAULT '[]'::jsonb;
