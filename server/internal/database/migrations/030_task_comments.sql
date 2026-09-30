-- Comments on tasks of shared projects (specs/COMMENTS.md).
CREATE TABLE IF NOT EXISTS task_comments (
    id UUID PRIMARY KEY,
    task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    -- NULL once the author deleted their account: the thread keeps the
    -- comment and shows "Deleted user".
    author_id UUID REFERENCES users(id) ON DELETE SET NULL,
    body TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 4000),
    -- User ids mentioned with @, validated as project members.
    mentions JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    edited_at TIMESTAMPTZ,
    deleted_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS task_comments_task_idx ON task_comments(task_id, created_at);
CREATE INDEX IF NOT EXISTS task_comments_author_idx ON task_comments(author_id);

-- In-app mention notifications (unread count, mark as read).
CREATE TABLE IF NOT EXISTS comment_mentions (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    comment_id UUID NOT NULL REFERENCES task_comments(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    read_at TIMESTAMPTZ,
    PRIMARY KEY (user_id, comment_id)
);
CREATE INDEX IF NOT EXISTS comment_mentions_unread_idx ON comment_mentions(user_id, created_at DESC) WHERE read_at IS NULL;
