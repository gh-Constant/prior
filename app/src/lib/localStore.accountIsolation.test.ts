import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildHabit, buildMutation, buildTask, normalizeHabit, normalizeTask, shouldApplyRemote } from "./localStore";

function makeStorage(): Storage {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value); },
    removeItem: (key: string) => { data.delete(key); },
    clear: () => data.clear(),
    key: (index: number) => [...data.keys()][index] ?? null,
    get length() { return data.size; },
  } as Storage;
}

describe("shared persistence helpers", () => {
  it("normalizes tasks and habits the same way for both adapters", () => {
    const task = normalizeTask({
      id: "t1", title: "  hi  ", description: undefined as unknown as string,
      dueDate: "not-a-date", priority: 9 as never, completed: 1 as unknown as boolean,
      important: 1 as unknown as boolean, urgent: 0 as unknown as boolean,
      createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-02T00:00:00.000Z", deletedAt: null,
    } as never);
    expect(task).toMatchObject({ description: "", dueDate: null, priority: 4, completed: true, status: "done" });

    const habit = normalizeHabit({
      id: "h1", title: "run", important: 1 as unknown as boolean, urgent: 0 as unknown as boolean,
      interval: 0, unit: undefined as never, startDate: "2026-01-01",
      completedDates: "oops" as unknown as string[],
      createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", deletedAt: null,
    } as never);
    expect(habit).toMatchObject({ interval: 1, unit: "day", completedDates: [] });
  });

  it("applies remote snapshots unless strictly stale", () => {
    expect(shouldApplyRemote(5, 4)).toBe(true);
    expect(shouldApplyRemote(4, 4)).toBe(true);
    expect(shouldApplyRemote(3, 4)).toBe(false);
    expect(shouldApplyRemote(undefined, undefined)).toBe(true);
  });

  it("builds tasks, habits and mutations deterministically", () => {
    const ts = "2026-01-02T00:00:00.000Z";
    const task = buildTask({ title: "  Write  ", important: true, urgent: false }, undefined, ts, "task-1");
    expect(task).toMatchObject({ id: "task-1", title: "Write", createdAt: ts, updatedAt: ts });
    const habit = buildHabit({ title: "Stretch", important: false, urgent: true, interval: 2, unit: "week" }, undefined, ts, "habit-1");
    expect(habit).toMatchObject({ id: "habit-1", interval: 2 });
    expect(buildMutation(task, "upsert", ts, "m1", "task")).toMatchObject({ id: "m1", entity: "task" });
    expect(buildMutation(habit, "delete", ts, "m2", "habit")).toMatchObject({ id: "m2", entity: "habit", kind: "delete" });
  });
});

describe("two-account same-id isolation (localStorage adapter)", () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, "localStorage", { configurable: true, value: makeStorage() });
    Object.defineProperty(globalThis, "window", { configurable: true, value: { dispatchEvent: () => true } as unknown as Window });
    localStorage.clear();
    vi.resetModules();
  });

  it("keeps the same entity id isolated per account", async () => {
    const { localStore } = await import("./localStore");
    localStorage.setItem("prior.session.user", JSON.stringify({ id: "account-a" }));
    await localStore.saveTask({ id: "shared-id", title: "Account A task", important: false, urgent: false });

    localStorage.setItem("prior.session.user", JSON.stringify({ id: "account-b" }));
    expect(await localStore.listTasks()).toEqual([]);
    await localStore.saveTask({ id: "shared-id", title: "Account B task", important: true, urgent: false });
    expect((await localStore.listTasks()).map((t) => t.title)).toEqual(["Account B task"]);

    localStorage.setItem("prior.session.user", JSON.stringify({ id: "account-a" }));
    expect((await localStore.listTasks()).map((t) => t.title)).toEqual(["Account A task"]);

    // Updating B must not clobber A's previous (adapter-aware lookup).
    localStorage.setItem("prior.session.user", JSON.stringify({ id: "account-b" }));
    await localStore.saveTask({ id: "shared-id", title: "Account B v2", important: true, urgent: true });
    localStorage.setItem("prior.session.user", JSON.stringify({ id: "account-a" }));
    expect((await localStore.listTasks())[0]).toMatchObject({ title: "Account A task", important: false });
  });

  it("isolates habits with the same id per account", async () => {
    const { localStore } = await import("./localStore");
    localStorage.setItem("prior.session.user", JSON.stringify({ id: "account-a" }));
    await localStore.saveHabit({ id: "shared-habit", title: "A habit", important: false, urgent: false, interval: 1, unit: "day" });
    localStorage.setItem("prior.session.user", JSON.stringify({ id: "account-b" }));
    expect(await localStore.listHabits()).toEqual([]);
    await localStore.saveHabit({ id: "shared-habit", title: "B habit", important: true, urgent: false, interval: 2, unit: "week" });
    expect((await localStore.listHabits())[0]).toMatchObject({ title: "B habit", interval: 2 });
    localStorage.setItem("prior.session.user", JSON.stringify({ id: "account-a" }));
    expect((await localStore.listHabits())[0]).toMatchObject({ title: "A habit", interval: 1 });
  });

  it("ignores a late sync response after the active account changes", async () => {
    const { localStore } = await import("./localStore");
    localStorage.setItem("prior.session.user", JSON.stringify({ id: "account-a" }));
    const task = await localStore.saveTask({ title: "A only", important: false, urgent: false });
    localStorage.setItem("prior.session.user", JSON.stringify({ id: "account-b" }));

    await localStore.applyRemoteTasks([{ ...task, title: "Remote A", serverRevision: 9 }], new Set(), "account-a");
    await localStore.setSyncRevision(9, "account-a");

    expect(await localStore.listTasks()).toEqual([]);
    expect((await localStore.getSyncState()).lastServerRevision).toBe(0);
  });
});

