import type { Habit, HabitMutation, HabitUnit, Mutation, SyncState, Task, TaskDraft, TaskMutation, TaskPriority, TaskStatus } from "../types";
import { getAccountId, readScopedStorage, writeScopedStorage } from "./accountScope";
import { dateKey } from "./habits";
import { isTauri } from "./platform";
import { generateUuid } from "./uuid";

const TASKS_KEY = "prior.tasks.v1";
const HABITS_KEY = "prior.habits.v1";
const OUTBOX_KEY = "prior.outbox.v1";
const SYNC_KEY = "prior.sync.v1";
const LEGACY_SYNC_KEY = "prior.legacy-sync.v2";

type SqlDatabase = {
  select<T>(query: string, bindValues?: unknown[]): Promise<T[]>;
  execute(query: string, bindValues?: unknown[]): Promise<{ rowsAffected: number }>;
};

let sqlDatabase: SqlDatabase | null = null;
let preparedAccountId: string | null = null;
let accountPreparation: Promise<void> | null = null;

async function getSqlDatabase(): Promise<SqlDatabase | null> {
  if (!isTauri()) return null;
  if (!sqlDatabase) {
    const module = await import("@tauri-apps/plugin-sql");
    sqlDatabase = (await module.default.load("sqlite:prior.db")) as unknown as SqlDatabase;
  }
  await prepareDatabaseAccount(sqlDatabase, getAccountId());
  return sqlDatabase;
}

async function prepareDatabaseAccount(db: SqlDatabase, accountId: string): Promise<void> {
  while (preparedAccountId !== accountId) {
    if (accountPreparation) {
      await accountPreparation;
      continue;
    }
    const preparation = (async () => {
      if (accountId !== "anonymous") {
        // Rows created by pre-v0.3.50 versions (legacy) or while signed out (anonymous)
        // are claimed for the account that signs in.
        await db.execute("UPDATE tasks SET account_id = ? WHERE account_id IN ('legacy', 'anonymous')", [accountId]);
        await db.execute("UPDATE habits SET account_id = ? WHERE account_id IN ('legacy', 'anonymous')", [accountId]);
        await db.execute("UPDATE outbox SET account_id = ? WHERE account_id IN ('legacy', 'anonymous')", [accountId]);
        await db.execute(
          "INSERT OR IGNORE INTO sync_state (account_id, last_server_revision) VALUES (?, 0)",
          [accountId],
        );
      }
    })();
    accountPreparation = preparation;
    try {
      await preparation;
      preparedAccountId = accountId;
    } finally {
      if (accountPreparation === preparation) accountPreparation = null;
    }
  }
}

/** Test hook: reset cached SQLite handle between isolated test cases. */
export function __resetSqlDatabaseForTests(): void {
  sqlDatabase = null;
  preparedAccountId = null;
  accountPreparation = null;
}

function read<T>(key: string, fallback: T): T {
  try {
    const value = readScopedStorage(key);
    return value ? (JSON.parse(value) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write<T>(key: string, value: T): void {
  writeScopedStorage(key, JSON.stringify(value));
}

function now(): string {
  return new Date().toISOString();
}

function uuid(): string {
  return generateUuid();
}

function normalizePriority(value: unknown): TaskPriority {
  return value === 1 || value === 2 || value === 3 || value === 4 ? value : 4;
}

function normalizeStatus(value: unknown, completed = false): TaskStatus {
  if (completed) return "done";
  return value === "inbox" || value === "backlog" || value === "next" || value === "in_progress" || value === "waiting" ? value : "inbox";
}

function normalizeDueDate(value: unknown): string | null {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value.trim()) ? value.trim() : null;
}

function normalizeTime(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(trimmed)) return null;
  return trimmed;
}

function normalizeWeekdays(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(Number).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))].sort((left, right) => left - right);
}

