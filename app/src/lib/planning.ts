import type { Habit, Task } from "../types";
import { readAccountDocuments, stageDocument, writeAccountDocuments } from "./accountDocuments";
import { readScopedStorage, writeScopedStorage } from "./accountScope";
import { api } from "./api";
import { buildHabitCalendarEvents, eventsInRange, minutesFromTime, type CalendarEvent, type CalendarState } from "./calendar";
import {
  addDaysToKey,
  dateKeyOf,
  minutesToClock,
  normalizePlanningSettings,
  type BusyBlock,
  type EnergyKind,
  type PlannedBlock,
  type PlanningSettings,
} from "./timeBlocking";

/*
 * State around the time-blocking engine (lib/timeBlocking.ts): the settings
 * (synced as the `preferences/planning` account document), the busy time read
 * from the calendar, the previous plan (stability) and the Jev estimates.
 */

export const PLANNING_SETTINGS_EVENT = "prior-planning-settings";
export const PLANNING_ESTIMATES_EVENT = "prior-planning-estimates";
const SETTINGS_DOCUMENT = "preferences/planning";
const PREVIOUS_KEY = "prior.planning.previous.v1";
const ESTIMATES_KEY = "prior.planning.estimates.v1";

export function getPlanningSettings(): PlanningSettings {
  try {
    return normalizePlanningSettings(readAccountDocuments().records[SETTINGS_DOCUMENT]);
  } catch {
    return normalizePlanningSettings(null);
  }
}

export function savePlanningSettings(settings: PlanningSettings): void {
  const documents = readAccountDocuments();
  stageDocument(documents, SETTINGS_DOCUMENT, { ...normalizePlanningSettings(settings) });
  writeAccountDocuments(documents);
  if (typeof window !== "undefined") window.dispatchEvent(new Event(PLANNING_SETTINGS_EVENT));
}

/* ── Busy time ────────────────────────────────────────────────────────── */

/**
 * Busy time over `days` days from `today`. Timed events block their span plus
 * the buffer; habits with a time block 45 minutes; an all-day event blocks the
 * whole day only when it is locked (holidays, days off). Calendars marked
 * "free for planning" are ignored.
 */
export function busyFromCalendar(state: CalendarState | null, habits: readonly Habit[], today: string, days: number): BusyBlock[] {
  const from = new Date(`${today}T00:00:00`);
  const to = new Date(`${addDaysToKey(today, Math.max(0, days - 1))}T00:00:00`);
  const busy: BusyBlock[] = [];
  if (state) {
    const free = new Set(state.sources.filter((source) => source.planningFree).map((source) => source.id));
    let events: ReturnType<typeof eventsInRange> = [];
    try { events = eventsInRange({ ...state, showHabits: false }, [], from, to); } catch { events = []; }
    for (const event of events) {
      if (event.kind !== "event" || free.has(event.sourceId)) continue;
      const start = minutesFromTime(event.startTime);
      if (start === null) {
        if (event.locked) busy.push({ date: event.date, start: 0, end: 24 * 60 });
        continue;
      }
      const endTime = event.endTime === "23:59" ? 24 * 60 : minutesFromTime(event.endTime);
      busy.push({ date: event.date, start, end: endTime !== null && endTime > start ? endTime : start + 45, buffer: true });
    }
  }
  for (const event of buildHabitCalendarEvents(habits.filter((habit) => !habit.deletedAt), from, to)) {
    const start = minutesFromTime(event.startTime);
    if (start !== null) busy.push({ date: event.date, start, end: start + 45 });
  }
  return busy;
}

/* ── Previous plan ────────────────────────────────────────────────────── */

export function readPreviousPlan(): PlannedBlock[] {
  try {
    const parsed = JSON.parse(readScopedStorage(PREVIOUS_KEY) ?? "null") as { blocks?: unknown } | null;
    if (!parsed || !Array.isArray(parsed.blocks)) return [];
    return parsed.blocks.filter((block): block is PlannedBlock => Boolean(block) && typeof block === "object"
      && typeof (block as PlannedBlock).taskId === "string" && typeof (block as PlannedBlock).date === "string"
      && Number.isFinite((block as PlannedBlock).start) && Number.isFinite((block as PlannedBlock).end));
  } catch {
    return [];
  }
}

export function writePreviousPlan(blocks: readonly PlannedBlock[]): void {
  try { writeScopedStorage(PREVIOUS_KEY, JSON.stringify({ at: new Date().toISOString(), blocks: blocks.filter((block) => block.date >= dateKeyOf(new Date())) })); }
  catch { /* storage full or unavailable: stability is a nicety */ }
}

/* ── AI estimates (Jev, Prior AI) ─────────────────────────────────────── */

export type AiEstimate = { minutes: number; energy: EnergyKind; value?: number };
type CachedEstimate = AiEstimate & { hash: string; at: number };

/** What the estimate depends on: a changed title or checklist asks again. */
export function estimateHash(task: Pick<Task, "title" | "description" | "checklist">): string {
  const text = `${task.title}\u0000${(task.description ?? "").slice(0, 300)}\u0000${task.checklist?.length ?? 0}`;
  let hash = 5381;
  for (let index = 0; index < text.length; index += 1) hash = ((hash * 33) ^ text.charCodeAt(index)) >>> 0;
  return hash.toString(36);
}

