import type { Habit } from "../types";
import { habitOccurrenceDates } from "./habits";

export type CalendarViewMode = "week" | "month" | "agenda";
export type CalendarSourceType = "demo" | "google" | "outlook" | "icloud" | "ics";
export type CalendarRefreshInterval = "15m" | "hourly" | "daily";

export type CalendarEvent = {
  id: string;
  sourceId: string;
  title: string;
  date: string;
  startTime: string | null;
  endTime: string | null;
  color: string;
  location?: string;
  kind: "event" | "habit";
  habitId?: string;
  completed?: boolean;
};

export type CalendarSource = {
  id: string;
  name: string;
  type: CalendarSourceType;
  color: string;
  enabled: boolean;
  events: CalendarEvent[];
  url?: string;
  refreshInterval?: CalendarRefreshInterval;
  lastSyncedAt?: string;
  syncError?: string;
};

export type CalendarState = {
  sources: CalendarSource[];
  showHabits: boolean;
};

export type PositionedCalendarEvent = CalendarEvent & {
  column: number;
  columns: number;
};

export const CALENDAR_STORAGE_KEY = "prior.calendar.v1";
export const HABIT_CALENDAR_SOURCE_ID = "prior-habits";
export const CALENDAR_COLORS = ["#ef795b", "#6e73d9", "#2d9d8a", "#c58b32", "#b65aa8"] as const;
export const CALENDAR_REFRESH_INTERVAL_MS: Record<CalendarRefreshInterval, number> = {
  "15m": 15 * 60 * 1000,
  hourly: 60 * 60 * 1000,
  daily: 24 * 60 * 60 * 1000,
};

const MINUTES_PER_DAY = 24 * 60;

export function dateKey(value = new Date()): string {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

export function parseDateKey(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, (month || 1) - 1, day || 1);
}

export function addDays(value: Date, amount: number): Date {
  const next = new Date(value);
  next.setDate(next.getDate() + amount);
  return next;
}

