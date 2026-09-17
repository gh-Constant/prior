import type { Habit, HabitMutation, HabitUnit, Mutation, SyncState, Task, TaskDraft, TaskMutation, TaskPriority, TaskStatus } from "../types";
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

function normalizeStatus(value: unknown, completed = false): TaskStatus {
  if (completed) return "done";
  return value === "inbox" || value === "next" || value === "in_progress" || value === "waiting" ? value : "inbox";
}

function normalizeDueDate(value: unknown): string | null {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value.trim()) ? value.trim() : null;
}

function normalizeTask(task: Task): Task {
  return {
    ...task,
    description: typeof task.description === "string" ? task.description : "",
    dueDate: normalizeDueDate(task.dueDate),
    priority: normalizePriority(task.priority),
    areaId: task.areaId ?? null,
    projectId: task.projectId ?? null,
    status: normalizeStatus(task.status, Boolean(task.completed)),
    scheduledDate: normalizeDueDate(task.scheduledDate),
    assigneeName: typeof task.assigneeName === "string" ? task.assigneeName : "",
    followUpDate: normalizeDueDate(task.followUpDate),
    completed: Boolean(task.completed),
    important: Boolean(task.important),
    urgent: Boolean(task.urgent),
  };
}

function normalizeHabit(habit: Habit): Habit {
  return {
    ...habit,
    important: Boolean(habit.important),
    urgent: Boolean(habit.urgent),
    interval: Number.isFinite(habit.interval) && habit.interval > 0 ? Math.floor(habit.interval) : 1,
    unit: habit.unit ?? "day",
    completedDates: Array.isArray(habit.completedDates) ? [...habit.completedDates] : [],
  };
}

function pendingEntityIds(mutations: Mutation[], entity: "task" | "habit"): Set<string> {
  const ids = mutations
    .filter((mutation) => (mutation.entity ?? "task") === entity)
    .map((mutation) => (entity === "habit" ? (mutation as HabitMutation).habit.id : (mutation as TaskMutation).task.id));
  return new Set(ids);
}

function isRemoteStale(remoteRevision: number | undefined, localRevision: number | undefined): boolean {
  return (remoteRevision ?? 0) < (localRevision ?? 0);
}

async function mergeRemoteTasksIntoDb(db: SqlDatabase, pendingIds: Set<string>, tasks: Task[]): Promise<void> {
  for (const task of tasks) {
    if (pendingIds.has(task.id)) continue;
    const current = await db.select<{ server_revision: number | null }>("SELECT server_revision FROM tasks WHERE id = ?", [task.id]);
    if (isRemoteStale(task.serverRevision, current[0]?.server_revision ?? undefined)) continue;
    await db.execute(
      "INSERT INTO tasks (id, title, description, due_date, priority, area_id, project_id, status, scheduled_date, assignee_name, follow_up_date, completed, important, urgent, created_at, updated_at, deleted_at, server_revision) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET title=excluded.title, description=excluded.description, due_date=excluded.due_date, priority=excluded.priority, area_id=excluded.area_id, project_id=excluded.project_id, status=excluded.status, scheduled_date=excluded.scheduled_date, assignee_name=excluded.assignee_name, follow_up_date=excluded.follow_up_date, completed=excluded.completed, important=excluded.important, urgent=excluded.urgent, updated_at=excluded.updated_at, deleted_at=excluded.deleted_at, server_revision=excluded.server_revision",
      [task.id, task.title, task.description ?? "", task.dueDate ?? null, normalizePriority(task.priority), task.areaId ?? null, task.projectId ?? null, normalizeStatus(task.status, task.completed), task.scheduledDate ?? null, task.assigneeName ?? "", task.followUpDate ?? null, task.completed ? 1 : 0, task.important ? 1 : 0, task.urgent ? 1 : 0, task.createdAt, task.updatedAt, task.deletedAt, task.serverRevision ?? null],
    );
  }
}

function mergeRemoteTasksLocally(pendingIds: Set<string>, tasks: Task[]): void {
  const merged = new Map(read<Task[]>(TASKS_KEY, []).map((task) => [task.id, task]));
  for (const task of tasks) {
    if (pendingIds.has(task.id)) continue;
    const local = merged.get(task.id);
    if (!local || !isRemoteStale(task.serverRevision, local.serverRevision)) merged.set(task.id, task);
  }
  write(TASKS_KEY, [...merged.values()]);
}

