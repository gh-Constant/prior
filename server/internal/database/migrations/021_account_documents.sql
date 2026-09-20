CREATE TABLE IF NOT EXISTS account_documents (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    key TEXT NOT NULL,
    value JSONB,
    PRIMARY KEY (user_id, key)
);

-- Retain acknowledgements and tombstones: retrying offline writes is idempotent.
CREATE TABLE IF NOT EXISTS account_document_mutations (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    id UUID NOT NULL,
    PRIMARY KEY (user_id, id)
);

CREATE TABLE IF NOT EXISTS note_attachments (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    id UUID NOT NULL,
    name TEXT NOT NULL,
    content_type TEXT NOT NULL,
    content BYTEA NOT NULL,
    PRIMARY KEY (user_id, id)
);
