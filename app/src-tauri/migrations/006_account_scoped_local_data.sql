-- Local SQLite is an offline cache, but it must still be isolated when the
-- desktop/mobile user signs out and another account signs in on the device.
-- Existing rows are kept under `legacy` and are claimed by the first signed-in
-- account by the frontend after this migration has completed.
ALTER TABLE tasks ADD COLUMN account_id TEXT NOT NULL DEFAULT 'legacy';
ALTER TABLE habits ADD COLUMN account_id TEXT NOT NULL DEFAULT 'legacy';
ALTER TABLE outbox ADD COLUMN account_id TEXT NOT NULL DEFAULT 'legacy';

CREATE INDEX IF NOT EXISTS tasks_account_updated_idx ON tasks(account_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS habits_account_updated_idx ON habits(account_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS outbox_account_created_idx ON outbox(account_id, created_at ASC);

-- sync_state used to be a single global row. Rebuild it so each account has
-- its own server cursor and one account can never skip another account's data.
ALTER TABLE sync_state RENAME TO sync_state_legacy;
CREATE TABLE sync_state (
  account_id TEXT PRIMARY KEY NOT NULL,
  last_server_revision INTEGER NOT NULL DEFAULT 0
);
INSERT INTO sync_state (account_id, last_server_revision)
  SELECT 'legacy', last_server_revision FROM sync_state_legacy WHERE id = 1;
DROP TABLE sync_state_legacy;
