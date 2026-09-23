import type { Habit, Task } from "../types";
import { habitOccurrenceDates } from "./habits";

/** A busy span on today's timeline, in minutes since local midnight. */
export type BusySpan = { readonly start: number; readonly end: number };

export const DAY_START_MINUTES = 9 * 60;
export const DAY_END_MINUTES = 19 * 60;
export const MIN_FREE_SLOT_MINUTES = 45;
/** Longest stretch the timeline proposes as one focus block. */
export const MAX_FREE_SLOT_MINUTES = 120;

export function localDateKey(value = new Date()): string {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

export function minutesOfDay(value: Date): number {
  return value.getHours() * 60 + value.getMinutes();
}

export function parseClock(value: string | null | undefined): number | null {
  const match = /^(\d{1,2}):(\d{2})/.exec(value ?? "");
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return hours <= 23 && minutes <= 59 ? hours * 60 + minutes : null;
}

export function formatClock(minutes: number): string {
  const safe = Math.max(0, Math.min(24 * 60, Math.round(minutes)));
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, "0")}`;
}

/** Merge overlapping busy spans, clipped to the visible day. */
export function mergeBusySpans(spans: readonly BusySpan[], dayStart = DAY_START_MINUTES, dayEnd = DAY_END_MINUTES): BusySpan[] {
  const clipped = spans
    .map((span) => ({ start: Math.max(dayStart, span.start), end: Math.min(dayEnd, span.end) }))
    .filter((span) => span.end > span.start)
    .sort((left, right) => left.start - right.start);
  const merged: BusySpan[] = [];
  for (const span of clipped) {
    const last = merged[merged.length - 1];
    if (last && span.start <= last.end) merged[merged.length - 1] = { start: last.start, end: Math.max(last.end, span.end) };
    else merged.push(span);
  }
  return merged;
}

/** Free minutes left in the visible day from `now` onward. */
export function remainingFreeMinutes(spans: readonly BusySpan[], now: number, dayStart = DAY_START_MINUTES, dayEnd = DAY_END_MINUTES): number {
  const from = Math.max(dayStart, now);
  if (from >= dayEnd) return 0;
  const busy = mergeBusySpans(spans, from, dayEnd).reduce((total, span) => total + (span.end - span.start), 0);
  return dayEnd - from - busy;
}

/**
 * First gap of at least `minLength` minutes between now and the end of the
 * visible day. Deterministic: it never guesses, it only reads the busy spans.
 * The proposed block starts on the next 5-minute mark and stops at the next
 * busy span (or after `maxLength`).
 */
export function firstFreeSlot(spans: readonly BusySpan[], now: number, options: { minLength?: number; maxLength?: number; dayStart?: number; dayEnd?: number } = {}): BusySpan | null {
  const minLength = options.minLength ?? MIN_FREE_SLOT_MINUTES;
  const maxLength = options.maxLength ?? MAX_FREE_SLOT_MINUTES;
  const dayStart = options.dayStart ?? DAY_START_MINUTES;
  const dayEnd = options.dayEnd ?? DAY_END_MINUTES;
  let cursor = Math.max(dayStart, Math.ceil(now / 5) * 5);
  const busy = mergeBusySpans(spans, dayStart, dayEnd);
  for (const span of [...busy, { start: dayEnd, end: dayEnd }]) {
    if (span.end <= cursor) continue;
    if (span.start - cursor >= minLength) return { start: cursor, end: Math.min(span.start, cursor + maxLength) };
    cursor = Math.max(cursor, span.end);
    if (cursor >= dayEnd) break;
  }
  return null;
}

/** Whole days elapsed between an ISO timestamp and `now`, by local calendar day. */
export function daysSince(iso: string | null | undefined, now = new Date()): number | null {
  if (!iso) return null;
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return null;
  const startThen = new Date(then.getFullYear(), then.getMonth(), then.getDate()).getTime();
  const startNow = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return Math.max(0, Math.round((startNow - startThen) / 86_400_000));
}

/** When a waiting task started waiting: the last update is the closest real signal. */
export function waitingSince(task: Pick<Task, "updatedAt" | "createdAt">): string {
  return task.updatedAt || task.createdAt;
}

export function initials(name: string): string {
  const words = name.trim().split(/[\s@._-]+/).filter(Boolean);
  if (!words.length) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return `${words[0][0]}${words[words.length - 1][0]}`.toUpperCase();
}

const AVATAR_TONES = ["blue", "green", "violet", "amber", "accent"] as const;
export type AvatarTone = (typeof AVATAR_TONES)[number];

/** Stable tone per person so the same name always gets the same avatar color. */
export function avatarTone(name: string): AvatarTone {
  let hash = 0;
  for (const char of name.trim().toLowerCase()) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return AVATAR_TONES[hash % AVATAR_TONES.length];
}

export function habitScheduledOn(habit: Habit, day: Date): boolean {
  return habitOccurrenceDates(habit, day, day).includes(localDateKey(day));
}

/**
 * Consecutive completed occurrences counted back from the most recent one.
 * Today's still-open occurrence does not break the streak.
 */
export function habitStreak(habit: Habit, reference = new Date()): number {
  const today = new Date(reference.getFullYear(), reference.getMonth(), reference.getDate());
  const [year, month, day] = (habit.startDate ?? "").split("-").map(Number);
  const start = new Date(year, (month || 1) - 1, day || 1);
  if (!year || Number.isNaN(start.getTime()) || today < start) return 0;
  const todayKey = localDateKey(today);
  const completed = new Set(habit.completedDates ?? []);
  const occurrences = habitOccurrenceDates(habit, start, today);
  let streak = 0;
  for (let index = occurrences.length - 1; index >= 0; index -= 1) {
    const occurrence = occurrences[index];
    if (completed.has(occurrence)) streak += 1;
    else if (occurrence === todayKey) continue;
    else break;
  }
  return streak;
}

/** Completed tasks whose completion (last update) happened on `day`. */
export function completedOn(tasks: readonly Task[], day = new Date()): Task[] {
  const key = localDateKey(day);
  return tasks.filter((task) => {
    if (!task.completed || !task.updatedAt) return false;
    const updated = new Date(task.updatedAt);
    return !Number.isNaN(updated.getTime()) && localDateKey(updated) === key;
  });
}

export type WaitingGroup = { readonly key: string; readonly name: string | null; readonly tasks: Task[] };

/** Group waiting items by the person they depend on; unassigned items come last. */
export function groupWaitingTasks(tasks: readonly Task[]): WaitingGroup[] {
  const groups = new Map<string, { name: string | null; tasks: Task[] }>();
  for (const task of tasks) {
    const name = task.assigneeName?.trim() || null;
    const key = name ? name.toLowerCase() : "";
    const group = groups.get(key) ?? { name, tasks: [] };
    group.tasks.push(task);
    groups.set(key, group);
  }
  return [...groups.entries()]
    .map(([key, group]) => ({ key, name: group.name, tasks: [...group.tasks].sort((left, right) => waitingSince(left).localeCompare(waitingSince(right))) }))
    .sort((left, right) => (left.name === null ? 1 : 0) - (right.name === null ? 1 : 0) || right.tasks.length - left.tasks.length || (left.name ?? "").localeCompare(right.name ?? ""));
}

export function looksLikeEmail(value: string | null | undefined): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value?.trim() ?? "");
}
