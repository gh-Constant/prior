import { useSyncExternalStore } from "react";
import type { Task } from "../types";
import { getAccountId, readScopedStorage, writeScopedStorage } from "./accountScope";

export const FOCUS_MINUTES = 25;
export const BREAK_MINUTES = 5;
export const LONG_BREAK_MINUTES = 15;
export const LONG_BREAK_EVERY = 4;
const STORAGE_KEY = "prior.pomodoro";
/** Finished focus sessions kept for the stats (about two weeks of heavy use). */
const LOG_LIMIT = 200;
const LOG_DAYS = 14;

export type PomodoroPhase = "focus" | "break" | "long";

export type PomodoroSettings = {
  readonly focusMinutes: number;
  readonly breakMinutes: number;
  readonly longBreakMinutes: number;
  /** A long break replaces every Nth short break. */
  readonly longEvery: number;
  /** Starts the next phase on its own when one ends. */
  readonly autoStart: boolean;
  /** A short chime when a phase ends. */
  readonly sound: boolean;
};

/** One finished focus session. */
export type FocusLogEntry = {
  readonly at: string;
  readonly minutes: number;
  readonly taskId: string | null;
};

/** Persisted timer: `endsAt` is set while running, `remainingMs` while paused. */
export type PomodoroState = {
  taskId: string | null;
  phase: PomodoroPhase;
  endsAt: number | null;
  remainingMs: number;
  /** Focus sessions finished in the current cycle of long breaks. */
  sessions: number;
  settings: PomodoroSettings;
  log: FocusLogEntry[];
};

export const DEFAULT_POMODORO_SETTINGS: PomodoroSettings = { focusMinutes: FOCUS_MINUTES, breakMinutes: BREAK_MINUTES, longBreakMinutes: LONG_BREAK_MINUTES, longEvery: LONG_BREAK_EVERY, autoStart: false, sound: true };

/** Ready-made rhythms offered next to the custom settings. */
export const POMODORO_PRESETS = [
  { id: "classic", focusMinutes: 25, breakMinutes: 5, longBreakMinutes: 15 },
  { id: "deep", focusMinutes: 50, breakMinutes: 10, longBreakMinutes: 20 },
  { id: "sprint", focusMinutes: 15, breakMinutes: 3, longBreakMinutes: 10 },
] as const;

export function phaseMs(phase: PomodoroPhase, settings: PomodoroSettings = DEFAULT_POMODORO_SETTINGS): number {
  const minutes = phase === "focus" ? settings.focusMinutes : phase === "break" ? settings.breakMinutes : settings.longBreakMinutes;
  return minutes * 60_000;
}

export const initialPomodoro: PomodoroState = { taskId: null, phase: "focus", endsAt: null, remainingMs: phaseMs("focus"), sessions: 0, settings: DEFAULT_POMODORO_SETTINGS, log: [] };

export function remainingMs(state: PomodoroState, now: number): number {
  return state.endsAt === null ? state.remainingMs : Math.max(0, state.endsAt - now);
}

/** How far the current phase has gone, from 0 to 1. */
export function phaseProgress(state: PomodoroState, now: number): number {
  const total = phaseMs(state.phase, state.settings);
  return total > 0 ? Math.min(1, Math.max(0, 1 - remainingMs(state, now) / total)) : 0;
}

export function startPomodoro(state: PomodoroState, now: number): PomodoroState {
  return state.endsAt === null ? { ...state, endsAt: now + state.remainingMs } : state;
}

export function pausePomodoro(state: PomodoroState, now: number): PomodoroState {
  return state.endsAt === null ? state : { ...state, endsAt: null, remainingMs: remainingMs(state, now) };
}

export function resetPomodoro(state: PomodoroState): PomodoroState {
  return { ...state, endsAt: null, remainingMs: phaseMs(state.phase, state.settings) };
}

/** Switches to a phase by hand, paused and full length. */
export function choosePhase(state: PomodoroState, phase: PomodoroPhase): PomodoroState {
  return { ...state, phase, endsAt: null, remainingMs: phaseMs(phase, state.settings) };
}

/**
 * Moves to the next phase, paused. A finished focus session counts towards
 * the cycle (every `longEvery` sessions earn a long break) and, when
 * `finishedAt` is given, is written to the log for the stats.
 */
export function nextPhase(state: PomodoroState, finishedAt?: number): PomodoroState {
  if (state.phase !== "focus") return { ...choosePhase(state, "focus"), sessions: state.phase === "long" ? 0 : state.sessions };
  const sessions = state.sessions + 1;
  const phase: PomodoroPhase = sessions >= Math.max(1, state.settings.longEvery) ? "long" : "break";
  const log = finishedAt === undefined ? state.log : trimLog([...state.log, { at: new Date(finishedAt).toISOString(), minutes: state.settings.focusMinutes, taskId: state.taskId }], finishedAt);
  return { ...choosePhase(state, phase), sessions, log };
}

