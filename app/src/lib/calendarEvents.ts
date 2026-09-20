import type { CalendarEvent, CalendarSource, CalendarState } from "./calendar";
import { addDays, dateKey, minutesFromTime, mondayOf, parseDateKey } from "./calendar";
import { generateUuid } from "./uuid";

export function createLocalCalendar(name: string, color = "#6e73d9"): CalendarSource {
  if (!name.trim()) throw new Error("calendarName");
  return { id: generateUuid(), name: name.trim(), color, type: "local", enabled: true, events: [] };
}

export function validCalendarDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && value >= "1900-01-01" && value <= "2200-12-31" && dateKey(parseDateKey(value)) === value;
}

export function validateCalendarEvent(event: CalendarEvent): string | null {
  if (!event.title.trim()) return "titleRequired";
  if (!validCalendarDate(event.date) || !validCalendarDate(event.endDate ?? event.date)) return "invalidDate";
  const endDate = event.endDate ?? event.date;
  if (endDate < event.date) return "invalidEnd";
  if (event.startTime !== null && (minutesFromTime(event.startTime) === null || minutesFromTime(event.endTime) === null || (endDate === event.date && event.endTime! <= event.startTime))) return "invalidEnd";
  if (event.startTime === null && event.endTime !== null) return "invalidEnd";
  const rule = event.recurrence;
  if (rule) {
    if (!["daily", "weekly", "monthly", "yearly"].includes(rule.frequency) || !Number.isInteger(rule.interval) || rule.interval < 1 || rule.interval > 365) return "invalidRecurrence";
    if (rule.until && (!validCalendarDate(rule.until) || rule.until < event.date)) return "invalidRecurrence";
    if (rule.count !== undefined && (!Number.isInteger(rule.count) || rule.count < 1 || rule.count > 10000)) return "invalidRecurrence";
    if (rule.weekdays?.some((day) => !Number.isInteger(day) || day < 0 || day > 6)) return "invalidRecurrence";
    if (rule.frequency === "weekly" && !rule.weekdays?.length) return "invalidRecurrence";
  }
  return null;
}

function dayNumber(date: Date): number {
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000;
}

export function normalizeCalendarText(text: string): string {
  return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase().trim();
}

export function matchesHiddenTitle(title: string, rule: string): boolean {
  const query = normalizeCalendarText(rule);
  return Boolean(query) && normalizeCalendarText(title).includes(query);
}

/** Presentation preferences never mutate imported provider data. */
export function presentImportedEvent(source: CalendarSource, event: CalendarEvent): CalendarEvent | null {
  const override = source.eventOverrides?.[event.id];
  if (override?.hidden || (source.type !== "local" && source.hiddenTitles?.some((rule) => matchesHiddenTitle(event.title, rule)))) return null;
  return { ...event, color: override?.color ?? event.customColor ?? source.color, locked: source.locked || (override?.locked ?? event.locked ?? false) };
}

/** Expand in civil days so a weekly 10:00 event stays at 10:00 across DST. */
export function expandCalendarEvent(event: CalendarEvent, from: Date, to: Date): CalendarEvent[] {
  const start = parseDateKey(event.date);
  if (!validCalendarDate(event.date)) return [];
  const durationDays = Math.max(0, dayNumber(parseDateKey(event.endDate ?? event.date)) - dayNumber(start));
  const rule = event.recurrence;
  const result: CalendarEvent[] = [];
  let count = 0;
  const last = rule ? to : start;
  for (let cursor = start; cursor <= last; cursor = addDays(cursor, 1)) {
    const key = dateKey(cursor);
    if (rule?.until && key > rule.until) break;
    if (rule) {
      const days = dayNumber(cursor) - dayNumber(start);
      const weeks = (dayNumber(mondayOf(cursor)) - dayNumber(mondayOf(start))) / 7;
      const months = (cursor.getFullYear() - start.getFullYear()) * 12 + cursor.getMonth() - start.getMonth();
      const occurs = rule.frequency === "daily" ? days % rule.interval === 0
        : rule.frequency === "weekly" ? weeks % rule.interval === 0 && (rule.weekdays ?? [start.getDay()]).includes(cursor.getDay())
        : rule.frequency === "monthly" ? months % rule.interval === 0 && cursor.getDate() === start.getDate()
        : (cursor.getFullYear() - start.getFullYear()) % rule.interval === 0 && cursor.getMonth() === start.getMonth() && cursor.getDate() === start.getDate();
      if (!occurs) continue;
    }
    count++;
    if (rule?.count && count > rule.count) break;
    if (event.excludedDates?.includes(key)) continue;
    // Split overnight and multi-day events into visible day segments.
    const end = addDays(cursor, durationDays);
    const visibleStart = cursor < from ? from : cursor;
    const visibleEnd = end > to ? to : end;
    for (let day = visibleStart; day <= visibleEnd; day = addDays(day, 1)) {
      const dayKey = dateKey(day);
      if (durationDays > 0 && dayKey === dateKey(end) && event.endTime === "00:00") continue;
      result.push({ ...event, id: `${event.id}@${key}/${dayKey}`, seriesId: event.id, occurrenceDate: key, date: dayKey,
        endDate: dateKey(end), startTime: event.startTime === null ? null : dayKey === key ? event.startTime : "00:00",
        endTime: event.startTime === null ? null : dayKey === dateKey(end) ? event.endTime : "23:59" });
    }
  }
  return result;
}

export type EventEditScope = "series" | "occurrence";

export function saveLocalEvent(state: CalendarState, draft: CalendarEvent, original?: CalendarEvent, scope: EventEditScope = "series"): CalendarState {
  const error = validateCalendarEvent(draft);
  if (error) throw new Error(error);
  if (!state.sources.some((source) => source.id === draft.sourceId && source.type === "local")) throw new Error("readOnly");
  if (original && !state.sources.some((source) => source.id === original.sourceId && source.type === "local")) throw new Error("readOnly");
  const originalId = original?.seriesId ?? original?.id;
  const occurrence = scope === "occurrence" && original?.occurrenceDate;
  const saved = { ...draft, title: draft.title.trim(), id: occurrence ? generateUuid() : originalId ?? draft.id, seriesId: undefined, occurrenceDate: undefined,
    recurrence: occurrence ? undefined : draft.recurrence, excludedDates: occurrence ? undefined : draft.excludedDates };
  return { ...state, sources: state.sources.map((source) => ({ ...source, events: [
    ...source.events.flatMap((event) => {
      if (source.id !== original?.sourceId || event.id !== originalId) return [event];
      return occurrence ? [{ ...event, excludedDates: [...(event.excludedDates ?? []), occurrence] }] : [];
    }),
    ...(source.id === saved.sourceId ? [saved] : []),
  ] })) };
}

export function deleteLocalEvent(state: CalendarState, original: CalendarEvent, scope: EventEditScope): CalendarState {
  return { ...state, sources: state.sources.map((source) => source.id !== original.sourceId || source.type !== "local" ? source : {
    ...source, events: source.events.flatMap((event) => {
      if (event.id !== (original.seriesId ?? original.id)) return [event];
      return scope === "occurrence" && original.occurrenceDate && event.recurrence
        ? [{ ...event, excludedDates: [...(event.excludedDates ?? []), original.occurrenceDate] }] : [];
    }),
  }) };
}
