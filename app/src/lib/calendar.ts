import type { Habit } from "../types";
import { readScopedStorage, writeScopedStorage } from "./accountScope";
import { API_URL } from "./api";
import { habitOccurrenceDates } from "./habits";
import { expandCalendarEvent, presentImportedEvent } from "./calendarEvents";
import { parseIcsCalendar } from "./calendarIcs";
import { readAccountDocuments } from "./accountDocuments";
import { calendarFromDocuments, persistCalendarForSync, initializeCalendarSync } from "./calendarSync";

export type CalendarViewMode = "day" | "week" | "month" | "agenda";
export type CalendarSourceType = "local" | "demo" | "google" | "outlook" | "icloud" | "ics";
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
  description?: string;
  endDate?: string;
  locked?: boolean;
  customColor?: string;
  recurrence?: { frequency: "daily" | "weekly" | "monthly" | "yearly"; interval: number; weekdays?: number[]; until?: string; count?: number };
  excludedDates?: string[];
  seriesId?: string;
  occurrenceDate?: string;
};

export type CalendarSource = {
  id: string;
  name: string;
  type: CalendarSourceType;
  accountId?: string;
  googleCalendarId?: string;
  googleCalendarKey?: string;
  color: string;
  enabled: boolean;
  events: CalendarEvent[];
  url?: string;
  icsData?: string;
  refreshInterval?: CalendarRefreshInterval;
  lastSyncedAt?: string;
  coverageFrom?: string;
  coverageTo?: string;
  syncError?: string;
  description?: string;
  locked?: boolean;
  hiddenTitles?: string[];
  eventOverrides?: Record<string, { hidden?: boolean; color?: string; locked?: boolean }>;
};

