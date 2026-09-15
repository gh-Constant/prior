import type { Habit, HabitUnit } from "../types";

export type HabitStatus = "complete" | "due" | "overdue" | "upcoming";

const DAY_MS = 24 * 60 * 60 * 1000;

function calendarDayNumber(value: Date): number {
  return Date.UTC(value.getFullYear(), value.getMonth(), value.getDate()) / DAY_MS;
}

function validDate(value: string): Date {
  const parsed = new Date(`${value.slice(0, 10)}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

export function dateKey(value = new Date()): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

function addMonths(value: Date, months: number, anchorDay = value.getDate()): Date {
  const result = new Date(value.getFullYear(), value.getMonth() + months, 1);
  result.setDate(Math.min(anchorDay, daysInMonth(result.getFullYear(), result.getMonth())));
  return result;
}

function addYears(value: Date, years: number, anchorMonth = value.getMonth(), anchorDay = value.getDate()): Date {
  const result = new Date(value.getFullYear() + years, anchorMonth, 1);
  result.setDate(Math.min(anchorDay, daysInMonth(result.getFullYear(), anchorMonth)));
  return result;
}

function intervalFor(habit: Pick<Habit, "interval">): number {
  return Number.isFinite(habit.interval) && habit.interval > 0 ? Math.floor(habit.interval) : 1;
}

function occurrenceAt(habit: Habit, index: number): Date {
  const start = validDate(habit.startDate);
  const interval = intervalFor(habit);
  switch (habit.unit) {
    case "week": { const result = new Date(start); result.setDate(start.getDate() + index * interval * 7); return result; }
    case "month": return addMonths(start, index * interval, start.getDate());
    case "year": return addYears(start, index * interval, start.getMonth(), start.getDate());
    default: { const result = new Date(start); result.setDate(start.getDate() + index * interval); return result; }
  }
}

function firstIndexAtOrAfter(habit: Habit, from: Date): number {
  const start = validDate(habit.startDate);
  if (from <= start) return 0;
  const interval = intervalFor(habit);
  if (habit.unit === "day" || habit.unit === "week") {
    const step = interval * (habit.unit === "week" ? 7 : 1);
    return Math.max(0, Math.ceil((calendarDayNumber(startOfDay(from)) - calendarDayNumber(start)) / step - 1e-8));
  }
  if (habit.unit === "month") {
    const months = (from.getFullYear() - start.getFullYear()) * 12 + from.getMonth() - start.getMonth();
    return Math.max(0, Math.floor(months / interval));
  }
  return Math.max(0, Math.floor((from.getFullYear() - start.getFullYear()) / interval));
}

function startOfDay(value: Date): Date {
  const result = new Date(value);
  result.setHours(0, 0, 0, 0);
  return result;
}

/** Returns all scheduled occurrence dates in the inclusive range. */
export function habitOccurrenceDates(habit: Habit, from: Date, to: Date): string[] {
  const start = startOfDay(from);
  const end = startOfDay(to);
  if (end < start) return [];
  const result: string[] = [];
  let index = firstIndexAtOrAfter(habit, start);
  let occurrence = occurrenceAt(habit, index);
  // Month/year clamping can make the estimate one occurrence early. Walk forward
  // until the first date belongs to the requested range.
  while (occurrence < start) {
    index += 1;
    occurrence = occurrenceAt(habit, index);
  }
  while (occurrence <= end && result.length < 4000) {
    result.push(dateKey(occurrence));
    index += 1;
    occurrence = occurrenceAt(habit, index);
  }
  return result;
}

export function habitStatus(habit: Habit, reference = new Date()): HabitStatus {
  const today = startOfDay(reference);
  const key = dateKey(today);
  const completed = new Set(habit.completedDates ?? []);
  const todayIsDue = habitOccurrenceDates(habit, today, today).includes(key);
  const start = validDate(habit.startDate);
  if (today < start) return "upcoming";
  const pending = habitOccurrenceDates(habit, start, today).filter((date) => !completed.has(date));
  const hasPastPending = pending.some((date) => date < key);
  if (todayIsDue && completed.has(key)) return hasPastPending ? "overdue" : "complete";
  if (pending.length > 0) return hasPastPending ? "overdue" : "due";
  return "upcoming";
}

/** The occurrence a completion action should satisfy. */
export function habitCompletionDate(habit: Habit, reference = new Date()): string | null {
  const today = startOfDay(reference);
  const key = dateKey(today);
  const completed = new Set(habit.completedDates ?? []);
  if (habitOccurrenceDates(habit, today, today).includes(key) && !completed.has(key)) return key;
  const start = validDate(habit.startDate);
  return habitOccurrenceDates(habit, start, today).find((date) => !completed.has(date)) ?? null;
}

export function habitIsScheduledInRange(habit: Habit, from: Date, to: Date): boolean {
  return habitOccurrenceDates(habit, from, to).length > 0;
}

export function habitScheduleLabel(habit: Pick<Habit, "interval" | "unit">): string {
  const interval = intervalFor(habit);
  const names: Record<HabitUnit, [string, string]> = {
    day: ["day", "days"], week: ["week", "weeks"], month: ["month", "months"], year: ["year", "years"],
  };
  const [singular, plural] = names[habit.unit];
  return `Every ${interval} ${interval === 1 ? singular : plural}`;
}

export function habitStatusLabel(habit: Habit, reference = new Date()): string {
  const status = habitStatus(habit, reference);
  if (status === "complete") return "Done today";
  if (status === "due") return "Due today";
  if (status === "overdue") return "Overdue";
  const next = habitOccurrenceDates(habit, startOfDay(reference), new Date(startOfDay(reference).getTime() + 370 * DAY_MS))[0];
  return next ? `Next · ${next}` : "Upcoming";
}
