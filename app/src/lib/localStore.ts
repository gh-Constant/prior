import type { Habit, HabitUnit, Mutation, SyncState, Task, TaskDraft, TaskPriority } from "../types";
import { dateKey } from "./habits";

const TASKS_KEY = "prior.tasks.v1";
const HABITS_KEY = "prior.habits.v1";
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

function normalizePriority(value: unknown): TaskPriority {
  return value === 1 || value === 2 || value === 3 || value === 4 ? value : 4;
}

function normalizeDueDate(value: unknown): string | null {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function normalizeTask(task: Task): Task {
  return {
    ...task,
    description: typeof task.description === "string" ? task.description : "",
    dueDate: normalizeDueDate(task.dueDate),
    priority: normalizePriority(task.priority),
  };
}

export const localStore = {
  async listTasks(): Promise<Task[]> {
    const db = await getSqlDatabase();
    if (db) {
      return db.select<Task>(
        "SELECT id, title, description, due_date as dueDate, priority, completed, important, urgent, created_at as createdAt, updated_at as updatedAt, deleted_at as deletedAt, server_revision as serverRevision FROM tasks WHERE deleted_at IS NULL ORDER BY completed ASC, updated_at DESC",
      );
    }
    return read<Task[]>(TASKS_KEY, []).filter((task) => !task.deletedAt).map(normalizeTask);
  },

  async saveTask(input: TaskDraft & Partial<Pick<Task, "id" | "completed" | "createdAt" | "updatedAt" | "deletedAt" | "serverRevision">>): Promise<Task> {
    const timestamp = now();
    const previousRaw = input.id ? read<Task[]>(TASKS_KEY, []).find((task) => task.id === input.id) : undefined;
    const previous = previousRaw ? normalizeTask(previousRaw) : undefined;
    const task: Task = {
      id: input.id ?? uuid(),
      title: input.title.trim(),
      description: input.description?.trim() ?? previous?.description ?? "",
      dueDate: input.dueDate ?? previous?.dueDate ?? null,
      priority: normalizePriority(input.priority ?? previous?.priority),
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
        "INSERT INTO tasks (id, title, description, due_date, priority, completed, important, urgent, created_at, updated_at, deleted_at, server_revision) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET title=excluded.title, description=excluded.description, due_date=excluded.due_date, priority=excluded.priority, completed=excluded.completed, important=excluded.important, urgent=excluded.urgent, updated_at=excluded.updated_at, deleted_at=NULL",
        [task.id, task.title, task.description, task.dueDate, task.priority, task.completed ? 1 : 0, task.important ? 1 : 0, task.urgent ? 1 : 0, task.createdAt, task.updatedAt, null, task.serverRevision ?? null],
      );
    } else {
      const tasks = read<Task[]>(TASKS_KEY, []).filter((item) => item.id !== task.id);
      write(TASKS_KEY, [...tasks, task]);
    }
    await this.enqueue({ id: uuid(), task, kind: "upsert", entity: "task", createdAt: timestamp });
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
    await this.enqueue({ id: uuid(), task: tombstone, kind: "delete", entity: "task", createdAt: deletedAt });
  },

  async listHabits(): Promise<Habit[]> {
    const db = await getSqlDatabase();
    if (db) {
      const rows = await db.select<Omit<Habit, "startDate" | "completedDates"> & { start_date: string; completed_dates: string }>(
        "SELECT id, title, important, urgent, interval, unit, start_date, completed_dates, created_at as createdAt, updated_at as updatedAt, deleted_at as deletedAt, server_revision as serverRevision FROM habits WHERE deleted_at IS NULL ORDER BY updated_at DESC",
      );
      return rows.map((row) => ({ ...row, startDate: row.start_date, completedDates: JSON.parse(row.completed_dates || "[]") as string[] }));
    }
    return read<Habit[]>(HABITS_KEY, []).filter((habit) => !habit.deletedAt);
  },

  async saveHabit(input: Pick<Habit, "title" | "important" | "urgent" | "interval" | "unit"> & Partial<Pick<Habit, "id" | "startDate" | "completedDates" | "createdAt" | "updatedAt" | "deletedAt" | "serverRevision">>): Promise<Habit> {
    const timestamp = now();
    const existing = input.id ? read<Habit[]>(HABITS_KEY, []).find((habit) => habit.id === input.id) : undefined;
    const interval = Number.isFinite(input.interval) && input.interval > 0 ? Math.floor(input.interval) : 1;
    const habit: Habit = {
      id: input.id ?? uuid(),
      title: input.title.trim(),
      important: input.important,
      urgent: input.urgent,
      interval,
      unit: input.unit as HabitUnit,
      startDate: input.startDate ?? existing?.startDate ?? dateKey(new Date(timestamp)),
      completedDates: [...new Set(input.completedDates ?? existing?.completedDates ?? [])].sort(),
      createdAt: input.createdAt ?? existing?.createdAt ?? timestamp,
      updatedAt: input.updatedAt ?? timestamp,
      deletedAt: input.deletedAt ?? null,
      serverRevision: input.serverRevision ?? existing?.serverRevision,
    };
    const db = await getSqlDatabase();
    if (db) {
      await db.execute(
        "INSERT INTO habits (id, title, important, urgent, interval, unit, start_date, completed_dates, created_at, updated_at, deleted_at, server_revision) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET title=excluded.title, important=excluded.important, urgent=excluded.urgent, interval=excluded.interval, unit=excluded.unit, start_date=excluded.start_date, completed_dates=excluded.completed_dates, updated_at=excluded.updated_at, deleted_at=NULL, server_revision=excluded.server_revision",
        [habit.id, habit.title, habit.important ? 1 : 0, habit.urgent ? 1 : 0, habit.interval, habit.unit, habit.startDate, JSON.stringify(habit.completedDates), habit.createdAt, habit.updatedAt, null, habit.serverRevision ?? null],
      );
    } else {
      write(HABITS_KEY, [...read<Habit[]>(HABITS_KEY, []).filter((item) => item.id !== habit.id), habit]);
    }
    await this.enqueue({ id: uuid(), habit, kind: "upsert", entity: "habit", createdAt: timestamp });
    return habit;
  },

  async updateHabit(habit: Habit): Promise<Habit> {
    return this.saveHabit({ ...habit, updatedAt: undefined });
  },

  async removeHabit(habit: Habit): Promise<void> {
    const deletedAt = now();
    const tombstone = { ...habit, deletedAt, updatedAt: deletedAt };
    const db = await getSqlDatabase();
    if (db) {
      await db.execute("UPDATE habits SET deleted_at = ?, updated_at = ? WHERE id = ?", [deletedAt, deletedAt, habit.id]);
    } else {
      write(HABITS_KEY, read<Habit[]>(HABITS_KEY, []).map((item) => item.id === habit.id ? tombstone : item));
    }
    await this.enqueue({ id: uuid(), habit: tombstone, kind: "delete", entity: "habit", createdAt: deletedAt });
  },

  async enqueue(mutation: Mutation): Promise<void> {
    const db = await getSqlDatabase();
    if (db) {
      await db.execute(
        "INSERT INTO outbox (id, entity, kind, payload, created_at) VALUES (?, ?, ?, ?, ?)",
        [mutation.id, mutation.entity ?? "task", mutation.kind, JSON.stringify("habit" in mutation ? mutation.habit : mutation.task), mutation.createdAt],
      );
      return;
    }
    write(OUTBOX_KEY, [...read<Mutation[]>(OUTBOX_KEY, []), mutation]);
  },

  async pendingMutations(): Promise<Mutation[]> {
    const db = await getSqlDatabase();
    if (db) {
      const rows = await db.select<{ id: string; entity: "task" | "habit"; kind: Mutation["kind"]; payload: string; created_at: string }>(
        "SELECT id, entity, kind, payload, created_at FROM outbox ORDER BY created_at ASC",
      );
      return rows.map((row) => row.entity === "habit"
        ? { id: row.id, entity: "habit", kind: row.kind, habit: JSON.parse(row.payload) as Habit, createdAt: row.created_at }
        : { id: row.id, entity: "task", kind: row.kind, task: JSON.parse(row.payload) as Task, createdAt: row.created_at });
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
    const pendingTaskIds = new Set((await this.pendingMutations()).filter((mutation) => mutation.entity !== "habit").map((mutation) => mutation.task.id));
    const db = await getSqlDatabase();
    if (db) {
      for (const task of tasks) {
        if (pendingTaskIds.has(task.id)) continue;
        const current = await db.select<{ server_revision: number | null }>("SELECT server_revision FROM tasks WHERE id = ?", [task.id]);
        const currentRevision = current[0]?.server_revision ?? 0;
        if ((task.serverRevision ?? 0) < currentRevision) continue;
        await db.execute(
          "INSERT INTO tasks (id, title, description, due_date, priority, completed, important, urgent, created_at, updated_at, deleted_at, server_revision) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET title=excluded.title, description=excluded.description, due_date=excluded.due_date, priority=excluded.priority, completed=excluded.completed, important=excluded.important, urgent=excluded.urgent, updated_at=excluded.updated_at, deleted_at=excluded.deleted_at, server_revision=excluded.server_revision",
          [task.id, task.title, task.description ?? "", task.dueDate ?? null, normalizePriority(task.priority), task.completed ? 1 : 0, task.important ? 1 : 0, task.urgent ? 1 : 0, task.createdAt, task.updatedAt, task.deletedAt, task.serverRevision ?? null],
        );
      }
      return;
    }
    const current = read<Task[]>(TASKS_KEY, []);
    const merged = new Map(current.map((task) => [task.id, task]));
    for (const task of tasks) {
      if (pendingTaskIds.has(task.id)) continue;
      const local = merged.get(task.id);
      if (!local || (task.serverRevision ?? 0) >= (local.serverRevision ?? 0)) merged.set(task.id, normalizeTask(task));
    }
    write(TASKS_KEY, [...merged.values()]);
  },

  async applyRemoteHabits(habits: Habit[]): Promise<void> {
    const pendingHabitIds = new Set((await this.pendingMutations()).filter((mutation) => mutation.entity === "habit").map((mutation) => mutation.habit.id));
    const db = await getSqlDatabase();
    if (db) {
      for (const habit of habits) {
        if (pendingHabitIds.has(habit.id)) continue;
        const current = await db.select<{ server_revision: number | null }>("SELECT server_revision FROM habits WHERE id = ?", [habit.id]);
        if ((habit.serverRevision ?? 0) < (current[0]?.server_revision ?? 0)) continue;
        await db.execute(
          "INSERT INTO habits (id, title, important, urgent, interval, unit, start_date, completed_dates, created_at, updated_at, deleted_at, server_revision) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET title=excluded.title, important=excluded.important, urgent=excluded.urgent, interval=excluded.interval, unit=excluded.unit, start_date=excluded.start_date, completed_dates=excluded.completed_dates, updated_at=excluded.updated_at, deleted_at=excluded.deleted_at, server_revision=excluded.server_revision",
          [habit.id, habit.title, habit.important ? 1 : 0, habit.urgent ? 1 : 0, habit.interval, habit.unit, habit.startDate, JSON.stringify(habit.completedDates), habit.createdAt, habit.updatedAt, habit.deletedAt, habit.serverRevision ?? null],
        );
      }
      return;
    }
    const current = read<Habit[]>(HABITS_KEY, []);
    const merged = new Map(current.map((habit) => [habit.id, habit]));
    for (const habit of habits) {
      if (pendingHabitIds.has(habit.id)) continue;
      const local = merged.get(habit.id);
      if (!local || (habit.serverRevision ?? 0) >= (local.serverRevision ?? 0)) merged.set(habit.id, habit);
    }
    write(HABITS_KEY, [...merged.values()]);
  },
};
