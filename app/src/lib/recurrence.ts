// Recurring tasks (specs/RECURRING_TASKS.md). Pure functions: normalising a
// repeat rule, computing the next due date, building the next occurrence of a
// completed task and describing a rule in words. The Go server has the same
// algorithm (server/internal/tasks/recurrence.go); keep the two in sync.
import type { RecurrenceUnit, Task, TaskRecurrence } from "../types";
import type { Translator } from "./i18n/translate";
import { generateUuid } from "./uuid";

export const MAX_RECURRENCE_INTERVAL = 365;
const RECURRENCE_UNITS: readonly RecurrenceUnit[] = ["day", "week", "month", "year"];
const DAY_MS = 86_400_000;
/** Safety net when skipping many missed occurrences (a daily task years overdue). */
const MAX_SKIPPED_OCCURRENCES = 20_000;

/* ----- calendar arithmetic on YYYY-MM-DD keys (no time zones involved) ----- */

function parseDay(key: string): { year: number; month: number; day: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;
  return { year, month, day };
}

function toEpochDay(key: string): number {
  const parts = parseDay(key);
  return parts ? Date.UTC(parts.year, parts.month - 1, parts.day) / DAY_MS : Number.NaN;
}

function fromEpochDay(days: number): string {
  return new Date(days * DAY_MS).toISOString().slice(0, 10);
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** JS weekday (0 = Sunday) of an epoch day. 1970-01-01 was a Thursday. */
function weekdayOfEpochDay(days: number): number {
  return (((days + 4) % 7) + 7) % 7;
}

/** Monday-first position of a JS weekday, so a "week" runs Monday to Sunday. */
function mondayFirst(weekday: number): number {
  return (weekday + 6) % 7;
}

export function localDateKey(value: Date): string {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

/** Whole days from one date key to another (positive when `to` is later). */
export function daysBetween(from: string, to: string): number {
  return toEpochDay(to) - toEpochDay(from);
}

export function addDaysToKey(key: string, amount: number): string {
  return fromEpochDay(toEpochDay(key) + amount);
}

/* ----- normalisation ----- */

/** Parses (SQLite stores JSON text) and validates a repeat rule; anything unusable is null. */
export function normalizeRecurrence(value: unknown): TaskRecurrence | null {
  let raw = value;
  if (typeof raw === "string") {
    if (!raw.trim()) return null;
    try { raw = JSON.parse(raw); } catch { return null; }
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const input = raw as Partial<TaskRecurrence>;
  const interval = typeof input.interval === "number" ? Math.floor(input.interval) : Number.NaN;
  if (!Number.isFinite(interval) || interval < 1 || interval > MAX_RECURRENCE_INTERVAL) return null;
  if (!RECURRENCE_UNITS.includes(input.unit as RecurrenceUnit)) return null;
  const result: TaskRecurrence = { interval, unit: input.unit as RecurrenceUnit };
  if (input.unit === "week" && Array.isArray(input.daysOfWeek)) {
    const days = [...new Set(input.daysOfWeek.map(Number).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))].sort((left, right) => left - right);
    if (days.length > 0) result.daysOfWeek = days;
  }
  if (input.basis === "completion") result.basis = "completion";
  if (typeof input.until === "string" && parseDay(input.until.trim())) result.until = input.until.trim();
  return result;
}

export function recurrenceEquals(left: TaskRecurrence | null | undefined, right: TaskRecurrence | null | undefined): boolean {
  return JSON.stringify(normalizeRecurrence(left)) === JSON.stringify(normalizeRecurrence(right));
}

/* ----- next date ----- */

type StepContext = { anchorDay: number; anchorMonth: number };

/** One step of the rule from `from` (an epoch day), strictly after it. */
function stepOnce(rule: TaskRecurrence, from: number, anchor: StepContext): number {
  const interval = rule.interval;
  if (rule.unit === "day") return from + interval;
  if (rule.unit === "week") {
    const days = rule.daysOfWeek ?? [];
    if (days.length === 0) return from + 7 * interval;
    const keys = [...new Set(days.map(mondayFirst))].sort((left, right) => left - right);
    const current = mondayFirst(weekdayOfEpochDay(from));
    const later = keys.find((key) => key > current);
    // The next listed weekday this week, else the first one `interval` weeks on.
    return later !== undefined ? from + (later - current) : from + 7 * interval - current + keys[0];
  }
  const parts = parseDay(fromEpochDay(from))!;
  if (rule.unit === "month") {
    const total = parts.year * 12 + (parts.month - 1) + interval;
    const year = Math.floor(total / 12);
    const month = (total % 12) + 1;
    return toEpochDay(`${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(Math.min(anchor.anchorDay, daysInMonth(year, month))).padStart(2, "0")}`);
  }
  const year = parts.year + interval;
  const month = anchor.anchorMonth;
  return toEpochDay(`${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(Math.min(anchor.anchorDay, daysInMonth(year, month))).padStart(2, "0")}`);
}

export type NextDueInput = {
  /** The completed occurrence's due date, if it had one. */
  dueDate?: string | null;
  /** The day it was completed (YYYY-MM-DD); defaults to today. */
  completedOn?: string;
  /** Today (YYYY-MM-DD): "due" rules never schedule the next occurrence before it. */
  today: string;
};

/**
 * Next due date (YYYY-MM-DD) after a completion, or null when the series has
 * ended (past `until`) or the inputs are unusable.
 *
 * - basis "due" (default) counts from the due date (today when there is none)
 *   and skips occurrences already in the past, so the next one is today or later.
 * - basis "completion" counts from the day the task was completed.
 * - monthly and yearly rules keep the day of the month of their base date, clamped
 *   to the month length within one call (Jan 31 -> Feb 28 -> Mar 31 while skipping
 *   missed occurrences). Across completions the clamped date becomes the new
 *   base, so Jan 31 -> Feb 28 -> Mar 28: nothing remembers the original day.
 * - a weekly rule with `daysOfWeek` picks the next listed weekday (weeks run
 *   Monday to Sunday) and jumps `interval` weeks after the last listed day.
 */
export function nextDueDate(recurrence: TaskRecurrence, input: NextDueInput): string | null {
  const rule = normalizeRecurrence(recurrence);
  if (!rule || !parseDay(input.today)) return null;
  const completedOn = input.completedOn && parseDay(input.completedOn) ? input.completedOn : input.today;
  const dueDate = input.dueDate && parseDay(input.dueDate) ? input.dueDate : null;
  const baseKey = rule.basis === "completion" ? completedOn : dueDate ?? input.today;
  const base = parseDay(baseKey)!;
  const anchor: StepContext = { anchorDay: base.day, anchorMonth: base.month };
  const today = toEpochDay(input.today);
  let candidate = stepOnce(rule, toEpochDay(baseKey), anchor);
  if (rule.basis !== "completion") {
    for (let skipped = 0; candidate < today && skipped < MAX_SKIPPED_OCCURRENCES; skipped += 1) candidate = stepOnce(rule, candidate, anchor);
    if (candidate < today) return null;
  }
  const next = fromEpochDay(candidate);
  if (rule.until && next > rule.until) return null;
  return next;
}

/* ----- next occurrence ----- */

const REOPEN_STATUSES = new Set<Task["status"]>(["in_progress", "waiting", "done"]);

/** Moves an instant by whole local calendar days, keeping the time of day. */
function shiftInstant(value: string, days: number): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  date.setDate(date.getDate() + days);
  return date.toISOString();
}

/**
 * The next occurrence of a just-completed recurring task, or null when the
 * series ended. `previous` is the task before it was completed: its status is
 * kept for the new occurrence unless it was in progress, waiting or done.
 */
export function buildNextOccurrence(task: Task, now: Date = new Date(), previous?: Pick<Task, "status">): Task | null {
  const rule = normalizeRecurrence(task.recurrence);
  if (!rule) return null;
  const today = localDateKey(now);
  const next = nextDueDate(rule, { dueDate: task.dueDate, completedOn: today, today });
  if (!next) return null;
  const shift = daysBetween(task.dueDate && parseDay(task.dueDate) ? task.dueDate : today, next);
  const sourceStatus = previous?.status ?? task.status;
  const timestamp = now.toISOString();
  return {
    ...task,
    id: generateUuid(),
    status: REOPEN_STATUSES.has(sourceStatus) ? "next" : sourceStatus,
    completed: false,
    dueDate: next,
    dueTime: task.dueTime ?? null,
    scheduledDate: task.scheduledDate && parseDay(task.scheduledDate) ? addDaysToKey(task.scheduledDate, shift) : null,
    scheduledTime: task.scheduledTime ?? null,
    reminderAt: task.reminderAt ? shiftInstant(task.reminderAt, shift) : null,
    followUpDate: null,
    followUpTime: null,
    assigneeName: "",
    checklist: (task.checklist ?? []).map((item, position) => ({ ...item, id: generateUuid(), done: false, position })),
    relations: (task.relations ?? []).map((relation) => ({ ...relation })),
    recurrence: rule,
    createdAt: timestamp,
    updatedAt: timestamp,
    deletedAt: null,
    serverRevision: undefined,
  };
}

/* ----- wording ----- */

function weekdayName(weekday: number, lang: string, width: "short" | "long" = "short"): string {
  // 2024-01-07 was a Sunday.
  return new Intl.DateTimeFormat(lang, { weekday: width, timeZone: "UTC" }).format(new Date(Date.UTC(2024, 0, 7 + weekday)));
}

/** "15th" in English, the bare number elsewhere (each locale wraps it in its own template). */
export function ordinalDay(day: number, lang: string): string {
  if (!lang.toLowerCase().startsWith("en")) return String(day);
  const suffix = { one: "st", two: "nd", few: "rd", other: "th" }[new Intl.PluralRules("en", { type: "ordinal" }).select(day) as "one" | "two" | "few" | "other"] ?? "th";
  return `${day}${suffix}`;
}

function longDate(key: string, lang: string): string {
  const parts = parseDay(key);
  if (!parts) return key;
  return new Intl.DateTimeFormat(lang, { dateStyle: "medium", timeZone: "UTC" }).format(new Date(Date.UTC(parts.year, parts.month - 1, parts.day)));
}

export type DescribeOptions = {
  /** The task's due date: gives "on the 15th" (monthly) and "on October 3" (yearly) their day. */
  dueDate?: string | null;
  /** A compact label for chips: "Daily", "Weekly", "Every 2 weeks". */
  short?: boolean;
};

/** The rule in words, in the user's language ("Every 2 weeks on Mon, Thu"). */
export function describeRecurrence(recurrence: TaskRecurrence, t: Translator["t"], lang: string, options: DescribeOptions = {}): string {
  const rule = normalizeRecurrence(recurrence);
  if (!rule) return t("recurrence.none");
  const due = options.dueDate && parseDay(options.dueDate) ? parseDay(options.dueDate)! : null;
  const days = rule.daysOfWeek ?? [];
  const isWeekdays = rule.unit === "week" && rule.interval === 1 && days.length === 5 && [1, 2, 3, 4, 5].every((day) => days.includes(day));
  let text: string;
  if (isWeekdays) {
    text = options.short ? t("recurrence.shortWeekdays") : t("recurrence.weekdays");
  } else if (rule.unit === "week" && days.length > 0) {
    const names = [...days].sort((left, right) => mondayFirst(left) - mondayFirst(right)).map((day) => weekdayName(day, lang)).join(", ");
    text = rule.interval === 1 ? t("recurrence.weekOn", { days: names }) : t("recurrence.weeksOn", { count: rule.interval, days: names });
  } else if (rule.unit === "month" && due && !options.short) {
    const day = ordinalDay(due.day, lang);
    text = rule.interval === 1 ? t("recurrence.monthOn", { day }) : t("recurrence.monthsOn", { count: rule.interval, day });
  } else if (rule.unit === "year" && due && !options.short) {
    const date = new Intl.DateTimeFormat(lang, { day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(Date.UTC(2024, due.month - 1, due.day)));
    text = rule.interval === 1 ? t("recurrence.yearOn", { date }) : t("recurrence.yearsOn", { count: rule.interval, date });
  } else if (rule.interval === 1) {
    text = options.short ? t(`recurrence.short.${rule.unit}`) : t(`recurrence.every.${rule.unit}`);
  } else {
    text = t(`recurrence.everyN.${rule.unit}`, { count: rule.interval });
  }
  if (rule.basis === "completion" && !options.short) text = t("recurrence.fromCompletion", { text });
  if (rule.until && !options.short) text = t("recurrence.until", { text, date: longDate(rule.until, lang) });
  return text;
}

/** "Mon, Oct 5" for the "next occurrence" notice. */
export function formatOccurrenceDate(key: string, lang: string): string {
  const parts = parseDay(key);
  if (!parts) return key;
  return new Intl.DateTimeFormat(lang, { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(Date.UTC(parts.year, parts.month - 1, parts.day)));
}

/** JS weekday of a date key, or null. */
export function weekdayOfKey(key: string): number | null {
  return parseDay(key) ? weekdayOfEpochDay(toEpochDay(key)) : null;
}

export { weekdayName };

/** The picker's presets, resolved against a due date (today when none). */
export type RecurrencePreset = "none" | "daily" | "weekdays" | "weekly" | "monthly" | "yearly" | "custom";

export function presetRecurrence(preset: Exclude<RecurrencePreset, "none" | "custom">, dueDate: string): TaskRecurrence {
  switch (preset) {
    case "daily": return { interval: 1, unit: "day" };
    case "weekdays": return { interval: 1, unit: "week", daysOfWeek: [1, 2, 3, 4, 5] };
    case "weekly": return { interval: 1, unit: "week", daysOfWeek: [weekdayOfKey(dueDate) ?? new Date().getDay()] };
    case "monthly": return { interval: 1, unit: "month" };
    case "yearly": return { interval: 1, unit: "year" };
  }
}

/** Which preset a rule matches (for the picker's selected row). */
export function presetOf(recurrence: TaskRecurrence | null | undefined, dueDate: string | null | undefined): RecurrencePreset {
  const rule = normalizeRecurrence(recurrence);
  if (!rule) return "none";
  if (rule.basis === "completion" || rule.until || rule.interval !== 1) return "custom";
  if (rule.unit === "day") return "daily";
  if (rule.unit === "month") return "monthly";
  if (rule.unit === "year") return "yearly";
  const days = rule.daysOfWeek ?? [];
  if (days.length === 5 && [1, 2, 3, 4, 5].every((day) => days.includes(day))) return "weekdays";
  const dueWeekday = dueDate ? weekdayOfKey(dueDate) : null;
  if (days.length === 0 || (days.length === 1 && days[0] === dueWeekday)) return "weekly";
  return "custom";
}