export type CalendarState = {
  sources: CalendarSource[];
  showHabits: boolean;
  ignoredGoogleAccountIds?: string[];
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

const EMPTY_CALENDAR_STATE: CalendarState = { showHabits: true, sources: [] };

function isDevelopmentBuild(): boolean {
  try {
    return import.meta.env.DEV === true;
  } catch {
    return false;
  }
}

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

export function createImportedDemoSource(type: Exclude<CalendarSourceType, "demo" | "local">, reference = new Date(), index = 0): CalendarSource {
  const labels: Record<Exclude<CalendarSourceType, "demo" | "local">, { name: string; title: string }> = {
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

export function createGoogleCalendarSource(accountId: string, email: string, index = 0): CalendarSource {
  return {
    id: `calendar-google-${accountId}`,
    name: email ? `Google Calendar · ${email}` : "Google Calendar",
    type: "google",
    accountId,
    color: CALENDAR_COLORS[index % CALENDAR_COLORS.length],
    enabled: true,
    events: [],
    refreshInterval: "hourly",
  };
}

export function isCalendarSourceDue(source: CalendarSource, now = new Date()): boolean {
  if (source.type === "ics" && !source.url) return false;
  if (source.type === "google" && !source.accountId) return false;
  if (source.type !== "ics" && source.type !== "google") return false;
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

function sanitizeCalendarState(state: CalendarState): CalendarState {
  return {
    showHabits: state.showHabits,
    ignoredGoogleAccountIds: state.ignoredGoogleAccountIds,
    // Demo/provider fixtures are useful in local development only. Google
    // sources are production-safe only when they carry a server account id;
    // Outlook and iCloud remain development placeholders for now.
    sources: state.sources
      .filter((source) => source && Array.isArray(source.events))
      .filter((source) => isDevelopmentBuild() || (
        source.type !== "demo" &&
        source.type !== "outlook" &&
        source.type !== "icloud" &&
        (source.type !== "google" || Boolean(source.accountId))
      ))
      .map((source) => ({
        ...source,
        enabled: source.enabled !== false,
        refreshInterval: (source.type === "ics" && source.url) || (source.type === "google" && source.accountId) ? source.refreshInterval ?? "hourly" : source.refreshInterval,
      })),
  };
}

function isCalendarState(value: unknown): value is CalendarState {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<CalendarState>;
  return Array.isArray(candidate.sources) && typeof candidate.showHabits === "boolean";
}

export function loadCalendarState(): CalendarState {
  const documents = readAccountDocuments();
  if (documents.calendarMigrated) {
    if (readScopedStorage(CALENDAR_STORAGE_KEY)) initializeCalendarSync(loadLegacyCalendarState());
    return calendarFromDocuments(readAccountDocuments());
  }
  return loadLegacyCalendarState();
}

export function loadLegacyCalendarState(): CalendarState {
  if (typeof window === "undefined") return isDevelopmentBuild() ? createDemoCalendarState() : EMPTY_CALENDAR_STATE;
  try {
    const raw = readScopedStorage(CALENDAR_STORAGE_KEY);
    if (!raw) return isDevelopmentBuild() ? createDemoCalendarState() : EMPTY_CALENDAR_STATE;
    const parsed: unknown = JSON.parse(raw);
    if (!isCalendarState(parsed)) return isDevelopmentBuild() ? createDemoCalendarState() : EMPTY_CALENDAR_STATE;
    const sanitized = sanitizeCalendarState(parsed);
    if (JSON.stringify(sanitized) !== JSON.stringify(parsed)) writeScopedStorage(CALENDAR_STORAGE_KEY, JSON.stringify(sanitized));
    return sanitized;
  } catch {
    return isDevelopmentBuild() ? createDemoCalendarState() : EMPTY_CALENDAR_STATE;
  }
}

export function saveCalendarState(state: CalendarState): void {
  // Let the UI report quota / storage failures instead of claiming a save succeeded.
  if (typeof localStorage === "undefined") throw new Error("Calendar storage unavailable");
  persistCalendarForSync(sanitizeCalendarState(state), loadLegacyCalendarState());
}

export { parseIcsCalendar } from "./calendarIcs";

export async function fetchIcsCalendar(url: string, sourceId: string, color: string, signal?: AbortSignal, sessionToken?: string): Promise<CalendarEvent[]> {
  return (await fetchIcsDocument(url, sourceId, color, signal, sessionToken)).events;
}

export async function fetchIcsDocument(url: string, sourceId: string, color: string, signal?: AbortSignal, sessionToken?: string): Promise<{ events: CalendarEvent[]; icsData: string }> {
  const response = sessionToken
    ? await fetch(`${API_URL}/v1/calendar/ics`, {
      method: "POST",
      cache: "no-store",
      headers: { Accept: "text/calendar, text/plain;q=0.9, */*;q=0.1", "Content-Type": "application/json", Authorization: `Bearer ${sessionToken}` },
      body: JSON.stringify({ url }),
      signal,
    })
    : await fetch(url, { cache: "no-store", headers: { Accept: "text/calendar, text/plain;q=0.9, */*;q=0.1" }, signal });
  if (!response.ok) throw new Error(`Calendar returned ${response.status}`);
  const body = await response.text();
  if (body.length > 8_000_000) throw new Error("Calendar is too large");
  return { events: parseIcsCalendar(body, sourceId, color), icsData: body };
}

type GoogleCalendarDate = { date?: string; dateTime?: string };
type GoogleCalendarItem = {
  id?: string;
  status?: string;
  summary?: string;
  location?: string;
  description?: string;
  start?: GoogleCalendarDate;
  end?: GoogleCalendarDate;
};

export type CalendarTokenGetter = () => Promise<string>;

function parseGoogleCalendarDate(value: GoogleCalendarDate | undefined): { date: string; time: string | null } | null {
  if (value?.date) {
    const parsed = parseDateKey(value.date);
    return dateKey(parsed) === value.date ? { date: value.date, time: null } : null;
  }
  if (!value?.dateTime) return null;
  const parsed = new Date(value.dateTime);
  if (!Number.isFinite(parsed.getTime())) return null;
  return { date: dateKey(parsed), time: timeFromMinutes(parsed.getHours() * 60 + parsed.getMinutes()) };
}

function googleCalendarEvent(item: GoogleCalendarItem, sourceId: string, color: string, index: number): CalendarEvent | null {
  if (item.status === "cancelled") return null;
  const start = parseGoogleCalendarDate(item.start);
  if (!start) return null;
  const end = parseGoogleCalendarDate(item.end);
  return {
    id: `${sourceId}-${item.id ?? index}`.replace(/[^a-zA-Z0-9._:-]/g, "-"),
    sourceId,
    title: item.summary?.trim() || "Google Calendar event",
    date: start.date,
    startTime: start.time,
    endTime: end?.time ?? null,
    endDate: end ? (start.time === null && end.date > start.date ? dateKey(addDays(parseDateKey(end.date), -1)) : end.date) : start.date,
    color,
    location: item.location?.trim() || undefined,
    description: item.description,
    kind: "event",
  };
}

/** Read the selected Google calendar for a broad rolling window. A broad
 * window keeps navigation between week, month and agenda views local after a
 * sync while the hourly refresh keeps the data current. */
export async function fetchGoogleCalendar(getToken: CalendarTokenGetter, sourceId: string, color: string, signal?: AbortSignal, calendarId = "primary", reference = new Date()): Promise<CalendarEvent[]> {
  const token = await getToken();
  const from = new Date(reference);
  from.setDate(from.getDate() - 90);
  from.setHours(0, 0, 0, 0);
  const to = new Date(reference);
  to.setFullYear(to.getFullYear() + 1);
  to.setHours(23, 59, 59, 999);
  const events: CalendarEvent[] = [];
  let pageToken = "";
  do {
    const url = new URL(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`);
    url.searchParams.set("singleEvents", "true");
    url.searchParams.set("orderBy", "startTime");
    url.searchParams.set("showDeleted", "false");
    url.searchParams.set("maxResults", "2500");
    url.searchParams.set("timeMin", from.toISOString());
    url.searchParams.set("timeMax", to.toISOString());
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const response = await fetch(url, {
      cache: "no-store",
      signal,
      headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
    });
    if (!response.ok) throw new Error(`Google Calendar returned ${response.status}`);
    const body = (await response.json()) as { items?: GoogleCalendarItem[]; nextPageToken?: string };
    for (const [index, item] of (body.items ?? []).entries()) {
      const event = googleCalendarEvent(item, sourceId, color, events.length + index);
      if (event) events.push(event);
    }
    pageToken = body.nextPageToken ?? "";
  } while (pageToken);
  return events;
}

export async function fetchGoogleCalendarList(getToken: CalendarTokenGetter): Promise<Array<{ id: string; name: string; color: string; primary: boolean }>> {
  const token = await getToken();
  const calendars: Array<{ id: string; name: string; color: string; primary: boolean }> = [];
  let pageToken = "";
  do {
    const url = new URL("https://www.googleapis.com/calendar/v3/users/me/calendarList");
    url.searchParams.set("maxResults", "250");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) throw new Error("Calendar list could not be loaded");
    const body = await response.json() as { items?: Array<{ id: string; summary: string; backgroundColor?: string; primary?: boolean }>; nextPageToken?: string };
    calendars.push(...(body.items ?? []).map((item) => ({ id: item.id, name: item.summary, color: /^#[0-9a-f]{6}$/i.test(item.backgroundColor ?? "") ? item.backgroundColor! : CALENDAR_COLORS[0], primary: Boolean(item.primary) })));
    pageToken = body.nextPageToken ?? "";
  } while (pageToken);
  return calendars;
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
  const enabledEvents = state.sources.filter((source) => source.enabled).flatMap((source) => {
    let sourceEvents = source.events;
    if (source.icsData) {
      try { sourceEvents = parseIcsCalendar(source.icsData, source.id, source.color, from, { from, to }); }
      catch { console.warn("Calendar recurrence expansion failed; using cached events."); }
    }
    return sourceEvents.flatMap((event) => {
      const visible = presentImportedEvent(source, event);
      return visible ? expandCalendarEvent(visible, from, to) : [];
    });
  });
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