// Pure, adapter-independent normalizers shared by SQLite + localStorage paths.
export function normalizeTask(task: Task): Task {
  let peopleIds: unknown = task.peopleIds;
  if (typeof peopleIds === "string") {
    try { peopleIds = JSON.parse(peopleIds); } catch { peopleIds = []; }
  }
  return {
    ...task,
    description: typeof task.description === "string" ? task.description : "",
    dueDate: normalizeDueDate(task.dueDate),
    dueTime: normalizeTime(task.dueTime),
    priority: normalizePriority(task.priority),
    areaId: task.areaId ?? null,
    projectId: task.projectId ?? null,
    status: normalizeStatus(task.status, Boolean(task.completed)),
    scheduledDate: normalizeDueDate(task.scheduledDate),
    scheduledTime: normalizeTime(task.scheduledTime),
    assigneeName: typeof task.assigneeName === "string" ? task.assigneeName : "",
    peopleIds: Array.isArray(peopleIds) ? [...new Set(peopleIds.filter((value): value is string => typeof value === "string" && value.length > 0))] : [],
    followUpDate: normalizeDueDate(task.followUpDate),
    followUpTime: normalizeTime(task.followUpTime),
    completed: Boolean(task.completed),
    important: Boolean(task.important),
    urgent: Boolean(task.urgent),
  };
}

export function normalizeHabit(habit: Habit): Habit {
  return {
    ...habit,
    important: Boolean(habit.important),
    urgent: Boolean(habit.urgent),
    interval: Number.isFinite(habit.interval) && habit.interval > 0 ? Math.floor(habit.interval) : 1,
    unit: habit.unit ?? "day",
    timeOfDay: normalizeTime(habit.timeOfDay),
    endDate: normalizeDueDate(habit.endDate),
    daysOfWeek: normalizeWeekdays(habit.daysOfWeek),
    completedDates: Array.isArray(habit.completedDates) ? [...habit.completedDates] : [],
  };
}

/** Pure merge rule: a remote snapshot wins unless it is strictly older. */
export function shouldApplyRemote(remoteRevision: number | undefined, localRevision: number | undefined): boolean {
  return (remoteRevision ?? 0) >= (localRevision ?? 0);
}

function isRemoteStale(remoteRevision: number | undefined, localRevision: number | undefined): boolean {
  return !shouldApplyRemote(remoteRevision, localRevision);
}

// Pure builders shared by both adapters so SQLite and localStorage stay in sync.
export function buildTask(
  input: TaskDraft & Partial<Pick<Task, "id" | "completed" | "createdAt" | "updatedAt" | "deletedAt" | "serverRevision">>,
  previous: Task | undefined,
  timestamp: string,
  id: string,
): Task {
  return normalizeTask({
    id,
    title: input.title.trim(),
    description: input.description?.trim() ?? previous?.description ?? "",
    dueDate: normalizeDueDate(input.dueDate !== undefined ? input.dueDate : previous?.dueDate),
    dueTime: normalizeTime(input.dueTime !== undefined ? input.dueTime : previous?.dueTime),
    priority: normalizePriority(input.priority ?? previous?.priority),
    areaId: input.areaId !== undefined ? input.areaId : previous?.areaId ?? null,
    projectId: input.projectId !== undefined ? input.projectId : previous?.projectId ?? null,
    status: normalizeStatus(input.status ?? previous?.status, Boolean(input.completed ?? previous?.completed ?? false)),
    scheduledDate: normalizeDueDate(input.scheduledDate !== undefined ? input.scheduledDate : previous?.scheduledDate),
    scheduledTime: normalizeTime(input.scheduledTime !== undefined ? input.scheduledTime : previous?.scheduledTime),
    assigneeName: input.assigneeName?.trim() ?? previous?.assigneeName ?? "",
    peopleIds: Array.isArray(input.peopleIds) ? [...new Set(input.peopleIds)] : previous?.peopleIds ?? [],
    followUpDate: normalizeDueDate(input.followUpDate !== undefined ? input.followUpDate : previous?.followUpDate),
    followUpTime: normalizeTime(input.followUpTime !== undefined ? input.followUpTime : previous?.followUpTime),
    completed: Boolean(input.completed ?? previous?.completed ?? false),
    important: Boolean(input.important),
    urgent: Boolean(input.urgent),
    createdAt: input.createdAt ?? previous?.createdAt ?? timestamp,
    updatedAt: input.updatedAt ?? timestamp,
    deletedAt: input.deletedAt ?? null,
    serverRevision: input.serverRevision ?? previous?.serverRevision,
  });
}

