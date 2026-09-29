import type { Task } from "../types";
import { readScopedStorage, writeScopedStorage } from "./accountScope";

export const FOCUS_MINUTES = 25;
export const BREAK_MINUTES = 5;
const STORAGE_KEY = "prior.pomodoro";

export type PomodoroPhase = "focus" | "break";

/** Persisted timer: `endsAt` is set while running, `remainingMs` while paused. */
export type PomodoroState = {
  taskId: string | null;
  phase: PomodoroPhase;
  endsAt: number | null;
  remainingMs: number;
  sessions: number;
};

export function phaseMs(phase: PomodoroPhase): number {
  return (phase === "focus" ? FOCUS_MINUTES : BREAK_MINUTES) * 60_000;
}

export const initialPomodoro: PomodoroState = { taskId: null, phase: "focus", endsAt: null, remainingMs: phaseMs("focus"), sessions: 0 };

export function remainingMs(state: PomodoroState, now: number): number {
  return state.endsAt === null ? state.remainingMs : Math.max(0, state.endsAt - now);
}

export function startPomodoro(state: PomodoroState, now: number): PomodoroState {
  return state.endsAt === null ? { ...state, endsAt: now + state.remainingMs } : state;
}

export function pausePomodoro(state: PomodoroState, now: number): PomodoroState {
  return state.endsAt === null ? state : { ...state, endsAt: null, remainingMs: remainingMs(state, now) };
}

export function resetPomodoro(state: PomodoroState): PomodoroState {
  return { ...state, endsAt: null, remainingMs: phaseMs(state.phase) };
}

/** Moves to the next phase, paused, counting a finished focus session. */
export function nextPhase(state: PomodoroState): PomodoroState {
  const phase: PomodoroPhase = state.phase === "focus" ? "break" : "focus";
  return { ...state, phase, endsAt: null, remainingMs: phaseMs(phase), sessions: state.sessions + (state.phase === "focus" ? 1 : 0) };
}

export function formatCountdown(ms: number): string {
  const total = Math.ceil(ms / 1000);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

/**
 * Orders the tasks offered to the timer: Today's AI focus picks and top
 * priorities first, then the rest of the ranked focus list, then every other
 * open task.
 */
export function pomodoroTaskOptions(tasks: readonly Task[], recommendedIds: readonly string[], ranked: readonly Task[]): { recommended: Task[]; others: Task[] } {
  const open = tasks.filter((task) => !task.completed && !task.deletedAt && task.status !== "done");
  const byId = new Map(open.map((task) => [task.id, task]));
  const seen = new Set<string>();
  const take = (ids: Iterable<string>) => [...ids].flatMap((id) => {
    const task = byId.get(id);
    if (!task || seen.has(id)) return [];
    seen.add(id);
    return [task];
  });
  const recommended = take(recommendedIds);
  const others = take([...ranked.map((task) => task.id), ...[...open].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map((task) => task.id)]);
  return { recommended, others };
}

export function readPomodoro(): PomodoroState {
  try {
    const parsed = JSON.parse(readScopedStorage(STORAGE_KEY) ?? "null") as Partial<PomodoroState> | null;
    if (!parsed || (parsed.phase !== "focus" && parsed.phase !== "break")) return initialPomodoro;
    return {
      taskId: typeof parsed.taskId === "string" ? parsed.taskId : null,
      phase: parsed.phase,
      endsAt: typeof parsed.endsAt === "number" ? parsed.endsAt : null,
      remainingMs: typeof parsed.remainingMs === "number" && parsed.remainingMs > 0 ? parsed.remainingMs : phaseMs(parsed.phase),
      sessions: typeof parsed.sessions === "number" ? parsed.sessions : 0,
    };
  } catch {
    return initialPomodoro;
  }
}

export function writePomodoro(state: PomodoroState): void {
  try {
    writeScopedStorage(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage unavailable: the timer keeps running in memory.
  }
}
