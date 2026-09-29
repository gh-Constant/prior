-- Persist proposed edits to existing tasks (the assistant's update_task
-- review cards) alongside the other proposal kinds.
ALTER TABLE agent_chat_messages
    ADD COLUMN IF NOT EXISTS proposed_task_updates JSONB NOT NULL DEFAULT '[]'::jsonb;
