ALTER TABLE agent_chat_messages
    ADD COLUMN IF NOT EXISTS proposed_notes JSONB NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS proposed_folders JSONB NOT NULL DEFAULT '[]'::jsonb;