export function buildHabit(
  input: Pick<Habit, "title" | "important" | "urgent" | "interval" | "unit"> & Partial<Pick<Habit, "id" | "startDate" | "timeOfDay" | "endDate" | "daysOfWeek" | "completedDates" | "createdAt" | "updatedAt" | "deletedAt" | "serverRevision">>,
  previous: Habit | undefined,
  timestamp: string,
  id: string,
): Habit {
  const interval = Number.isFinite(input.interval) && input.interval > 0 ? Math.floor(input.interval) : 1;
  return normalizeHabit({
    id,
    title: input.title.trim(),
    important: Boolean(input.important),
    urgent: Boolean(input.urgent),
    interval,
    unit: input.unit as HabitUnit,
    startDate: input.startDate ?? previous?.startDate ?? dateKey(new Date(timestamp)),
    timeOfDay: normalizeTime(input.timeOfDay !== undefined ? input.timeOfDay : previous?.timeOfDay),
    endDate: normalizeDueDate(input.endDate ?? previous?.endDate),
    daysOfWeek: normalizeWeekdays(input.daysOfWeek ?? previous?.daysOfWeek),
    completedDates: [...new Set(input.completedDates ?? previous?.completedDates ?? [])].sort((left, right) => left.localeCompare(right)),
    createdAt: input.createdAt ?? previous?.createdAt ?? timestamp,
    updatedAt: input.updatedAt ?? timestamp,
    deletedAt: input.deletedAt ?? null,
    serverRevision: input.serverRevision ?? previous?.serverRevision,
  });
}

export function buildTaskMutation(task: Task, kind: "upsert" | "delete", createdAt: string, mutationId: string): TaskMutation {
  return { id: mutationId, task, kind, entity: "task", createdAt };
}

export function buildHabitMutation(habit: Habit, kind: "upsert" | "delete", createdAt: string, mutationId: string): HabitMutation {
  return { id: mutationId, habit, kind, entity: "habit", createdAt };
}

export function buildMutation(entity: Task | Habit, kind: "upsert" | "delete", createdAt: string, mutationId: string, entityKind: "task" | "habit"): Mutation {
  return entityKind === "habit"
    ? buildHabitMutation(entity as Habit, kind, createdAt, mutationId)
    : buildTaskMutation(entity as Task, kind, createdAt, mutationId);
}

function pendingEntityIds(mutations: Mutation[], entity: "task" | "habit"): Set<string> {
  const ids = mutations
    .filter((mutation) => (mutation.entity ?? "task") === entity)
    .map((mutation) => (entity === "habit" ? (mutation as HabitMutation).habit.id : (mutation as TaskMutation).task.id));
  return new Set(ids);
}

type HabitRow = Omit<Habit, "startDate" | "timeOfDay" | "endDate" | "daysOfWeek" | "completedDates"> & { start_date: string; time_of_day: string | null; end_date: string | null; days_of_week: string; completed_dates: string };

function habitFromRow(row: HabitRow): Habit {
  let completedDates: string[] = [];
  try {
    const parsed = JSON.parse(row.completed_dates || "[]");
    if (Array.isArray(parsed)) completedDates = parsed;
  } catch { /* normalize to an empty history */ }
  let daysOfWeek: number[] = [];
  try {
    const parsed = JSON.parse(row.days_of_week || "[]");
    daysOfWeek = normalizeWeekdays(parsed);
  } catch { /* normalize to an empty schedule */ }
  return normalizeHabit({ ...row, startDate: row.start_date, timeOfDay: row.time_of_day, endDate: row.end_date, daysOfWeek, completedDates });
}

async function withTransaction(db: SqlDatabase, work: () => Promise<void>): Promise<void> {
  await db.execute("BEGIN");
  try {
    await work();
    await db.execute("COMMIT");
  } catch (error) {
    try { await db.execute("ROLLBACK"); } catch { /* transaction already failed; surface the original error */ }
    throw error;
  }
}

