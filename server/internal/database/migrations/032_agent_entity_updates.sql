-- Persist the assistant's proposed changes to existing projects, habits,
-- notes and areas (update_project/update_habit/update_note/update_area).
ALTER TABLE agent_chat_messages
    ADD COLUMN IF NOT EXISTS proposed_updates JSONB NOT NULL DEFAULT '[]'::jsonb;
