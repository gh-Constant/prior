import { describe, expect, it } from "vitest";
import type { Task } from "../types";
import { focusHistory, focusStatsFor, formatCountdown, initialPomodoro, nextPhase, pausePomodoro, phaseMs, phaseProgress, pomodoroTaskOptions, readPomodoro, remainingMs, skipPhase, startPomodoro, updateSettings, writePomodoro } from "./pomodoro";
import { formatEstimate, normalizeEstimate } from "./taskEstimate";
import { writeScopedStorage } from "./accountScope";

const task = (id: string, extra: Partial<Task> = {}): Task => ({ id, title: id, description: "", dueDate: null, priority: 4, completed: false, important: false, urgent: false, createdAt: "2026-01-01", updatedAt: `2026-01-0${id.length}`, deletedAt: null, ...extra });

describe("pomodoro", () => {
  it("runs, pauses and advances phases", () => {
    const running = startPomodoro(initialPomodoro, 1_000);
    expect(remainingMs(running, 61_000)).toBe(phaseMs("focus") - 60_000);
    const paused = pausePomodoro(running, 61_000);
    expect(paused.endsAt).toBeNull();
    expect(remainingMs(paused, 999_999)).toBe(phaseMs("focus") - 60_000);
    const onBreak = nextPhase(paused);
    expect(onBreak).toMatchObject({ phase: "break", sessions: 1, remainingMs: phaseMs("break") });
    expect(nextPhase(onBreak)).toMatchObject({ phase: "focus", sessions: 1 });
    expect(formatCountdown(phaseMs("focus"))).toBe("25:00");
  });

  it("earns a long break after the configured number of sessions and logs finished sessions", () => {
    let state = updateSettings(initialPomodoro, { longEvery: 2 });
    const at = new Date(2026, 9, 1, 10, 0).getTime();
    state = nextPhase({ ...state, taskId: "a" }, at);
    expect(state).toMatchObject({ phase: "break", sessions: 1 });
    state = nextPhase(nextPhase(state), at + 3_600_000);
    expect(state).toMatchObject({ phase: "long", sessions: 2, remainingMs: phaseMs("long") });
    expect(nextPhase(state)).toMatchObject({ phase: "focus", sessions: 0 });
    const stats = focusStatsFor(state.log, new Date(at));
    expect(stats).toMatchObject({ sessions: 2, minutes: 50 });
    expect(stats.entries[0].taskId).toBe("a");
    expect(focusHistory(state.log, new Date(at)).at(-1)?.minutes).toBe(50);
  });

  it("skips focus without counting it and tracks progress", () => {
    expect(skipPhase(initialPomodoro)).toMatchObject({ phase: "break", sessions: 0, log: [] });
    const running = startPomodoro(initialPomodoro, 0);
    expect(phaseProgress(running, phaseMs("focus") / 2)).toBeCloseTo(0.5);
    expect(formatCountdown(90 * 60_000)).toBe("1:30:00");
  });

  it("applies new durations to an untouched timer and clamps them", () => {
    expect(updateSettings(initialPomodoro, { focusMinutes: 50 }).remainingMs).toBe(50 * 60_000);
    expect(updateSettings(initialPomodoro, { focusMinutes: 9999 }).settings.focusMinutes).toBe(180);
    const paused = pausePomodoro(startPomodoro(initialPomodoro, 0), 60_000);
    expect(updateSettings(paused, { focusMinutes: 50 }).remainingMs).toBe(paused.remainingMs);
  });

  it("reads older saved timers", () => {
    writeScopedStorage("prior.pomodoro", JSON.stringify({ taskId: "a", phase: "break", endsAt: null, remainingMs: 1000, sessions: 7 }));
    expect(readPomodoro()).toMatchObject({ taskId: "a", phase: "break", remainingMs: 1000, sessions: 3, settings: { focusMinutes: 25, longEvery: 4 }, log: [] });
    writePomodoro(initialPomodoro);
    expect(readPomodoro()).toEqual(initialPomodoro);
  });

  it("lists recommended tasks first, then ranked, then the rest", () => {
    const tasks = [task("a"), task("bb"), task("ccc"), task("done", { completed: true })];
    const { recommended, others } = pomodoroTaskOptions(tasks, ["ccc", "done", "ccc"], [task("a")]);
    expect(recommended.map((item) => item.id)).toEqual(["ccc"]);
    expect(others.map((item) => item.id)).toEqual(["a", "bb"]);
  });
});

describe("task estimates", () => {
  it("normalizes and formats minutes", () => {
    expect(normalizeEstimate("45")).toBe(45);
    expect(normalizeEstimate("")).toBeNull();
    expect(normalizeEstimate(0)).toBeNull();
    expect(formatEstimate(90)).toBe("1 h 30");
    expect(formatEstimate(25)).toBe("25 min");
    expect(formatEstimate(null)).toBeNull();
  });
});