function readEstimateCache(): Record<string, CachedEstimate> {
  try {
    const parsed = JSON.parse(readScopedStorage(ESTIMATES_KEY) ?? "{}") as Record<string, CachedEstimate>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

/** Cached estimates still valid for these tasks. */
export function cachedEstimates(tasks: readonly Task[]): Map<string, AiEstimate> {
  const cache = readEstimateCache();
  const result = new Map<string, AiEstimate>();
  for (const task of tasks) {
    const entry = cache[task.id];
    if (entry && entry.hash === estimateHash(task)) result.set(task.id, { minutes: entry.minutes, energy: entry.energy, ...(entry.value !== undefined ? { value: entry.value } : {}) });
  }
  return result;
}

/** Tasks the AI has not estimated yet (the user's own estimate needs no AI for duration, but effort still helps). */
export function tasksNeedingEstimates(tasks: readonly Task[], limit = 30): Task[] {
  const cache = readEstimateCache();
  return tasks.filter((task) => cache[task.id]?.hash !== estimateHash(task)).slice(0, limit);
}

export function storeEstimates(tasks: readonly Task[], estimates: ReadonlyMap<string, AiEstimate>): void {
  const cache = readEstimateCache();
  const now = Date.now();
  for (const task of tasks) {
    const estimate = estimates.get(task.id);
    if (estimate) cache[task.id] = { ...estimate, hash: estimateHash(task), at: now };
  }
  // Keep the cache small: newest 500 entries.
  const entries = Object.entries(cache).sort((left, right) => right[1].at - left[1].at).slice(0, 500);
  try { writeScopedStorage(ESTIMATES_KEY, JSON.stringify(Object.fromEntries(entries))); }
  catch { /* storage unavailable */ }
  if (typeof window !== "undefined") window.dispatchEvent(new Event(PLANNING_ESTIMATES_EVENT));
}

/** The JSON the API's `planning` purpose reads (server/internal/httpapi/planning_decisions.go). */
export function planningEstimateInput(tasks: readonly Task[], lang: string): string {
  return JSON.stringify({
    language: lang,
    tasks: tasks.map((task) => ({
      id: task.id,
      title: task.title.slice(0, 200),
      description: (task.description ?? "").slice(0, 240),
      checklist: (task.checklist ?? []).slice(0, 12).map((item) => item.title.slice(0, 80)),
    })),
  });
}

export function parsePlanningEstimates(raw: string, tasks: readonly Task[]): Map<string, AiEstimate> {
  const ids = new Set(tasks.map((task) => task.id));
  const result = new Map<string, AiEstimate>();
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return result; }
  const list = parsed && typeof parsed === "object" && Array.isArray((parsed as { tasks?: unknown }).tasks) ? (parsed as { tasks: unknown[] }).tasks : [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const { id, minutes, energy, value } = item as Record<string, unknown>;
    if (typeof id !== "string" || !ids.has(id) || typeof minutes !== "number" || !Number.isFinite(minutes)) continue;
    result.set(id, {
      minutes: Math.min(480, Math.max(5, Math.round(minutes / 5) * 5)),
      energy: energy === "deep" ? "deep" : "light",
      ...(typeof value === "number" && Number.isFinite(value) ? { value: Math.min(4, Math.max(0, value)) } : {}),
    });
  }
  return result;
}

/** One Jev call for up to 30 tasks; costs a fraction of a cent. */
export async function requestAiEstimates(tasks: readonly Task[], lang: string, token: string): Promise<Map<string, AiEstimate>> {
  if (!tasks.length) return new Map();
  const response = await api.agentComplete({ provider: "hosted", purpose: "planning", json: true, model: "", system: "", prompt: planningEstimateInput(tasks, lang), history: [], webSearch: false }, token);
  return parsePlanningEstimates(response.content, tasks);
}

/* ── Acting on a planned block ────────────────────────────────────────── */

/** The first working day after `today` (tomorrow when no day is a working day). */
export function nextWorkDay(today: string, settings: Pick<PlanningSettings, "workDays">): string {
  for (let offset = 1; offset <= 7; offset += 1) {
    const date = addDaysToKey(today, offset);
    if (settings.workDays.includes(new Date(`${date}T00:00:00`).getDay())) return date;
  }
  return addDaysToKey(today, 1);
}

/** Lock a block: its time is saved on the task, which the planner then treats as fixed. */
export function pinBlock(task: Task, block: Pick<PlannedBlock, "date" | "start">, minutes: number): Task {
  return { ...task, scheduledDate: block.date, scheduledTime: minutesToClock(block.start), estimatedMinutes: task.estimatedMinutes ?? minutes };
}

/** Give the time back to the planner; the day stays as a preference. */
export function unpinTask(task: Task): Task {
  return { ...task, scheduledTime: null };
}

/** Plan the task from the next working day on. */
export function postponeTask(task: Task, today: string, settings: Pick<PlanningSettings, "workDays">): Task {
  return { ...task, scheduledDate: nextWorkDay(today, settings), scheduledTime: null };
}

export const PLANNING_SOURCE_ID = "prior-planning";

/** Planned blocks as read-only calendar entries (never saved in the calendar). */
export function blocksAsCalendarEvents(blocks: readonly PlannedBlock[], tasks: ReadonlyMap<string, Task>, from: string, to: string, color: string): CalendarEvent[] {
  return blocks.flatMap((block) => {
    const task = tasks.get(block.taskId);
    if (!task || block.date < from || block.date > to) return [];
    return [{
      id: `plan:${block.id}`,
      sourceId: PLANNING_SOURCE_ID,
      taskId: task.id,
      title: task.title,
      date: block.date,
      startTime: minutesToClock(block.start),
      endTime: minutesToClock(Math.min(block.end, 24 * 60 - 1)),
      color,
      kind: "task" as const,
      locked: block.fixed,
    }];
  });
}
