import type { CalendarEvent, CalendarSource, CalendarState } from "./calendar";
import { readAccountDocuments, stageDocument, writeAccountDocuments, type AccountDocuments, type DocumentValue } from "./accountDocuments";
import { readScopedStorage, removeScopedStorage } from "./accountScope";

function flatten(state: CalendarState): Record<string, DocumentValue> {
  const records: Record<string, DocumentValue> = { "calendar/options": { showHabits: state.showHabits, ignoredGoogleAccountIds: state.ignoredGoogleAccountIds ?? [] } };
  for (const source of state.sources) {
    if (source.type === "demo" || source.type === "outlook" || source.type === "icloud") continue;
    const prefix = `calendar/source/${encodeURIComponent(source.id)}`;
    const { events, lastSyncedAt: _last, syncError: _error, coverageFrom: _from, coverageTo: _to, hiddenTitles, eventOverrides, icsData, ...metadata } = source;
    records[prefix] = { ...metadata, ...(!source.url && icsData ? { icsData } : {}) };
    if (source.type === "local") for (const event of events) records[`calendar/event/${encodeURIComponent(source.id)}/${encodeURIComponent(event.id)}`] = { ...event };
    for (const rule of hiddenTitles ?? []) records[`calendar/rule/${encodeURIComponent(source.id)}/${encodeURIComponent(rule)}`] = { sourceId: source.id, rule, enabled: true };
    for (const [eventId, preference] of Object.entries(eventOverrides ?? {})) records[`calendar/override/${encodeURIComponent(source.id)}/${encodeURIComponent(eventId)}`] = { sourceId: source.id, eventId, ...preference, enabled: true };
  }
  return JSON.parse(JSON.stringify(records)) as Record<string, DocumentValue>;
}

export function calendarFromDocuments(documents: AccountDocuments): CalendarState {
  const options = documents.records["calendar/options"];
  const sources: CalendarSource[] = [];
  for (const [key, value] of Object.entries(documents.records)) {
    if (!key.startsWith("calendar/source/")) continue;
    if (!value) continue;
    const source = value as unknown as CalendarSource;
    if (!source.id || !["local", "ics", "google"].includes(source.type)) continue;
    const cache = documents.calendarCache?.[source.id] as CalendarSource | undefined;
    const reusable = cache?.url === source.url && cache?.accountId === source.accountId && cache?.googleCalendarId === source.googleCalendarId;
    sources.push({ ...(reusable ? cache : {}), ...source, events: source.type === "local" ? [] : reusable ? cache?.events ?? [] : [], hiddenTitles: [], eventOverrides: {} });
  }
  const byId = new Map(sources.map((source) => [source.id, source]));
  for (const [key, value] of Object.entries(documents.records)) {
    if (!value || value.enabled === false) continue;
    const source = byId.get(String(value.sourceId));
    if (!source) continue;
    if (key.startsWith("calendar/event/") && source.type === "local") source.events.push(value as unknown as CalendarEvent);
    if (key.startsWith("calendar/rule/") && typeof value.rule === "string") source.hiddenTitles!.push(value.rule);
    if (key.startsWith("calendar/override/") && typeof value.eventId === "string") source.eventOverrides![value.eventId] = { hidden: value.hidden === true, locked: typeof value.locked === "boolean" ? value.locked : undefined, color: typeof value.color === "string" ? value.color : undefined };
  }
  return { sources, showHabits: options?.showHabits !== false, ignoredGoogleAccountIds: Array.isArray(options?.ignoredGoogleAccountIds) ? options.ignoredGoogleAccountIds as string[] : [] };
}

export function persistCalendarForSync(next: CalendarState, legacy: CalendarState): void {
  const documents = readAccountDocuments();
  if (!documents.calendarMigrated) {
    for (const [key, value] of Object.entries(flatten(legacy))) stageDocument(documents, key, value, true);
    documents.calendarMigrated = true;
  }
  const previous = flatten(calendarFromDocuments(documents));
  const desired = flatten(next);
  for (const key of new Set([...Object.keys(previous), ...Object.keys(desired)])) {
    const removedPreference = !desired[key] && (key.startsWith("calendar/rule/") || key.startsWith("calendar/override/"));
    stageDocument(documents, key, desired[key] ?? (removedPreference ? { ...documents.records[key], enabled: false } : null));
  }
  documents.calendarCache = Object.fromEntries(next.sources.filter((source) => source.type !== "local").map((source) => [source.id, source]));
  writeAccountDocuments(documents, true, () => removeScopedStorage("prior.calendar.v1"));
}

export function initializeCalendarSync(legacy: CalendarState): void {
  const documents = readAccountDocuments();
  if (!documents.calendarMigrated) { persistCalendarForSync(legacy, legacy); return; }
  if (!readScopedStorage("prior.calendar.v1")) return;
  for (const [key, value] of Object.entries(flatten(legacy))) stageDocument(documents, key, value, true);
  writeAccountDocuments(documents, true, () => removeScopedStorage("prior.calendar.v1"));
}
