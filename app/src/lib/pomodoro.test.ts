import { describe, expect, it } from "vitest";
import type { Task } from "../types";
import { formatCountdown, initialPomodoro, nextPhase, pausePomodoro, phaseMs, pomodoroTaskOptions, remainingMs, startPomodoro } from "./pomodoro";
import { formatEstimate, normalizeEstimate } from "./taskEstimate";

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