export function startOfDay(value: Date): Date {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

export function mondayOf(value: Date): Date {
  const result = startOfDay(value);
  result.setDate(result.getDate() - ((result.getDay() + 6) % 7));
  return result;
}

export function weekDays(value: Date): Date[] {
  const monday = mondayOf(value);
  return Array.from({ length: 7 }, (_, index) => addDays(monday, index));
}

export function monthGrid(value: Date): Date[] {
  const monthStart = new Date(value.getFullYear(), value.getMonth(), 1);
  const first = mondayOf(monthStart);
  return Array.from({ length: 42 }, (_, index) => addDays(first, index));
}

export function minutesFromTime(value: string | null): number | null {
  if (!value || !/^\d{2}:\d{2}$/.test(value)) return null;
  const [hours, minutes] = value.split(":").map(Number);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

export function timeFromMinutes(value: number): string {
  const normalized = Math.max(0, Math.min(MINUTES_PER_DAY - 1, value));
  return `${String(Math.floor(normalized / 60)).padStart(2, "0")}:${String(normalized % 60).padStart(2, "0")}`;
}

function demoDate(reference: Date, dayOffset: number): string {
  return dateKey(addDays(mondayOf(reference), dayOffset));
}

function demoEvent(sourceId: string, id: string, title: string, date: string, startTime: string, endTime: string, color: string, location?: string): CalendarEvent {
  return { id, sourceId, title, date, startTime, endTime, color, location, kind: "event" };
}

export function createImportedDemoSource(type: Exclude<CalendarSourceType, "demo">, reference = new Date(), index = 0): CalendarSource {
  const labels: Record<Exclude<CalendarSourceType, "demo">, { name: string; title: string }> = {
    google: { name: "Google Calendar", title: "Google Calendar event" },
    outlook: { name: "Outlook Calendar", title: "Outlook Calendar event" },
    icloud: { name: "iCloud Calendar", title: "iCloud Calendar event" },
    ics: { name: "Imported .ics file", title: "Imported calendar event" },
  };
  const color = CALENDAR_COLORS[(index + 1) % CALENDAR_COLORS.length];
  const sourceId = `calendar-import-${type}-${Date.now()}`;
  return {
    id: sourceId,
    name: labels[type].name,
    type,
    color,
    enabled: true,
    events: [demoEvent(sourceId, `${sourceId}-event`, labels[type].title, demoDate(reference, 1 + (index % 3)), "11:30", "12:15", color)],
  };
}

export function createIcsUrlSource(name: string, url: string, refreshInterval: CalendarRefreshInterval, index = 0): CalendarSource {
  const sourceId = `calendar-ics-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return {
    id: sourceId,
    name: name.trim() || "ICS calendar",
    type: "ics",
    color: CALENDAR_COLORS[index % CALENDAR_COLORS.length],
    enabled: true,
    events: [],
    url: url.trim(),
    refreshInterval,
  };
}

export function isCalendarSourceDue(source: CalendarSource, now = new Date()): boolean {
  if (source.type !== "ics" || !source.url) return false;
  if (!source.lastSyncedAt) return true;
  const lastSyncedAt = Date.parse(source.lastSyncedAt);
  if (!Number.isFinite(lastSyncedAt)) return true;
  const interval = CALENDAR_REFRESH_INTERVAL_MS[source.refreshInterval ?? "hourly"];
  return now.getTime() - lastSyncedAt >= interval;
}

/** A useful first-run calendar: two sources and a deliberate overlap on Monday. */
export function createDemoCalendarState(reference = new Date()): CalendarState {
  const personalId = "calendar-demo-personal";
  const teamId = "calendar-demo-team";
  const familyId = "calendar-demo-family";
  const personalColor = CALENDAR_COLORS[0];
  const teamColor = CALENDAR_COLORS[1];
  const familyColor = CALENDAR_COLORS[2];
  return {
    showHabits: true,
    sources: [
      {
        id: personalId,
        name: "Personal",
        type: "demo",
        color: personalColor,
        enabled: true,
        events: [
          demoEvent(personalId, "demo-focus", "Focus block", demoDate(reference, 0), "09:00", "10:30", personalColor, "Desk"),
          demoEvent(personalId, "demo-lunch", "Lunch with Emma", demoDate(reference, 1), "12:30", "13:30", personalColor),
          demoEvent(personalId, "demo-review", "Weekly review", demoDate(reference, 4), "16:00", "16:45", personalColor),
        ],
      },
      {
        id: teamId,
        name: "Team calendar",
        type: "demo",
        color: teamColor,
        enabled: true,
        events: [
          demoEvent(teamId, "demo-sync", "Product sync", demoDate(reference, 0), "09:30", "10:45", teamColor, "Room Atlas"),
          demoEvent(teamId, "demo-design", "Design review", demoDate(reference, 0), "09:45", "11:15", teamColor, "Video call"),
          demoEvent(teamId, "demo-planning", "Sprint planning", demoDate(reference, 2), "14:00", "15:00", teamColor),
        ],
      },
      {
        id: familyId,
        name: "Personal plans",
        type: "demo",
        color: familyColor,
        enabled: true,
        events: [
          demoEvent(familyId, "demo-dinner", "Dinner reservation", demoDate(reference, 5), "19:00", "21:00", familyColor, "Le Petit Jardin"),
        ],
      },
    ],
  };
}

function isCalendarState(value: unknown): value is CalendarState {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<CalendarState>;
  return Array.isArray(candidate.sources) && typeof candidate.showHabits === "boolean";
}

export function loadCalendarState(): CalendarState {
  if (typeof window === "undefined") return createDemoCalendarState();
  try {
    const raw = window.localStorage.getItem(CALENDAR_STORAGE_KEY);
    if (!raw) return createDemoCalendarState();
    const parsed: unknown = JSON.parse(raw);
    if (!isCalendarState(parsed)) return createDemoCalendarState();
    return {
      showHabits: parsed.showHabits,
      sources: parsed.sources.filter((source) => source && Array.isArray(source.events)).map((source) => ({
        ...source,
        enabled: source.enabled !== false,
        refreshInterval: source.type === "ics" && source.url ? source.refreshInterval ?? "hourly" : source.refreshInterval,
      })),
    };
  } catch {
    return createDemoCalendarState();
  }
}

export function saveCalendarState(state: CalendarState): void {
  try {
    window.localStorage.setItem(CALENDAR_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Private browsing and restricted webviews can reject localStorage.
  }
}

type ParsedIcsDate = {
  date: string;
  time: string | null;
  timestamp: number;
};

type ParsedIcsEvent = {
  uid: string;
  summary: string;
  start: ParsedIcsDate;
  end: ParsedIcsDate | null;
  location?: string;
};

function unfoldIcsLines(value: string): string[] {
  return value.replace(/\r\n[ \t]/g, "").replace(/\n[ \t]/g, "").replace(/\r/g, "").split("\n").filter(Boolean);
}

function unescapeIcsText(value: string): string {
  return value.replace(/\\n/gi, "\n").replace(/\\([,;\\])/g, "$1").trim();
}

function parseIcsProperty(line: string): { name: string; params: Record<string, string>; value: string } | null {
  const separator = line.indexOf(":");
  if (separator < 1) return null;
  const head = line.slice(0, separator).split(";");
  const params: Record<string, string> = {};
  for (const part of head.slice(1)) {
    const equals = part.indexOf("=");
    if (equals > 0) params[part.slice(0, equals).toUpperCase()] = part.slice(equals + 1).replace(/^"|"$/g, "");
  }
  return { name: head[0].toUpperCase(), params, value: line.slice(separator + 1) };
}

function parseIcsDate(value: string, _params: Record<string, string>): ParsedIcsDate | null {
  const compact = value.trim();
  const dateOnly = /^(\d{4})(\d{2})(\d{2})$/.exec(compact);
  if (dateOnly) {
    const year = Number(dateOnly[1]);
    const month = Number(dateOnly[2]);
    const day = Number(dateOnly[3]);
    const local = new Date(year, month - 1, day);
    if (local.getFullYear() !== year || local.getMonth() !== month - 1 || local.getDate() !== day) return null;
    return { date: dateKey(local), time: null, timestamp: local.getTime() };
  }

  const dateTime = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/.exec(compact);
  if (!dateTime) return null;
  const [, yearValue, monthValue, dayValue, hourValue, minuteValue, secondValue, utc] = dateTime;
  const year = Number(yearValue);
  const month = Number(monthValue);
  const day = Number(dayValue);
  const hour = Number(hourValue);
  const minute = Number(minuteValue);
  const second = Number(secondValue);
  const timestamp = utc
    ? Date.UTC(year, month - 1, day, hour, minute, second)
    : new Date(year, month - 1, day, hour, minute, second).getTime();
  const parsed = new Date(timestamp);
  if (!Number.isFinite(timestamp) || (utc && Number.isNaN(parsed.getTime()))) return null;
  if (!utc && (parsed.getFullYear() !== year || parsed.getMonth() !== month - 1 || parsed.getDate() !== day || parsed.getHours() !== hour || parsed.getMinutes() !== minute)) return null;
  // DTSTART values with TZID are intentionally interpreted in the user's local
  // timezone. That matches timetable feeds and keeps events stable in local-first storage.
  return { date: dateKey(parsed), time: timeFromMinutes(parsed.getHours() * 60 + parsed.getMinutes()), timestamp };
}

function parseIcsEventsWithDates(value: string): Array<ParsedIcsEvent & { startParams: Record<string, string>; endParams: Record<string, string> }> {
  const events: Array<ParsedIcsEvent & { startParams: Record<string, string>; endParams: Record<string, string> }> = [];
  let current: Partial<Record<"uid" | "summary" | "location", string>> & { start?: { value: string; params: Record<string, string> }; end?: { value: string; params: Record<string, string> } } | null = null;
  for (const line of unfoldIcsLines(value)) {
    if (line.toUpperCase() === "BEGIN:VEVENT") {
      current = {};
      continue;
    }
    if (line.toUpperCase() === "END:VEVENT") {
      if (current?.summary && current.start) {
        const start = parseIcsDate(current.start.value, current.start.params);
        const end = current.end ? parseIcsDate(current.end.value, current.end.params) : null;
        if (start) events.push({ uid: current.uid ?? `${events.length}`, summary: current.summary, start, end, location: current.location, startParams: current.start.params, endParams: current.end?.params ?? {} });
      }
      current = null;
      continue;
    }
    if (!current) continue;
    const property = parseIcsProperty(line);
    if (!property) continue;
    if (property.name === "UID") current.uid = unescapeIcsText(property.value);
    if (property.name === "SUMMARY") current.summary = unescapeIcsText(property.value);
    if (property.name === "LOCATION") current.location = unescapeIcsText(property.value);
    if (property.name === "DTSTART") current.start = { value: property.value, params: property.params };
    if (property.name === "DTEND") current.end = { value: property.value, params: property.params };
  }
  return events;
}

export function parseIcsCalendar(value: string, sourceId: string, color: string): CalendarEvent[] {
  if (!/BEGIN:VCALENDAR/i.test(value)) throw new Error("Invalid ICS calendar");
  return parseIcsEventsWithDates(value).map((event, index) => ({
    id: `${sourceId}-${event.uid || index}-${event.start.date}-${event.start.time ?? "all-day"}`.replace(/[^a-zA-Z0-9._:-]/g, "-"),
    sourceId,
    title: event.summary,
    date: event.start.date,
    startTime: event.start.time,
    endTime: event.end?.time ?? null,
    color,
    location: event.location,
    kind: "event" as const,
  }));
}

export async function fetchIcsCalendar(url: string, sourceId: string, color: string, signal?: AbortSignal): Promise<CalendarEvent[]> {
  const response = await fetch(url, { cache: "no-store", headers: { Accept: "text/calendar, text/plain;q=0.9, */*;q=0.1" }, signal });
  if (!response.ok) throw new Error(`Calendar returned ${response.status}`);
  const body = await response.text();
  if (body.length > 8_000_000) throw new Error("Calendar is too large");
  return parseIcsCalendar(body, sourceId, color);
}

export function buildHabitCalendarEvents(habits: Habit[], from: Date, to: Date): CalendarEvent[] {
  return habits.flatMap((habit) => habitOccurrenceDates(habit, from, to).map((date) => {
    const startTime = habit.timeOfDay ?? null;
    const start = minutesFromTime(startTime);
    return {
      id: `habit-${habit.id}-${date}`,
      sourceId: HABIT_CALENDAR_SOURCE_ID,
      title: habit.title,
      date,
      startTime,
      endTime: start === null ? null : timeFromMinutes(start + 45),
      color: "#d17b49",
      kind: "habit" as const,
      habitId: habit.id,
      completed: habit.completedDates.includes(date),
    };
  }));
}

export function eventsInRange(state: CalendarState, habits: Habit[], from: Date, to: Date): CalendarEvent[] {
  const enabledEvents = state.sources.filter((source) => source.enabled).flatMap((source) => source.events);
  const habitEvents = state.showHabits ? buildHabitCalendarEvents(habits, from, to) : [];
  const fromKey = dateKey(from);
  const toKey = dateKey(to);
  return [...enabledEvents, ...habitEvents]
    .filter((event) => event.date >= fromKey && event.date <= toKey)
    .sort((left, right) => left.date.localeCompare(right.date) || (minutesFromTime(left.startTime) ?? -1) - (minutesFromTime(right.startTime) ?? -1) || left.title.localeCompare(right.title));
}

function eventEndMinutes(event: CalendarEvent): number {
  const start = minutesFromTime(event.startTime) ?? 0;
  return Math.max(start + 30, minutesFromTime(event.endTime) ?? start + 45);
}

/** Assign columns to timed events so overlapping imported calendars remain readable. */
export function positionOverlappingEvents(events: CalendarEvent[]): PositionedCalendarEvent[] {
  const timed = events.filter((event) => minutesFromTime(event.startTime) !== null);
  const columns: CalendarEvent[][] = [];
  const columnById = new Map<string, number>();
  for (const event of [...timed].sort((left, right) => (minutesFromTime(left.startTime) ?? 0) - (minutesFromTime(right.startTime) ?? 0) || eventEndMinutes(left) - eventEndMinutes(right))) {
    const start = minutesFromTime(event.startTime) ?? 0;
    const column = columns.findIndex((items) => items.every((item) => eventEndMinutes(item) <= start));
    const index = column < 0 ? columns.length : column;
    if (!columns[index]) columns[index] = [];
    columns[index].push(event);
    columnById.set(event.id, index);
  }

  function connectedCluster(seed: CalendarEvent): CalendarEvent[] {
    const cluster = [seed];
    for (const candidate of timed) {
      if (cluster.includes(candidate)) continue;
      if (cluster.some((item) => {
        const itemStart = minutesFromTime(item.startTime) ?? 0;
        const candidateStart = minutesFromTime(candidate.startTime) ?? 0;
        return itemStart < eventEndMinutes(candidate) && candidateStart < eventEndMinutes(item);
      })) cluster.push(candidate);
    }
    return cluster;
  }

  return events.map((event) => {
    if (minutesFromTime(event.startTime) === null) return { ...event, column: 0, columns: 1 };
    const cluster = connectedCluster(event);
    const columnCount = Math.max(...cluster.map((item) => (columnById.get(item.id) ?? 0) + 1));
    return { ...event, column: columnById.get(event.id) ?? 0, columns: columnCount };
  });
}
