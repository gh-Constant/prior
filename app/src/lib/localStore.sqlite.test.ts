import { beforeEach, describe, expect, it, vi } from "vitest";

describe("localStore SQLite statements validation", () => {
  let executedStatements: Array<{ query: string; bindValues?: unknown[] }> = [];

  beforeEach(() => {
    executedStatements = [];
    vi.resetModules();
    (globalThis as unknown as { window: unknown }).window = {
      __TAURI_INTERNALS__: {},
      dispatchEvent: vi.fn(),
    };
    vi.doMock("@tauri-apps/plugin-sql", () => ({
      default: {
        load: vi.fn(async () => ({
          select: vi.fn(async (query: string, bindValues?: unknown[]) => {
            executedStatements.push({ query, bindValues });
            return [];
          }),
          execute: vi.fn(async (query: string, bindValues?: unknown[]) => {
            executedStatements.push({ query, bindValues });
            return { rowsAffected: 1 };
          }),
        })),
      },
    }));
  });

  function validateSql(query: string, bindValues?: unknown[]) {
    const placeholders = (query.match(/\?/g) || []).length;
    const valuesCount = bindValues ? bindValues.length : 0;
    expect(placeholders, `Placeholder count mismatch in: ${query}`).toBe(valuesCount);

    const insertMatch = query.match(/INSERT INTO \w+ \(([^)]+)\) VALUES \(([^)]+)\)/i);
    if (insertMatch) {
      const cols = insertMatch[1].split(",").map((s) => s.trim());
      const vals = insertMatch[2].split(",").map((s) => s.trim());
      expect(cols.length, `Column count vs values count mismatch in: ${query}`).toBe(vals.length);
    }
  }

  it("validates SQL placeholder and column count on saveTask", async () => {
    const { localStore } = await import("./localStore");
    await localStore.saveTask({ title: "Test task", important: true, urgent: false });
    expect(executedStatements.length).toBeGreaterThan(0);
    for (const stmt of executedStatements) {
      validateSql(stmt.query, stmt.bindValues);
    }
  });

  it("validates SQL placeholder and column count on saveHabit", async () => {
    const { localStore } = await import("./localStore");
    await localStore.saveHabit({ title: "Test habit", important: false, urgent: true, interval: 1, unit: "day" });
    expect(executedStatements.length).toBeGreaterThan(0);
    for (const stmt of executedStatements) {
      validateSql(stmt.query, stmt.bindValues);
    }
  });

  it("validates SQL placeholder and column count on applyRemoteTasks", async () => {
    const { localStore } = await import("./localStore");
    await localStore.applyRemoteTasks([
      { id: "remote-task-1", title: "Remote Task", description: "", dueDate: null, priority: 4, completed: false, important: true, urgent: true, createdAt: "2026-01-01", updatedAt: "2026-01-01", deletedAt: null },
    ]);
    expect(executedStatements.length).toBeGreaterThan(0);
    for (const stmt of executedStatements) {
      validateSql(stmt.query, stmt.bindValues);
    }
  });

  it("validates SQL placeholder and column count on applyRemoteHabits", async () => {
    const { localStore } = await import("./localStore");
    await localStore.applyRemoteHabits([
      { id: "remote-habit-1", title: "Remote Habit", important: true, urgent: false, interval: 1, unit: "day", startDate: "2026-01-01", completedDates: [], createdAt: "2026-01-01", updatedAt: "2026-01-01", deletedAt: null },
    ]);
    expect(executedStatements.length).toBeGreaterThan(0);
    for (const stmt of executedStatements) {
      validateSql(stmt.query, stmt.bindValues);
    }
  });
});