// Adapter-aware previous lookups: SQLite rows are scoped by (account_id, id) so
// two accounts can reuse the same entity id without seeing each other.
async function findPreviousTask(db: SqlDatabase | null, accountId: string, id: string | undefined): Promise<Task | undefined> {
  if (!id) return undefined;
  if (db) {
    const rows = await db.select<Task>(
      "SELECT id, title, description, due_date as dueDate, due_time as dueTime, priority, area_id as areaId, project_id as projectId, status, scheduled_date as scheduledDate, scheduled_time as scheduledTime, assignee_name as assigneeName, people_ids as peopleIds, follow_up_date as followUpDate, follow_up_time as followUpTime, completed, important, urgent, created_at as createdAt, updated_at as updatedAt, deleted_at as deletedAt, server_revision as serverRevision FROM tasks WHERE id = ? AND account_id = ?",
      [id, accountId],
    );
    return rows[0] ? normalizeTask(rows[0]) : undefined;
  }
  const raw = read<Task[]>(TASKS_KEY, []).find((task) => task.id === id);
  return raw ? normalizeTask(raw) : undefined;
}

async function findPreviousHabit(db: SqlDatabase | null, accountId: string, id: string | undefined): Promise<Habit | undefined> {
  if (!id) return undefined;
  if (db) {
    const rows = await db.select<HabitRow>(
      "SELECT id, title, important, urgent, interval, unit, start_date, time_of_day, end_date, days_of_week, completed_dates, created_at as createdAt, updated_at as updatedAt, deleted_at as deletedAt, server_revision as serverRevision FROM habits WHERE id = ? AND account_id = ?",
      [id, accountId],
    );
    return rows[0] ? habitFromRow(rows[0]) : undefined;
  }
  const raw = read<Habit[]>(HABITS_KEY, []).find((habit) => habit.id === id);
  return raw ? normalizeHabit(raw) : undefined;
}

async function mergeRemoteTasksIntoDb(db: SqlDatabase, pendingIds: Set<string>, tasks: Task[]): Promise<void> {
  const accountId = getAccountId();
  const candidates = tasks.filter((task) => !pendingIds.has(task.id));
  if (!candidates.length) return;
  await withTransaction(db, async () => {
    // Bulk-load local revisions once so a large pull does not pay per-row SELECT latency.
    const placeholders = candidates.map(() => "?").join(",");
    const existing = await db.select<{ id: string; server_revision: number | null }>(
      `SELECT id, server_revision FROM tasks WHERE account_id = ? AND id IN (${placeholders})`,
      [accountId, ...candidates.map((task) => task.id)],
    );
    const revisions = new Map(existing.map((row) => [row.id, row.server_revision ?? undefined]));
    for (const task of candidates) {
      if (isRemoteStale(task.serverRevision, revisions.get(task.id))) continue;
      await db.execute(
        "INSERT INTO tasks (account_id, id, title, description, due_date, due_time, priority, area_id, project_id, status, scheduled_date, scheduled_time, assignee_name, people_ids, follow_up_date, follow_up_time, completed, important, urgent, created_at, updated_at, deleted_at, server_revision) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(account_id, id) DO UPDATE SET title=excluded.title, description=excluded.description, due_date=excluded.due_date, due_time=excluded.due_time, priority=excluded.priority, area_id=excluded.area_id, project_id=excluded.project_id, status=excluded.status, scheduled_date=excluded.scheduled_date, scheduled_time=excluded.scheduled_time, assignee_name=excluded.assignee_name, people_ids=excluded.people_ids, follow_up_date=excluded.follow_up_date, follow_up_time=excluded.follow_up_time, completed=excluded.completed, important=excluded.important, urgent=excluded.urgent, updated_at=excluded.updated_at, deleted_at=excluded.deleted_at, server_revision=excluded.server_revision WHERE tasks.account_id = excluded.account_id",
        [accountId, task.id, task.title, task.description ?? "", task.dueDate ?? null, task.dueTime ?? null, normalizePriority(task.priority), task.areaId ?? null, task.projectId ?? null, normalizeStatus(task.status, task.completed), task.scheduledDate ?? null, task.scheduledTime ?? null, task.assigneeName ?? "", JSON.stringify(task.peopleIds ?? []), task.followUpDate ?? null, task.followUpTime ?? null, task.completed ? 1 : 0, task.important ? 1 : 0, task.urgent ? 1 : 0, task.createdAt, task.updatedAt, task.deletedAt, task.serverRevision ?? null],
      );
    }
  });
}

