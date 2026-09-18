-- Isolate accounts at the storage layer: two accounts must be able to reuse
-- the same entity id without colliding. Rebuild tasks/habits/outbox with a
-- composite PRIMARY KEY(account_id, id) and preserve existing rows.
--
-- tasks full schema after 001 + 003 + 004 + 006:
--   id, title, completed, important, urgent, created_at, updated_at,
--   deleted_at, server_revision, description, due_date, priority,
--   area_id, project_id, status, scheduled_date, assignee_name,
--   follow_up_date, account_id
CREATE TABLE IF NOT EXISTS tasks_new (
  account_id TEXT NOT NULL,
  id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  due_date TEXT,
  priority INTEGER NOT NULL DEFAULT 4,
  area_id TEXT,
  project_id TEXT,
  status TEXT NOT NULL DEFAULT 'inbox',
  scheduled_date TEXT,
  assignee_name TEXT NOT NULL DEFAULT '',
  follow_up_date TEXT,
  completed INTEGER NOT NULL DEFAULT 0,
  important INTEGER NOT NULL DEFAULT 0,
  urgent INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  server_revision INTEGER,
  PRIMARY KEY (account_id, id)
);
INSERT OR IGNORE INTO tasks_new (account_id, id, title, description, due_date, priority, area_id, project_id, status, scheduled_date, assignee_name, follow_up_date, completed, important, urgent, created_at, updated_at, deleted_at, server_revision)
  SELECT account_id, id, title, description, due_date, priority, area_id, project_id, status, scheduled_date, assignee_name, follow_up_date, completed, important, urgent, created_at, updated_at, deleted_at, server_revision FROM tasks;
DROP TABLE tasks;
ALTER TABLE tasks_new RENAME TO tasks;
CREATE INDEX IF NOT EXISTS tasks_account_updated_idx ON tasks(account_id, updated_at DESC);

-- habits full schema after 002 + 005 + 006:
--   id, title, important, urgent, interval, unit, start_date,
--   completed_dates, created_at, updated_at, deleted_at, server_revision,
--   end_date, days_of_week, account_id, entity (outbox only)
CREATE TABLE IF NOT EXISTS habits_new (
  account_id TEXT NOT NULL,
  id TEXT NOT NULL,
  title TEXT NOT NULL,
  important INTEGER NOT NULL DEFAULT 0,
  urgent INTEGER NOT NULL DEFAULT 0,
  interval INTEGER NOT NULL DEFAULT 1,
  unit TEXT NOT NULL DEFAULT 'day',
  start_date TEXT NOT NULL,
  end_date TEXT,
  days_of_week TEXT NOT NULL DEFAULT '[]',
  completed_dates TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  server_revision INTEGER,
  PRIMARY KEY (account_id, id)
);
INSERT OR IGNORE INTO habits_new (account_id, id, title, important, urgent, interval, unit, start_date, end_date, days_of_week, completed_dates, created_at, updated_at, deleted_at, server_revision)
  SELECT account_id, id, title, important, urgent, interval, unit, start_date, end_date, days_of_week, completed_dates, created_at, updated_at, deleted_at, server_revision FROM habits;
DROP TABLE habits;
ALTER TABLE habits_new RENAME TO habits;
CREATE INDEX IF NOT EXISTS habits_account_updated_idx ON habits(account_id, updated_at DESC);

-- outbox full schema after 001 + 002 + 006:
--   id, entity, kind, payload, created_at, account_id
CREATE TABLE IF NOT EXISTS outbox_new (
  account_id TEXT NOT NULL,
  id TEXT NOT NULL,
  entity TEXT NOT NULL DEFAULT 'task',
  kind TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (account_id, id)
);
INSERT OR IGNORE INTO outbox_new (account_id, id, entity, kind, payload, created_at)
  SELECT account_id, id, entity, kind, payload, created_at FROM outbox;
DROP TABLE outbox;
ALTER TABLE outbox_new RENAME TO outbox;
CREATE INDEX IF NOT EXISTS outbox_account_created_idx ON outbox(account_id, created_at ASC);
