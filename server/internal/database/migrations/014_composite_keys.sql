-- Composite per-user keys. Global UUID PKs are kept for FK stability; the
-- UNIQUE(user_id, id) indexes enforce per-user identity and allow
-- ON CONFLICT (user_id, id) upserts. Ownership is then enforced by the
-- conflict target instead of a post-hoc WHERE clause.
CREATE UNIQUE INDEX IF NOT EXISTS tasks_user_id_idx ON tasks(user_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS habits_user_id_idx ON habits(user_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS areas_user_id_idx ON areas(user_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS projects_user_id_idx ON projects(user_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS note_folders_user_id_idx ON note_folders(user_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS notes_user_id_idx ON notes(user_id, id);
