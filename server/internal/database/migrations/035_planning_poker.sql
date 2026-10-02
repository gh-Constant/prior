-- Planning Poker (specs/SCRUM.md): a facilitator walks a list of a shared
-- project's tasks; members vote with cards and the facilitator records the
-- agreed story points on the task. One active session per project.
CREATE TABLE IF NOT EXISTS poker_sessions (
    id UUID PRIMARY KEY,
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    facilitator_id UUID REFERENCES users(id) ON DELETE SET NULL,
    deck TEXT NOT NULL CHECK (deck IN ('fibonacci', 'modified', 'tshirt')),
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'closed')),
    current_index INT NOT NULL DEFAULT 0,
    round INT NOT NULL DEFAULT 1,
    revealed BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    closed_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS poker_one_active ON poker_sessions(project_id) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS poker_sessions_facilitator_idx ON poker_sessions(facilitator_id);

CREATE TABLE IF NOT EXISTS poker_items (
    session_id UUID NOT NULL REFERENCES poker_sessions(id) ON DELETE CASCADE,
    task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    position INT NOT NULL,
    final_points DOUBLE PRECISION,
    decided_by UUID REFERENCES users(id) ON DELETE SET NULL,
    decided_at TIMESTAMPTZ,
    PRIMARY KEY (session_id, task_id)
);
CREATE INDEX IF NOT EXISTS poker_items_task_idx ON poker_items(task_id);
CREATE INDEX IF NOT EXISTS poker_items_decided_by_idx ON poker_items(decided_by);

CREATE TABLE IF NOT EXISTS poker_votes (
    session_id UUID NOT NULL,
    task_id UUID NOT NULL,
    round INT NOT NULL,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    value TEXT NOT NULL CHECK (char_length(value) BETWEEN 1 AND 8),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (session_id, task_id, round, user_id),
    FOREIGN KEY (session_id, task_id) REFERENCES poker_items(session_id, task_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS poker_votes_user_idx ON poker_votes(user_id);