async function mergeRemoteHabitsIntoDb(db: SqlDatabase, pendingIds: Set<string>, habits: Habit[]): Promise<void> {
  for (const habit of habits) {
    if (pendingIds.has(habit.id)) continue;
    const current = await db.select<{ server_revision: number | null }>("SELECT server_revision FROM habits WHERE id = ?", [habit.id]);
    if (isRemoteStale(habit.serverRevision, current[0]?.server_revision ?? undefined)) continue;
    await db.execute(
      "INSERT INTO habits (id, title, important, urgent, interval, unit, start_date, completed_dates, created_at, updated_at, deleted_at, server_revision) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET title=excluded.title, important=excluded.important, urgent=excluded.urgent, interval=excluded.interval, unit=excluded.unit, start_date=excluded.start_date, completed_dates=excluded.completed_dates, updated_at=excluded.updated_at, deleted_at=excluded.deleted_at, server_revision=excluded.server_revision",
      [habit.id, habit.title, habit.important ? 1 : 0, habit.urgent ? 1 : 0, habit.interval, habit.unit, habit.startDate, JSON.stringify(habit.completedDates ?? []), habit.createdAt, habit.updatedAt, habit.deletedAt, habit.serverRevision ?? null],
    );
  }
}

function mergeRemoteHabitsLocally(pendingIds: Set<string>, habits: Habit[]): void {
  const merged = new Map(read<Habit[]>(HABITS_KEY, []).map((habit) => [habit.id, habit]));
  for (const habit of habits) {
    if (pendingIds.has(habit.id)) continue;
    const local = merged.get(habit.id);
    if (!local || !isRemoteStale(habit.serverRevision, local.serverRevision)) merged.set(habit.id, habit);
  }
  write(HABITS_KEY, [...merged.values()]);
}