function mergeRemoteTasksLocally(pendingIds: Set<string>, tasks: Task[]): void {
  const merged = new Map(read<Task[]>(TASKS_KEY, []).map((task) => [task.id, task]));
  for (const task of tasks) {
    if (pendingIds.has(task.id)) continue;
    const local = merged.get(task.id);
    if (!local || shouldApplyRemote(task.serverRevision, local.serverRevision)) merged.set(task.id, task);
  }
  write(TASKS_KEY, [...merged.values()]);
}

async function mergeRemoteHabitsIntoDb(db: SqlDatabase, pendingIds: Set<string>, habits: Habit[]): Promise<void> {
  const accountId = getAccountId();
  const candidates = habits.filter((habit) => !pendingIds.has(habit.id));
  if (!candidates.length) return;
  await withTransaction(db, async () => {
    const placeholders = candidates.map(() => "?").join(",");
    const existing = await db.select<{ id: string; server_revision: number | null }>(
      `SELECT id, server_revision FROM habits WHERE account_id = ? AND id IN (${placeholders})`,
      [accountId, ...candidates.map((habit) => habit.id)],
    );
    const revisions = new Map(existing.map((row) => [row.id, row.server_revision ?? undefined]));
    for (const habit of candidates) {
      if (isRemoteStale(habit.serverRevision, revisions.get(habit.id))) continue;
      await db.execute(
        "INSERT INTO habits (account_id, id, title, important, urgent, interval, unit, start_date, time_of_day, end_date, days_of_week, completed_dates, created_at, updated_at, deleted_at, server_revision) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(account_id, id) DO UPDATE SET title=excluded.title, important=excluded.important, urgent=excluded.urgent, interval=excluded.interval, unit=excluded.unit, start_date=excluded.start_date, time_of_day=excluded.time_of_day, end_date=excluded.end_date, days_of_week=excluded.days_of_week, completed_dates=excluded.completed_dates, updated_at=excluded.updated_at, deleted_at=excluded.deleted_at, server_revision=excluded.server_revision WHERE habits.account_id = excluded.account_id",
        [accountId, habit.id, habit.title, habit.important ? 1 : 0, habit.urgent ? 1 : 0, habit.interval, habit.unit, habit.startDate, habit.timeOfDay ?? null, habit.endDate ?? null, JSON.stringify(habit.daysOfWeek ?? []), JSON.stringify(habit.completedDates ?? []), habit.createdAt, habit.updatedAt, habit.deletedAt, habit.serverRevision ?? null],
      );
    }
  });
}

function mergeRemoteHabitsLocally(pendingIds: Set<string>, habits: Habit[]): void {
  const merged = new Map(read<Habit[]>(HABITS_KEY, []).map((habit) => [habit.id, habit]));
  for (const habit of habits) {
    if (pendingIds.has(habit.id)) continue;
    const local = merged.get(habit.id);
    if (!local || shouldApplyRemote(habit.serverRevision, local.serverRevision)) merged.set(habit.id, habit);
  }
  write(HABITS_KEY, [...merged.values()]);
}