describe("two-account same-id isolation (SQLite adapter)", () => {
  beforeEach(() => {
    vi.resetModules();
    Object.defineProperty(globalThis, "localStorage", { configurable: true, value: makeStorage() });
    (globalThis as unknown as { window: unknown }).window = {
      __TAURI_INTERNALS__: {},
      dispatchEvent: vi.fn(),
    };
  });

  it("scopes previous lookups and upserts by (account_id, id)", async () => {
    const executed: Array<{ query: string; bindValues?: unknown[] }> = [];
    const rowsByAccount = new Map<string, Array<Record<string, unknown>>>();
    vi.doMock("@tauri-apps/plugin-sql", () => ({
      default: {
        load: vi.fn(async () => ({
          select: vi.fn(async (query: string, bindValues?: unknown[]) => {
            executed.push({ query, bindValues });
            if (query.includes("FROM tasks WHERE id = ? AND account_id = ?")) {
              const [id, accountId] = bindValues as [string, string];
              const key = `${accountId}:${id}`;
              return (rowsByAccount.get(key) ?? []) as never[];
            }
            return [] as never[];
          }),
          execute: vi.fn(async (query: string, bindValues?: unknown[]) => {
            executed.push({ query, bindValues });
            return { rowsAffected: 1 };
          }),
        })),
      },
    }));

    localStorage.setItem("prior.session.user", JSON.stringify({ id: "account-a" }));
    const { localStore, __resetSqlDatabaseForTests } = await import("./localStore");
    __resetSqlDatabaseForTests();
    rowsByAccount.set("account-a:shared-id", [{ id: "shared-id", title: "Old A", description: "keep me", serverRevision: 1 } as unknown as Record<string, unknown>]);

    await localStore.saveTask({ id: "shared-id", title: "New A", important: false, urgent: false });

    const previousLookup = executed.find((s) => s.query.includes("FROM tasks WHERE id = ? AND account_id = ?"));
    expect(previousLookup).toBeTruthy();
    expect(previousLookup?.bindValues).toEqual(["shared-id", "account-a"]);

    const upsert = executed.find((s) => s.query.includes("INSERT INTO tasks"));
    expect(upsert?.query).toContain("ON CONFLICT(account_id, id)");
    expect(upsert?.bindValues?.[0]).toBe("account-a");

    // Applying a remote row for account-b must target account-b, not leak into A.
    localStorage.setItem("prior.session.user", JSON.stringify({ id: "account-b" }));
    __resetSqlDatabaseForTests();
    executed.length = 0;
    await localStore.applyRemoteTasks([
      { id: "shared-id", title: "Remote B", description: "", dueDate: null, priority: 4, completed: false, important: false, urgent: false, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-02T00:00:00.000Z", deletedAt: null, serverRevision: 7 },
    ]);
    const remoteUpsert = executed.find((s) => s.query.includes("INSERT INTO tasks"));
    expect(remoteUpsert?.query).toContain("ON CONFLICT(account_id, id)");
    expect(remoteUpsert?.bindValues?.[0]).toBe("account-b");
  });
});