export const localStore = {
  async listTasks(): Promise<Task[]> {
    const db = await getSqlDatabase();
    if (db) {
      const rows = await db.select<Task>(
      "SELECT id, title, description, due_date as dueDate, priority, area_id as areaId, project_id as projectId, status, scheduled_date as scheduledDate, assignee_name as assigneeName, follow_up_date as followUpDate, completed, important, urgent, created_at as createdAt, updated_at as updatedAt, deleted_at as deletedAt, server_revision as serverRevision FROM tasks WHERE deleted_at IS NULL ORDER BY completed ASC, updated_at DESC",
      );
      return rows.map(normalizeTask);
    }
    return read<Task[]>(TASKS_KEY, []).filter((task) => !task.deletedAt).map(normalizeTask);
  },

  async saveTask(input: TaskDraft & Partial<Pick<Task, "id" | "completed" | "createdAt" | "updatedAt" | "deletedAt" | "serverRevision">>): Promise<Task> {
    const timestamp = now();
    const previousRaw = input.id ? read<Task[]>(TASKS_KEY, []).find((task) => task.id === input.id) : undefined;
    const previous = previousRaw ? normalizeTask(previousRaw) : undefined;
    const task: Task = normalizeTask({
      id: input.id ?? uuid(),
      title: input.title.trim(),
      description: input.description?.trim() ?? previous?.description ?? "",
      dueDate: normalizeDueDate(input.dueDate ?? previous?.dueDate),
      priority: normalizePriority(input.priority ?? previous?.priority),
      areaId: input.areaId ?? previous?.areaId ?? null,
      projectId: input.projectId ?? previous?.projectId ?? null,
      status: normalizeStatus(input.status ?? previous?.status, Boolean(input.completed ?? previous?.completed ?? false)),
      scheduledDate: normalizeDueDate(input.scheduledDate ?? previous?.scheduledDate),
      assigneeName: input.assigneeName?.trim() ?? previous?.assigneeName ?? "",
      followUpDate: normalizeDueDate(input.followUpDate ?? previous?.followUpDate),
      completed: Boolean(input.completed ?? previous?.completed ?? false),
      important: Boolean(input.important),
      urgent: Boolean(input.urgent),
      createdAt: input.createdAt ?? previous?.createdAt ?? timestamp,
      updatedAt: input.updatedAt ?? timestamp,
      deletedAt: input.deletedAt ?? null,
      serverRevision: input.serverRevision ?? previous?.serverRevision,
    });
    const db = await getSqlDatabase();
    if (db) {
      await db.execute(
        "INSERT INTO tasks (id, title, description, due_date, priority, area_id, project_id, status, scheduled_date, assignee_name, follow_up_date, completed, important, urgent, created_at, updated_at, deleted_at, server_revision) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET title=excluded.title, description=excluded.description, due_date=excluded.due_date, priority=excluded.priority, area_id=excluded.area_id, project_id=excluded.project_id, status=excluded.status, scheduled_date=excluded.scheduled_date, assignee_name=excluded.assignee_name, follow_up_date=excluded.follow_up_date, completed=excluded.completed, important=excluded.important, urgent=excluded.urgent, updated_at=excluded.updated_at, deleted_at=NULL",
        [task.id, task.title, task.description, task.dueDate, task.priority, task.areaId, task.projectId, task.status, task.scheduledDate, task.assigneeName, task.followUpDate, task.completed ? 1 : 0, task.important ? 1 : 0, task.urgent ? 1 : 0, task.createdAt, task.updatedAt, null, task.serverRevision ?? null],
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
      return rows.map((row) => {
        let completedDates: string[] = [];
        try {
          const parsed = JSON.parse(row.completed_dates || "[]");
          if (Array.isArray(parsed)) completedDates = parsed;
        } catch {
          completedDates = [];
        }
        return normalizeHabit({ ...row, startDate: row.start_date, completedDates });
      });
    }
    return read<Habit[]>(HABITS_KEY, []).filter((habit) => !habit.deletedAt).map(normalizeHabit);
  },

  async saveHabit(input: Pick<Habit, "title" | "important" | "urgent" | "interval" | "unit"> & Partial<Pick<Habit, "id" | "startDate" | "completedDates" | "createdAt" | "updatedAt" | "deletedAt" | "serverRevision">>): Promise<Habit> {
    const timestamp = now();
    const existing = input.id ? read<Habit[]>(HABITS_KEY, []).find((habit) => habit.id === input.id) : undefined;
    const interval = Number.isFinite(input.interval) && input.interval > 0 ? Math.floor(input.interval) : 1;
    const habit: Habit = normalizeHabit({
      id: input.id ?? uuid(),
      title: input.title.trim(),
      important: Boolean(input.important),
      urgent: Boolean(input.urgent),
      interval,
      unit: input.unit as HabitUnit,
      startDate: input.startDate ?? existing?.startDate ?? dateKey(new Date(timestamp)),
      completedDates: [...new Set(input.completedDates ?? existing?.completedDates ?? [])].sort((left, right) => left.localeCompare(right)),
      createdAt: input.createdAt ?? existing?.createdAt ?? timestamp,
      updatedAt: input.updatedAt ?? timestamp,
      deletedAt: input.deletedAt ?? null,
      serverRevision: input.serverRevision ?? existing?.serverRevision,
    });
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

  async pendingMutations(): Promise<Mutation[]> {    const db = await getSqlDatabase();
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

  async pendingIdsFor(entity: "task" | "habit"): Promise<Set<string>> {
    return pendingEntityIds(await this.pendingMutations(), entity);
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
    const pendingTaskIds = await this.pendingIdsFor("task");
    const normalizedTasks = tasks.map(normalizeTask);
    const db = await getSqlDatabase();
    if (db) {
      await mergeRemoteTasksIntoDb(db, pendingTaskIds, normalizedTasks);
      return;
    }
    mergeRemoteTasksLocally(pendingTaskIds, normalizedTasks);
  },

  async applyRemoteHabits(habits: Habit[]): Promise<void> {
    const pendingHabitIds = await this.pendingIdsFor("habit");
    const normalizedHabits = habits.map(normalizeHabit);
    const db = await getSqlDatabase();
    if (db) {
      await mergeRemoteHabitsIntoDb(db, pendingHabitIds, normalizedHabits);
      return;
    }
    mergeRemoteHabitsLocally(pendingHabitIds, normalizedHabits);
  },

  async resetSyncRevision(): Promise<void> {
    const db = await getSqlDatabase();
    if (db) {
      await db.execute("UPDATE sync_state SET last_server_revision = 0 WHERE id = 1");
      return;
    }
    const current = await this.getSyncState();
    write(SYNC_KEY, { ...current, lastServerRevision: 0 });
  },
};