/** Skips the current phase without counting it. */
export function skipPhase(state: PomodoroState): PomodoroState {
  return state.phase === "focus" ? choosePhase(state, "break") : nextPhase(state);
}

/** Applies new durations; a paused timer at the start of its phase takes the new length. */
export function updateSettings(state: PomodoroState, patch: Partial<PomodoroSettings>): PomodoroState {
  const settings = normalizeSettings({ ...state.settings, ...patch });
  const untouched = state.endsAt === null && state.remainingMs === phaseMs(state.phase, state.settings);
  return { ...state, settings, remainingMs: untouched ? phaseMs(state.phase, settings) : Math.min(state.remainingMs, phaseMs(state.phase, settings)) };
}

function trimLog(log: FocusLogEntry[], now: number): FocusLogEntry[] {
  const oldest = now - LOG_DAYS * 86_400_000;
  return log.filter((entry) => Date.parse(entry.at) >= oldest).slice(-LOG_LIMIT);
}

function localDay(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/** Sessions and minutes of focus finished on the given day. */
export function focusStatsFor(log: readonly FocusLogEntry[], day: Date): { sessions: number; minutes: number; entries: FocusLogEntry[] } {
  const key = localDay(day);
  const entries = log.filter((entry) => localDay(new Date(entry.at)) === key);
  return { sessions: entries.length, minutes: entries.reduce((total, entry) => total + entry.minutes, 0), entries };
}

/** Minutes of focus for each of the last `days` days, oldest first. */
export function focusHistory(log: readonly FocusLogEntry[], today: Date, days = 7): Array<{ date: Date; minutes: number }> {
  return Array.from({ length: days }, (_, index) => {
    const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() - (days - 1 - index));
    return { date, minutes: focusStatsFor(log, date).minutes };
  });
}

export function formatCountdown(ms: number): string {
  const total = Math.ceil(ms / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = String(Math.floor((total % 3600) / 60)).padStart(2, "0");
  const seconds = String(total % 60).padStart(2, "0");
  return hours > 0 ? `${hours}:${minutes}:${seconds}` : `${minutes}:${seconds}`;
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

function clampMinutes(value: unknown, fallback: number, max: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(1, Math.round(value))) : fallback;
}

function normalizeSettings(raw: Partial<PomodoroSettings> | undefined): PomodoroSettings {
  const value = raw ?? {};
  return {
    focusMinutes: clampMinutes(value.focusMinutes, FOCUS_MINUTES, 180),
    breakMinutes: clampMinutes(value.breakMinutes, BREAK_MINUTES, 60),
    longBreakMinutes: clampMinutes(value.longBreakMinutes, LONG_BREAK_MINUTES, 90),
    longEvery: clampMinutes(value.longEvery, LONG_BREAK_EVERY, 12),
    autoStart: value.autoStart === true,
    sound: value.sound !== false,
  };
}

export function readPomodoro(): PomodoroState {
  try {
    const parsed = JSON.parse(readScopedStorage(STORAGE_KEY) ?? "null") as Partial<PomodoroState> | null;
    if (!parsed || (parsed.phase !== "focus" && parsed.phase !== "break" && parsed.phase !== "long")) return initialPomodoro;
    const settings = normalizeSettings(parsed.settings);
    const log = Array.isArray(parsed.log)
      ? parsed.log.filter((entry): entry is FocusLogEntry => Boolean(entry) && typeof entry.at === "string" && typeof entry.minutes === "number").map((entry) => ({ at: entry.at, minutes: entry.minutes, taskId: typeof entry.taskId === "string" ? entry.taskId : null }))
      : [];
    return {
      taskId: typeof parsed.taskId === "string" ? parsed.taskId : null,
      phase: parsed.phase,
      endsAt: typeof parsed.endsAt === "number" ? parsed.endsAt : null,
      remainingMs: typeof parsed.remainingMs === "number" && parsed.remainingMs > 0 ? parsed.remainingMs : phaseMs(parsed.phase, settings),
      sessions: typeof parsed.sessions === "number" ? parsed.sessions % Math.max(1, settings.longEvery) : 0,
      settings,
      log,
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

/* One timer for the whole app: the Focus page, the Today card and the
   background runner all read and write the same state. */

let cached: { account: string; state: PomodoroState } | null = null;
const listeners = new Set<() => void>();

function current(): PomodoroState {
  const account = getAccountId();
  if (!cached || cached.account !== account) cached = { account, state: readPomodoro() };
  return cached.state;
}

export const pomodoroStore = {
  get: current,
  set(next: PomodoroState): void {
    cached = { account: getAccountId(), state: next };
    writePomodoro(next);
    for (const listener of listeners) listener();
  },
  update(change: (state: PomodoroState) => PomodoroState): void {
    pomodoroStore.set(change(current()));
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

export function usePomodoro(): PomodoroState {
  return useSyncExternalStore(pomodoroStore.subscribe, current, current);
}
