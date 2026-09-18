-- Persist the full AgentMessage envelope so a reload or a second device keeps
-- every proposal kind. Older rows default to empty arrays.
ALTER TABLE agent_chat_messages
    ADD COLUMN IF NOT EXISTS proposed_areas JSONB NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS proposed_projects JSONB NOT NULL DEFAULT '[]'::jsonb;
