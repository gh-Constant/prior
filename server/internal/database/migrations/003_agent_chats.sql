CREATE TABLE IF NOT EXISTS agent_chats (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL DEFAULT 'New chat' CHECK (char_length(title) BETWEEN 1 AND 160),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS agent_chats_user_updated_idx ON agent_chats(user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS agent_chat_messages (
    id UUID PRIMARY KEY,
    chat_id UUID NOT NULL REFERENCES agent_chats(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
    content TEXT NOT NULL CHECK (char_length(content) BETWEEN 1 AND 20000),
    proposed_tasks JSONB NOT NULL DEFAULT '[]'::jsonb,
    actual_model TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS agent_chat_messages_chat_created_idx ON agent_chat_messages(chat_id, created_at ASC);