export const localStore = {
  async listAllTasks(): Promise<Task[]> {
    const db = await getSqlDatabase();
    if (db) {
      const accountId = getAccountId();
      const rows = await db.select<Task>(
        "SELECT id, title, description, due_date as dueDate, due_time as dueTime, priority, area_id as areaId, project_id as projectId, status, scheduled_date as scheduledDate, scheduled_time as scheduledTime, assignee_name as assigneeName, people_ids as peopleIds, follow_up_date as followUpDate, follow_up_time as followUpTime, completed, important, urgent, created_at as createdAt, updated_at as updatedAt, deleted_at as deletedAt, server_revision as serverRevision FROM tasks WHERE account_id = ? ORDER BY updated_at DESC",
        [accountId],
      );
      return rows.map(normalizeTask);
    }
    return read<Task[]>(TASKS_KEY, []).map(normalizeTask);
  },

  async listTasks(): Promise<Task[]> {
    const db = await getSqlDatabase();
    if (db) {
      const accountId = getAccountId();
      const rows = await db.select<Task>(
      "SELECT id, title, description, due_date as dueDate, due_time as dueTime, priority, area_id as areaId, project_id as projectId, status, scheduled_date as scheduledDate, scheduled_time as scheduledTime, assignee_name as assigneeName, people_ids as peopleIds, follow_up_date as followUpDate, follow_up_time as followUpTime, completed, important, urgent, created_at as createdAt, updated_at as updatedAt, deleted_at as deletedAt, server_revision as serverRevision FROM tasks WHERE account_id = ? AND deleted_at IS NULL ORDER BY completed ASC, updated_at DESC",
      [accountId],
      );
      return rows.map(normalizeTask);
    }
    return read<Task[]>(TASKS_KEY, []).filter((task) => !task.deletedAt).map(normalizeTask);
  },

  async listAllHabits(): Promise<Habit[]> {
    const db = await getSqlDatabase();
    if (db) {
      const accountId = getAccountId();
      const rows = await db.select<HabitRow>(
        "SELECT id, title, important, urgent, interval, unit, start_date, time_of_day, end_date, days_of_week, completed_dates, created_at as createdAt, updated_at as updatedAt, deleted_at as deletedAt, server_revision as serverRevision FROM habits WHERE account_id = ? ORDER BY updated_at DESC",
        [accountId],
      );
      return rows.map(habitFromRow);
    }
    return read<Habit[]>(HABITS_KEY, []).map(normalizeHabit);
  },

  async saveTask(input: TaskDraft & Partial<Pick<Task, "id" | "completed" | "createdAt" | "updatedAt" | "deletedAt" | "serverRevision">>): Promise<Task> {
    const timestamp = now();
    const db = await getSqlDatabase();
    const accountId = getAccountId();
    const previous = await findPreviousTask(db, accountId, input.id);
    const task = buildTask(input, previous, timestamp, input.id ?? uuid());
    if (db) {
      await db.execute(
        "INSERT INTO tasks (account_id, id, title, description, due_date, due_time, priority, area_id, project_id, status, scheduled_date, scheduled_time, assignee_name, people_ids, follow_up_date, follow_up_time, completed, important, urgent, created_at, updated_at, deleted_at, server_revision) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(account_id, id) DO UPDATE SET title=excluded.title, description=excluded.description, due_date=excluded.due_date, due_time=excluded.due_time, priority=excluded.priority, area_id=excluded.area_id, project_id=excluded.project_id, status=excluded.status, scheduled_date=excluded.scheduled_date, scheduled_time=excluded.scheduled_time, assignee_name=excluded.assignee_name, people_ids=excluded.people_ids, follow_up_date=excluded.follow_up_date, follow_up_time=excluded.follow_up_time, completed=excluded.completed, important=excluded.important, urgent=excluded.urgent, updated_at=excluded.updated_at, deleted_at=NULL, server_revision=excluded.server_revision WHERE tasks.account_id = excluded.account_id",
        [accountId, task.id, task.title, task.description, task.dueDate, task.dueTime, task.priority, task.areaId, task.projectId, task.status, task.scheduledDate, task.scheduledTime, task.assigneeName, JSON.stringify(task.peopleIds ?? []), task.followUpDate, task.followUpTime, task.completed ? 1 : 0, task.important ? 1 : 0, task.urgent ? 1 : 0, task.createdAt, task.updatedAt, null, task.serverRevision ?? null],
      );
    } else {
      const tasks = read<Task[]>(TASKS_KEY, []).filter((item) => item.id !== task.id);
      write(TASKS_KEY, [...tasks, task]);
    }
    await this.enqueue(buildTaskMutation(task, "upsert", timestamp, uuid()));
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
      await db.execute("UPDATE tasks SET deleted_at = ?, updated_at = ? WHERE id = ? AND account_id = ?", [deletedAt, deletedAt, task.id, getAccountId()]);
    } else {
      const tasks = read<Task[]>(TASKS_KEY, []).map((item) => (item.id === task.id ? tombstone : item));
      write(TASKS_KEY, tasks);
    }
    await this.enqueue(buildTaskMutation(tombstone, "delete", deletedAt, uuid()));
  },

  async listHabits(): Promise<Habit[]> {
    const db = await getSqlDatabase();
    if (db) {
      const accountId = getAccountId();
      const rows = await db.select<HabitRow>(
        "SELECT id, title, important, urgent, interval, unit, start_date, time_of_day, end_date, days_of_week, completed_dates, created_at as createdAt, updated_at as updatedAt, deleted_at as deletedAt, server_revision as serverRevision FROM habits WHERE account_id = ? AND deleted_at IS NULL ORDER BY updated_at DESC",
        [accountId],
      );
      return rows.map(habitFromRow);
    }
    return read<Habit[]>(HABITS_KEY, []).filter((habit) => !habit.deletedAt).map(normalizeHabit);
  },

  async saveHabit(input: Pick<Habit, "title" | "important" | "urgent" | "interval" | "unit"> & Partial<Pick<Habit, "id" | "startDate" | "timeOfDay" | "endDate" | "daysOfWeek" | "completedDates" | "createdAt" | "updatedAt" | "deletedAt" | "serverRevision">>): Promise<Habit> {
    const timestamp = now();
    const db = await getSqlDatabase();
    const accountId = getAccountId();
    const existing = await findPreviousHabit(db, accountId, input.id);
    const habit = buildHabit(input, existing, timestamp, input.id ?? uuid());
    if (db) {
      await db.execute(
        "INSERT INTO habits (account_id, id, title, important, urgent, interval, unit, start_date, time_of_day, end_date, days_of_week, completed_dates, created_at, updated_at, deleted_at, server_revision) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(account_id, id) DO UPDATE SET title=excluded.title, important=excluded.important, urgent=excluded.urgent, interval=excluded.interval, unit=excluded.unit, start_date=excluded.start_date, time_of_day=excluded.time_of_day, end_date=excluded.end_date, days_of_week=excluded.days_of_week, completed_dates=excluded.completed_dates, updated_at=excluded.updated_at, deleted_at=NULL, server_revision=excluded.server_revision WHERE habits.account_id = excluded.account_id",
        [accountId, habit.id, habit.title, habit.important ? 1 : 0, habit.urgent ? 1 : 0, habit.interval, habit.unit, habit.startDate, habit.timeOfDay ?? null, habit.endDate ?? null, JSON.stringify(habit.daysOfWeek ?? []), JSON.stringify(habit.completedDates ?? []), habit.createdAt, habit.updatedAt, null, habit.serverRevision ?? null],
      );
    } else {
      write(HABITS_KEY, [...read<Habit[]>(HABITS_KEY, []).filter((item) => item.id !== habit.id), habit]);
    }
    await this.enqueue(buildHabitMutation(habit, "upsert", timestamp, uuid()));
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
      await db.execute("UPDATE habits SET deleted_at = ?, updated_at = ? WHERE id = ? AND account_id = ?", [deletedAt, deletedAt, habit.id, getAccountId()]);
    } else {
      write(HABITS_KEY, read<Habit[]>(HABITS_KEY, []).map((item) => item.id === habit.id ? tombstone : item));
    }
    await this.enqueue(buildHabitMutation(tombstone, "delete", deletedAt, uuid()));
  },

  async enqueue(mutation: Mutation): Promise<void> {
    const db = await getSqlDatabase();
    if (db) {
      await db.execute(
        "INSERT INTO outbox (account_id, id, entity, kind, payload, created_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(account_id, id) DO NOTHING",
        [getAccountId(), mutation.id, mutation.entity ?? "task", mutation.kind, JSON.stringify("habit" in mutation ? mutation.habit : mutation.task), mutation.createdAt],
      );
      return;
    }
    write(OUTBOX_KEY, [...read<Mutation[]>(OUTBOX_KEY, []), mutation]);
  },

  async legacyMutations(accountId: string, serverTaskIds: Set<string>, serverHabitIds: Set<string>): Promise<Mutation[]> {
    if (read<Record<string, boolean>>(LEGACY_SYNC_KEY, {})[accountId]) return [];
    const [tasks, habits] = await Promise.all([this.listAllTasks(), this.listAllHabits()]);
    const mutations: Mutation[] = [];
    for (const task of tasks) {
      if ((task.serverRevision == null || task.serverRevision === 0) && !serverTaskIds.has(task.id)) {
        mutations.push(buildTaskMutation(task, task.deletedAt ? "delete" : "upsert", task.updatedAt, uuid()));
      }
    }
    for (const habit of habits) {
      if ((habit.serverRevision == null || habit.serverRevision === 0) && !serverHabitIds.has(habit.id)) {
        mutations.push(buildHabitMutation(habit, habit.deletedAt ? "delete" : "upsert", habit.updatedAt, uuid()));
      }
    }
    return mutations;
  },

  needsLegacySync(accountId: string): boolean {
    return !Boolean(read<Record<string, boolean>>(LEGACY_SYNC_KEY, {})[accountId]);
  },

  markLegacySyncComplete(accountId: string): void {
    const current = read<Record<string, boolean>>(LEGACY_SYNC_KEY, {});
    write(LEGACY_SYNC_KEY, { ...current, [accountId]: true });
  },

  async pendingMutations(): Promise<Mutation[]> {    const db = await getSqlDatabase();
    if (db) {
      const accountId = getAccountId();
      const rows = await db.select<{ id: string; entity: "task" | "habit"; kind: Mutation["kind"]; payload: string; created_at: string }>(
        "SELECT id, entity, kind, payload, created_at FROM outbox WHERE account_id = ? ORDER BY created_at ASC",
        [accountId],
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

  async pendingIdsSnapshot(): Promise<{ tasks: Set<string>; habits: Set<string> }> {
    const pending = await this.pendingMutations();
    return { tasks: pendingEntityIds(pending, "task"), habits: pendingEntityIds(pending, "habit") };
  },

  async removeMutations(ids: string[]): Promise<void> {
    if (!ids.length) return;
    const db = await getSqlDatabase();
    if (db) {
      const accountId = getAccountId();
      await withTransaction(db, async () => {
        for (const id of ids) await db.execute("DELETE FROM outbox WHERE id = ? AND account_id = ?", [id, accountId]);
      });
      return;
    }
    write(OUTBOX_KEY, read<Mutation[]>(OUTBOX_KEY, []).filter((item) => !ids.includes(item.id)));
  },

  async getSyncState(): Promise<SyncState> {
    const db = await getSqlDatabase();
    if (db) {
      const accountId = getAccountId();
      const rows = await db.select<{ last_server_revision: number }>("SELECT last_server_revision FROM sync_state WHERE account_id = ?", [accountId]);
      const pending = await db.select<{ count: number }>("SELECT COUNT(*) as count FROM outbox WHERE account_id = ?", [accountId]);
      return { lastServerRevision: rows[0]?.last_server_revision ?? 0, pendingCount: pending[0]?.count ?? 0 };
    }
    return { ...read<SyncState>(SYNC_KEY, { lastServerRevision: 0, pendingCount: 0 }), pendingCount: read<Mutation[]>(OUTBOX_KEY, []).length };
  },

  async setSyncRevision(revision: number): Promise<void> {
    const db = await getSqlDatabase();
    if (db) {
      await db.execute(
        "INSERT INTO sync_state (account_id, last_server_revision) VALUES (?, ?) ON CONFLICT(account_id) DO UPDATE SET last_server_revision = excluded.last_server_revision",
        [getAccountId(), revision],
      );
      return;
    }
    const current = await this.getSyncState();
    write(SYNC_KEY, { ...current, lastServerRevision: revision });
  },

  async applyRemoteTasks(tasks: Task[], pendingIds?: Set<string>): Promise<void> {
    const pendingTaskIds = pendingIds ?? await this.pendingIdsFor("task");
    const normalizedTasks = tasks.map(normalizeTask);
    const db = await getSqlDatabase();
    if (db) {
      await mergeRemoteTasksIntoDb(db, pendingTaskIds, normalizedTasks);
      return;
    }
    mergeRemoteTasksLocally(pendingTaskIds, normalizedTasks);
  },

  async applyRemoteHabits(habits: Habit[], pendingIds?: Set<string>): Promise<void> {
    const pendingHabitIds = pendingIds ?? await this.pendingIdsFor("habit");
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
      await db.execute("INSERT INTO sync_state (account_id, last_server_revision) VALUES (?, 0) ON CONFLICT(account_id) DO UPDATE SET last_server_revision = 0", [getAccountId()]);
      return;
    }
    const current = await this.getSyncState();
    write(SYNC_KEY, { ...current, lastServerRevision: 0 });
  },
};
