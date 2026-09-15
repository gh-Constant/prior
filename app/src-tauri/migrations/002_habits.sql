-- Rebuild the outbox so queued v0.2.0 tasks survive while mutations gain an entity discriminator.
CREATE TABLE IF NOT EXISTS outbox (
  id TEXT PRIMARY KEY NOT NULL,
  kind TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS outbox_with_entity (
  id TEXT PRIMARY KEY NOT NULL,
  entity TEXT NOT NULL DEFAULT 'task',
  kind TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL
);
INSERT OR IGNORE INTO outbox_with_entity (id, entity, kind, payload, created_at)
  SELECT id, 'task', kind, payload, created_at FROM outbox;
DROP TABLE outbox;
ALTER TABLE outbox_with_entity RENAME TO outbox;

CREATE TABLE IF NOT EXISTS habits (
  id TEXT PRIMARY KEY NOT NULL,
  title TEXT NOT NULL,
  important INTEGER NOT NULL DEFAULT 0,
  urgent INTEGER NOT NULL DEFAULT 0,
  interval INTEGER NOT NULL DEFAULT 1,
  unit TEXT NOT NULL DEFAULT 'day',
  start_date TEXT NOT NULL,
  completed_dates TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  server_revision INTEGER
);

CREATE INDEX IF NOT EXISTS habits_updated_idx ON habits(updated_at DESC);
