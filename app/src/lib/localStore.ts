import type { Mutation, SyncState, Task } from "../types";

const TASKS_KEY = "prior.tasks.v1";
const OUTBOX_KEY = "prior.outbox.v1";
const SYNC_KEY = "prior.sync.v1";

type SqlDatabase = {
  select<T>(query: string, bindValues?: unknown[]): Promise<T[]>;
  execute(query: string, bindValues?: unknown[]): Promise<{ rowsAffected: number }>;
};

let sqlDatabase: SqlDatabase | null = null;

function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

async function getSqlDatabase(): Promise<SqlDatabase | null> {
  if (!isTauri()) return null;
  if (!sqlDatabase) {
    const module = await import("@tauri-apps/plugin-sql");
    sqlDatabase = (await module.default.load("sqlite:prior.db")) as unknown as SqlDatabase;
  }
  return sqlDatabase;
}

function read<T>(key: string, fallback: T): T {
  try {
    const value = localStorage.getItem(key);
    return value ? (JSON.parse(value) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write<T>(key: string, value: T): void {
  localStorage.setItem(key, JSON.stringify(value));
}

function now(): string {
  return new Date().toISOString();
}

function uuid(): string {
  return crypto.randomUUID();
}

export const localStore = {
  async listTasks(): Promise<Task[]> {
    const db = await getSqlDatabase();
    if (db) {
      return db.select<Task>(
        "SELECT id, title, completed, important, urgent, created_at as createdAt, updated_at as updatedAt, deleted_at as deletedAt, server_revision as serverRevision FROM tasks WHERE deleted_at IS NULL ORDER BY completed ASC, updated_at DESC",
      );
    }
    return read<Task[]>(TASKS_KEY, []).filter((task) => !task.deletedAt);
  },

  async saveTask(input: Pick<Task, "title" | "important" | "urgent"> & Partial<Pick<Task, "id" | "completed" | "createdAt" | "updatedAt" | "deletedAt" | "serverRevision">>): Promise<Task> {
    const timestamp = now();
    const previous = input.id ? read<Task[]>(TASKS_KEY, []).find((task) => task.id === input.id) : undefined;
    const task: Task = {
      id: input.id ?? uuid(),
      title: input.title.trim(),
      completed: input.completed ?? previous?.completed ?? false,
      important: input.important,
      urgent: input.urgent,
      createdAt: input.createdAt ?? previous?.createdAt ?? timestamp,
      updatedAt: input.updatedAt ?? timestamp,
      deletedAt: input.deletedAt ?? null,
      serverRevision: input.serverRevision ?? previous?.serverRevision,
    };
    const db = await getSqlDatabase();
    if (db) {
      await db.execute(
        "INSERT INTO tasks (id, title, completed, important, urgent, created_at, updated_at, deleted_at, server_revision) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET title=excluded.title, completed=excluded.completed, important=excluded.important, urgent=excluded.urgent, updated_at=excluded.updated_at, deleted_at=NULL",
        [task.id, task.title, task.completed ? 1 : 0, task.important ? 1 : 0, task.urgent ? 1 : 0, task.createdAt, task.updatedAt, null, task.serverRevision ?? null],
      );
    } else {
      const tasks = read<Task[]>(TASKS_KEY, []).filter((item) => item.id !== task.id);
      write(TASKS_KEY, [...tasks, task]);
    }
    await this.enqueue({ id: uuid(), task, kind: "upsert", createdAt: timestamp });
    return task;
  },

  async updateTask(task: Task): Promise<Task> {
    return this.saveTask({ ...task, updatedAt: undefined });
  },

  async removeTask(task: Task): Promise<void> {
    const deletedAt = now();
    const tombstone = { ...task, deletedAt, updatedAt: deletedAt };
    const db = await getSqlDatabase();
    if (db) {
      await db.execute("UPDATE tasks SET deleted_at = ?, updated_at = ? WHERE id = ?", [deletedAt, deletedAt, task.id]);
    } else {
      const tasks = read<Task[]>(TASKS_KEY, []).map((item) => (item.id === task.id ? tombstone : item));
      write(TASKS_KEY, tasks);
    }
    await this.enqueue({ id: uuid(), task: tombstone, kind: "delete", createdAt: deletedAt });
  },

  async enqueue(mutation: Mutation): Promise<void> {
    const db = await getSqlDatabase();
    if (db) {
      await db.execute(
        "INSERT INTO outbox (id, kind, payload, created_at) VALUES (?, ?, ?, ?)",
        [mutation.id, mutation.kind, JSON.stringify(mutation.task), mutation.createdAt],
      );
      return;
    }
    write(OUTBOX_KEY, [...read<Mutation[]>(OUTBOX_KEY, []), mutation]);
  },

  async pendingMutations(): Promise<Mutation[]> {
    const db = await getSqlDatabase();
    if (db) {
      const rows = await db.select<{ id: string; kind: Mutation["kind"]; payload: string; created_at: string }>(
        "SELECT id, kind, payload, created_at FROM outbox ORDER BY created_at ASC",
      );
      return rows.map((row) => ({ id: row.id, kind: row.kind, task: JSON.parse(row.payload) as Task, createdAt: row.created_at }));
    }
    return read<Mutation[]>(OUTBOX_KEY, []);
  },

  async removeMutations(ids: string[]): Promise<void> {
    const db = await getSqlDatabase();
    if (db) {
      for (const id of ids) await db.execute("DELETE FROM outbox WHERE id = ?", [id]);
      return;
    }
    write(OUTBOX_KEY, read<Mutation[]>(OUTBOX_KEY, []).filter((item) => !ids.includes(item.id)));
  },

  async getSyncState(): Promise<SyncState> {
    const db = await getSqlDatabase();
    if (db) {
      const rows = await db.select<{ last_server_revision: number }>("SELECT last_server_revision FROM sync_state WHERE id = 1");
      const pending = await db.select<{ count: number }>("SELECT COUNT(*) as count FROM outbox");
      return { lastServerRevision: rows[0]?.last_server_revision ?? 0, pendingCount: pending[0]?.count ?? 0 };
    }
    return { ...read<SyncState>(SYNC_KEY, { lastServerRevision: 0, pendingCount: 0 }), pendingCount: read<Mutation[]>(OUTBOX_KEY, []).length };
  },

  async setSyncRevision(revision: number): Promise<void> {
    const db = await getSqlDatabase();
    if (db) {
      await db.execute("UPDATE sync_state SET last_server_revision = ? WHERE id = 1", [revision]);
      return;
    }
    const current = await this.getSyncState();
    write(SYNC_KEY, { ...current, lastServerRevision: revision });
  },

  async applyRemoteTasks(tasks: Task[]): Promise<void> {
    const pendingTaskIds = new Set((await this.pendingMutations()).map((mutation) => mutation.task.id));
    const db = await getSqlDatabase();
    if (db) {
      for (const task of tasks) {
        if (pendingTaskIds.has(task.id)) continue;
        const current = await db.select<{ server_revision: number | null }>("SELECT server_revision FROM tasks WHERE id = ?", [task.id]);
        const currentRevision = current[0]?.server_revision ?? 0;
        if ((task.serverRevision ?? 0) < currentRevision) continue;
        await db.execute(
          "INSERT INTO tasks (id, title, completed, important, urgent, created_at, updated_at, deleted_at, server_revision) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET title=excluded.title, completed=excluded.completed, important=excluded.important, urgent=excluded.urgent, updated_at=excluded.updated_at, deleted_at=excluded.deleted_at, server_revision=excluded.server_revision",
          [task.id, task.title, task.completed ? 1 : 0, task.important ? 1 : 0, task.urgent ? 1 : 0, task.createdAt, task.updatedAt, task.deletedAt, task.serverRevision ?? null],
        );
      }
      return;
    }
    const current = read<Task[]>(TASKS_KEY, []);
    const merged = new Map(current.map((task) => [task.id, task]));
    for (const task of tasks) {
      if (pendingTaskIds.has(task.id)) continue;
      const local = merged.get(task.id);
      if (!local || (task.serverRevision ?? 0) >= (local.serverRevision ?? 0)) merged.set(task.id, task);
    }
    write(TASKS_KEY, [...merged.values()]);
  },
};
