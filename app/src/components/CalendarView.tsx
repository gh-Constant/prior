import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent } from "react";
import type { Habit } from "../types";
import { useI18n } from "../lib/i18n";
import {
  addDays,
  createGoogleCalendarSource,
  createIcsUrlSource,
  createImportedDemoSource,
  dateKey,
  eventsInRange,
  fetchIcsDocument,
  fetchGoogleCalendar,
  fetchGoogleCalendarList,
  isCalendarSourceDue,
  loadCalendarState,
  mondayOf,
  monthGrid,
  minutesFromTime,
  parseDateKey,
  positionOverlappingEvents,
  parseIcsCalendar,
  saveCalendarState,
  timeFromMinutes,
  type CalendarEvent,
  type CalendarRefreshInterval,
  type CalendarSource,
  type CalendarSourceType,
  type CalendarState,
  type CalendarViewMode,
} from "../lib/calendar";
import { CALENDAR_ACCOUNT_EVENT, listCalendarAccounts, makeGoogleCalendarTokenGetter, startGoogleCalendarConnect } from "../lib/calendarAuth";
import { getToken } from "../lib/auth";
import { getAccountId } from "../lib/accountScope";
import { generateUuid } from "../lib/uuid";
import { ACCOUNT_DATA_CHANGED, readAccountDocuments } from "../lib/accountDocuments";
import { Icon } from "./Icon";
import { Modal } from "./Modal";
import { createLocalCalendar, saveLocalEvent, deleteLocalEvent, normalizeCalendarText } from "../lib/calendarEvents";
import { useCalendarLabels } from "../lib/calendarLabels";
import { CalendarEventEditor, CalendarColors } from "./CalendarEventEditor";
import { CalendarSourceEditor } from "./CalendarSourceEditor";
import "./CalendarView.css";

type Props = { readonly habits: Habit[] };

const TIME_START = 0;
const TIME_END = 24 * 60;
const HOUR_HEIGHT = 64;
const WEEKDAY_KEYS = ["common.calendar.weekdays.monday", "common.calendar.weekdays.tuesday", "common.calendar.weekdays.wednesday", "common.calendar.weekdays.thursday", "common.calendar.weekdays.friday", "common.calendar.weekdays.saturday", "common.calendar.weekdays.sunday"] as const;
const IMPORT_OPTIONS = [
  { type: "google", icon: "google", labelKey: "common.calendar.import.google" } as const,
  ...(import.meta.env.DEV ? [{ type: "outlook", icon: "cloud", labelKey: "common.calendar.import.outlook" } as const] : []),
  { type: "ics", icon: "file", labelKey: "common.calendar.import.ics" } as const,
];

function isToday(value: string): boolean {
  return value === dateKey();
}

function dayLabel(value: Date, lang: string, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat(lang, options).format(value);
}

function formatTimeRange(event: CalendarEvent, lang: string): string {
  if (!event.startTime) return "";
  const start = new Date(`2020-01-01T${event.startTime}`);
  const end = event.endTime ? new Date(`2020-01-01T${event.endTime}`) : null;
  const format = new Intl.DateTimeFormat(lang, { hour: "numeric", minute: "2-digit" });
  return end ? `${format.format(start)} – ${format.format(end)}` : format.format(start);
}

function eventLabel(event: CalendarEvent, t: (key: string) => string): string {
  if (event.kind === "habit") return `${event.title} · ${t("common.calendar.habit")}`;
  return event.title;
}

function EventChip({ event, compact = false, onOpen }: { readonly event: CalendarEvent; readonly compact?: boolean; readonly onOpen: (event: CalendarEvent) => void }) {
  return (
    <button
      type="button"
      className={`calendar-event-chip ${compact ? "compact" : ""} ${event.kind === "habit" ? "habit" : ""} ${event.completed ? "completed" : ""}`.trim()}
      style={{ "--event-color": event.color } as CSSProperties}
      onClick={() => onOpen(event)}
      title={event.title}
    >
      <span className="calendar-event-dot" aria-hidden="true" />
      <span className="calendar-event-chip-title">{event.locked ? "🔒 " : ""}{event.title}</span>
      {event.startTime && <small>{event.startTime}</small>}
    </button>
  );
}

function WeekCalendar({ days, events, t, onOpen, onCreate }: { readonly days: Date[]; readonly events: CalendarEvent[]; readonly t: (key: string) => string; readonly onOpen: (event: CalendarEvent) => void; readonly onCreate: (date: string, time?: string) => void }) {
  const l = useCalendarLabels();
  const scroll = useRef<HTMLDivElement>(null);
  useEffect(() => { if (scroll.current) scroll.current.scrollTop = 7 * HOUR_HEIGHT; }, []);
  const eventByDate = useMemo(() => new Map(days.map((day) => [dateKey(day), events.filter((event) => event.date === dateKey(day))])), [days, events]);
  const timeLabels = Array.from({ length: 25 }, (_, index) => TIME_START + index * 60);
  return (
    <div className="calendar-week-scroll" ref={scroll}>
      <div className={`calendar-week-grid ${days.length === 1 ? "calendar-single-day" : ""}`} style={{ "--calendar-days": days.length } as CSSProperties}>
        <div className="calendar-week-header">
          <span className="calendar-time-gutter" />
          {days.map((day) => <div className={`calendar-day-heading ${isToday(dateKey(day)) ? "today" : ""}`} key={dateKey(day)}><span>{t(WEEKDAY_KEYS[(day.getDay() + 6) % 7])}</span><strong>{day.getDate()}</strong></div>)}
        </div>
        <div className="calendar-anytime-row">
          <span className="calendar-time-gutter">{t("common.calendar.anytime")}</span>
          {days.map((day) => {
            const anytime = eventByDate.get(dateKey(day))?.filter((event) => !event.startTime) ?? [];
            return <div className="calendar-anytime-cell" key={dateKey(day)}>{anytime.map((event) => <EventChip key={event.id} event={event} compact onOpen={onOpen} />)}</div>;
          })}
        </div>
        <div className="calendar-time-body">
          <div className="calendar-time-labels">{timeLabels.map((minutes) => <span key={minutes}>{minutes === TIME_END ? "24:00" : timeFromMinutes(minutes)}</span>)}</div>
          <div className="calendar-day-columns" style={{ "--calendar-hours": timeLabels.length - 1 } as CSSProperties}>
            {days.map((day) => {
              const timedEvents = positionOverlappingEvents(eventByDate.get(dateKey(day))?.filter((event) => event.startTime) ?? []);
              return (
                <div className={`calendar-day-column ${isToday(dateKey(day)) ? "today" : ""}`} key={dateKey(day)}>
                  <div className="calendar-grid-slots">{timeLabels.slice(0, -1).map((minutes) => <button type="button" key={minutes} aria-label={`${l.createAt} · ${dateKey(day)} ${timeFromMinutes(minutes)}`} onClick={() => onCreate(dateKey(day), timeFromMinutes(minutes))} />)}</div>
                  {timedEvents.map((event) => {
                    const start = Math.max(TIME_START, minutesFromTime(event.startTime) ?? TIME_START);
                    const end = Math.min(TIME_END, Math.max(start + 1, minutesFromTime(event.endTime) ?? start + 45));
                    return <button key={event.id} type="button" className={`calendar-timed-event ${event.kind === "habit" ? "habit" : ""} ${event.completed ? "completed" : ""}`} style={{ top: (start - TIME_START) * (HOUR_HEIGHT / 60), height: Math.max(30, (end - start) * (HOUR_HEIGHT / 60)), left: `calc(${(event.column / event.columns) * 100}% + 3px)`, width: `calc(${(100 / event.columns)}% - 6px)`, "--event-color": event.color } as CSSProperties} onClick={() => onOpen(event)} title={event.title}><strong>{event.locked ? "🔒 " : ""}{event.title}</strong><span>{event.startTime}{event.location ? ` · ${event.location}` : ""}</span></button>;
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function MonthCalendar({ days, events, onOpen, onCreate, onDay }: { readonly days: Date[]; readonly events: CalendarEvent[]; readonly onOpen: (event: CalendarEvent) => void; readonly onCreate: (date: string) => void; readonly onDay: (date: string) => void }) {
  const l = useCalendarLabels();
  return (
    <div className="calendar-month-shell"><div className="calendar-month-weekdays">{[1, 2, 3, 4, 5, 6, 0].map((day) => <span key={day}>{l.weekdays[day]}</span>)}</div><div className="calendar-month-grid">
      {days.map((day) => {
        const key = dateKey(day);
        const dayEvents = events.filter((event) => event.date === key);
        return <div className={`calendar-month-cell ${day.getMonth() !== days[15].getMonth() ? "outside" : ""} ${isToday(key) ? "today" : ""}`} key={key}>
          <div className="calendar-month-date"><span>{day.getDate()}</span><button type="button" aria-label={`${l.createAt} · ${key}`} onClick={() => onCreate(key)}>+</button></div>
          <div className="calendar-month-events">{dayEvents.slice(0, 4).map((event) => <EventChip key={event.id} event={event} compact onOpen={onOpen} />)}{dayEvents.length > 4 && <button type="button" className="calendar-more-events" onClick={() => onDay(key)}>+{dayEvents.length - 4} {l.more}</button>}</div>
        </div>;
      })}
    </div></div>
  );
}

function AgendaCalendar({ events, lang, t, onOpen }: { readonly events: CalendarEvent[]; readonly lang: string; readonly t: (key: string) => string; readonly onOpen: (event: CalendarEvent) => void }) {
  const grouped = events.reduce<Record<string, CalendarEvent[]>>((result, event) => { (result[event.date] ??= []).push(event); return result; }, {});
  const entries = Object.entries(grouped);
  return <div className="calendar-agenda">{entries.length === 0 ? <div className="calendar-empty-state"><Icon name="calendar-check" /><strong>{t("common.calendar.empty")}</strong><span>{t("common.calendar.emptyHint")}</span></div> : entries.map(([date, dayEvents]) => <section className="calendar-agenda-day" key={date}><div className="calendar-agenda-date"><strong>{dayLabel(parseDateKey(date), lang, { weekday: "long", day: "numeric", month: "long" })}</strong>{isToday(date) && <span>{t("common.calendar.today")}</span>}</div><div className="calendar-agenda-events">{dayEvents.map((event) => <button type="button" className="calendar-agenda-event" style={{ "--event-color": event.color } as CSSProperties} key={event.id} onClick={() => onOpen(event)}><span className="calendar-event-dot" /><span><strong>{event.title}</strong><small>{event.startTime ? formatTimeRange(event, lang) : t("common.calendar.anytime")}{event.location ? ` · ${event.location}` : ""}</small></span><Icon name="chevron-right" /></button>)}</div></section>)}</div>;
}

export function CalendarView({ habits }: Props) {
  const { t, lang } = useI18n();
  const l = useCalendarLabels();
  const [state, setState] = useState<CalendarState>(() => loadCalendarState());
  const stateRef = useRef(state);
  const [storageError, setStorageError] = useState("");
  const [query, setQuery] = useState("");
  const [editor, setEditor] = useState<{ initial: CalendarEvent; original?: CalendarEvent } | null>(null);
  const [sourceEditor, setSourceEditor] = useState<{ source: CalendarSource; isNew: boolean; thenCreate?: { date: string; time: string } } | null>(null);
  const [mode, setMode] = useState<CalendarViewMode>("week");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [anchorDate, setAnchorDate] = useState(() => new Date());
  const [importOpen, setImportOpen] = useState(false);
  const [importMode, setImportMode] = useState<"options" | "ics">("options");
  const [icsName, setIcsName] = useState("");
  const [icsUrl, setIcsUrl] = useState("");
  const [icsRefresh, setIcsRefresh] = useState<CalendarRefreshInterval>("hourly");
  const [icsError, setIcsError] = useState("");
  const [importError, setImportError] = useState("");
  const [syncingSourceId, setSyncingSourceId] = useState<string | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);
  const accountId = useRef(getAccountId());
  const [accountVersion, setAccountVersion] = useState(0);
  useEffect(() => {
    const refresh = () => {
      if (accountId.current !== getAccountId()) return;
      const next = loadCalendarState(); stateRef.current = next; setState(next);
    };
    window.addEventListener(ACCOUNT_DATA_CHANGED, refresh);
    window.addEventListener("storage", refresh);
    return () => { window.removeEventListener(ACCOUNT_DATA_CHANGED, refresh); window.removeEventListener("storage", refresh); };
  }, []);
  const activeSyncs = useRef(new Map<string, AbortController>());
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; for (const controller of activeSyncs.current.values()) controller.abort(); activeSyncs.current.clear(); };
  }, []);

  useEffect(() => {
    function resetAccount() {
      if (accountId.current === getAccountId()) return;
      accountId.current = getAccountId();
      setAccountVersion((value) => value + 1);
      const next = loadCalendarState();
      stateRef.current = next; setState(next);
      setEditor(null); setSourceEditor(null); setSelectedEvent(null); setImportOpen(false); setStorageError("");
    }
    window.addEventListener("prior-auth-change", resetAccount);
    return () => window.removeEventListener("prior-auth-change", resetAccount);
  }, []);

  const range = useMemo(() => {
    if (mode === "day") {
      const day = parseDateKey(dateKey(anchorDate));
      return { from: day, to: day, days: [day] };
    }
    if (mode === "month") {
      const days = monthGrid(anchorDate);
      return { from: days[0], to: days[days.length - 1], days };
    }
    const days = Array.from({ length: 7 }, (_, index) => addDays(mondayOf(anchorDate), index));
    return { from: days[0], to: days[days.length - 1], days };
  }, [anchorDate, mode]);
  const events = useMemo(() => eventsInRange(state, habits, range.from, range.to).filter((event) => normalizeCalendarText(`${event.title} ${event.location ?? ""} ${event.description ?? ""}`).includes(normalizeCalendarText(query))), [habits, range.from, range.to, state, query]);
  const rangeLabel = mode === "month"
    ? dayLabel(anchorDate, lang, { month: "long", year: "numeric" })
    : `${dayLabel(range.from, lang, { day: "numeric", month: "short" })} – ${dayLabel(range.to, lang, { day: "numeric", month: "short", year: "numeric" })}`;

  const updateState = useCallback((value: CalendarState | ((current: CalendarState) => CalendarState)): boolean => {
    try {
      if (!mounted.current || accountId.current !== getAccountId()) return false;
      const next = typeof value === "function" ? value(stateRef.current) : value;
      if (next === stateRef.current) return true;
      saveCalendarState(next);
      const saved = loadCalendarState();
      stateRef.current = saved;
      setState(saved);
      setStorageError("");
      return true;
    } catch {
      console.warn("Calendar could not be saved on this device.");
      setStorageError(l.storageError);
      return false;
    }
  }, [l.storageError]);

  function createEvent(date = dateKey(anchorDate), time = "10:00", sourceId?: string) {
    const source = stateRef.current.sources.find((item) => item.type === "local" && (!sourceId || item.id === sourceId));
    if (!source) { setSourceEditor({ source: createLocalCalendar(l.personal), isNew: true, thenCreate: { date, time } }); return; }
    setSelectedEvent(null);
    setEditor({ initial: { id: generateUuid(), sourceId: source.id, title: "", date, endDate: date,
      startTime: time, endTime: timeFromMinutes(Math.min(1439, (minutesFromTime(time) ?? 600) + 60)), color: source.color, kind: "event", locked: source.locked } });
  }

  function editEvent(event: CalendarEvent) {
    const source = state.sources.find((item) => item.id === event.sourceId);
    const original = source?.events.find((item) => item.id === (event.seriesId ?? event.id));
    if (source?.type !== "local" || !original) return;
    setSelectedEvent(null);
    setEditor({ initial: original, original: event });
  }

  function setEventPreference(event: CalendarEvent, patch: { hidden?: boolean; color?: string; locked?: boolean }) {
    const id = event.seriesId ?? event.id;
    const saved = updateState((current) => ({ ...current, sources: current.sources.map((source) => source.id === event.sourceId ? { ...source, eventOverrides: { ...source.eventOverrides, [id]: { ...source.eventOverrides?.[id], ...patch } } } : source) }));
    if (saved) setSelectedEvent(patch.hidden ? null : { ...event, color: "color" in patch ? patch.color || state.sources.find((source) => source.id === event.sourceId)?.color || event.color : event.color, locked: patch.locked ?? event.locked });
  }

  const syncRemoteSource = useCallback(async (source: CalendarSource, force = false) => {
    if (source.type === "ics" && !source.url) return;
    if (source.type === "google" && !source.accountId) return;
    if (source.type !== "ics" && source.type !== "google") return;
    if (!force && !isCalendarSourceDue(source)) return;
    const syncAccount = getAccountId();
    const syncKey = `${syncAccount}:${source.id}`;
    if (activeSyncs.current.has(syncKey)) return;
    const controller = new AbortController();
    activeSyncs.current.set(syncKey, controller);
    setSyncingSourceId(source.id);
    try {
      let events: CalendarEvent[];
      let icsData: string | undefined;
      if (source.type === "google") {
        const session = await getToken();
        if (!session || !source.accountId) throw new Error("sign-in-required");
        events = await fetchGoogleCalendar(makeGoogleCalendarTokenGetter(session, source.accountId), source.id, source.color, controller.signal, source.googleCalendarId, anchorDate);
      } else {
        const session = await getToken();
        if (!session && import.meta.env.DEV !== true) return;
        ({ events, icsData } = await fetchIcsDocument(source.url!, source.id, source.color, controller.signal, session ?? undefined));
      }
      if (syncAccount !== getAccountId()) return;
      updateState((current) => {
        const currentSource = current.sources.find((item) => item.id === source.id);
        if (!currentSource || currentSource.url !== source.url || currentSource.accountId !== source.accountId) return current;
        const next = {
          ...current,
          sources: current.sources.map((item) => item.id === source.id ? { ...item, events, icsData, coverageFrom: dateKey(addDays(anchorDate, -89)), coverageTo: dateKey(addDays(anchorDate, 364)), lastSyncedAt: new Date().toISOString(), syncError: undefined } : item),
        };
        return next;
      });
    } catch {
      if (controller.signal.aborted) return;
      console.warn("Calendar refresh failed; cached events were retained.");
      if (syncAccount !== getAccountId()) return;
      updateState((current) => {
        const currentSource = current.sources.find((item) => item.id === source.id);
        if (!currentSource || currentSource.url !== source.url || currentSource.accountId !== source.accountId) return current;
        const next = { ...current, sources: current.sources.map((item) => item.id === source.id ? { ...item, syncError: "sync-failed", lastSyncedAt: new Date().toISOString() } : item) };
        return next;
      });
    } finally {
      activeSyncs.current.delete(syncKey);
      setSyncingSourceId((current) => current === source.id ? null : current);
    }
  }, [updateState, anchorDate]);

  const syncGoogleAccounts = useCallback(async () => {
    const syncAccount = getAccountId();
    const session = await getToken();
    if (!session) return;
    let accounts;
    try {
      accounts = await listCalendarAccounts(session);
    } catch {
      return;
    }
    const discovered = await Promise.all(accounts.map(async (account) => {
      try { return { account, calendars: await fetchGoogleCalendarList(makeGoogleCalendarTokenGetter(session, account.id)) }; }
      catch { console.warn("Google calendar list unavailable; retaining existing calendars."); return { account, calendars: null }; }
    }));
    if (syncAccount !== getAccountId()) return;
    updateState((current) => {
      const accountIds = new Set(accounts.map((account) => account.id));
      const retained = current.sources.filter((source) => source.type !== "google" || (source.accountId && accountIds.has(source.accountId)));
      const nextSources = [...retained];
      for (const { account, calendars } of discovered) {
        if (current.ignoredGoogleAccountIds?.includes(account.id)) continue;
        for (const calendar of calendars ?? [{ id: "primary", primary: true, name: `Google Calendar · ${account.email}`, color: "#6e73d9" }]) {
          const base = createGoogleCalendarSource(account.id, account.email, nextSources.length);
          const stableId = calendar.primary ? base.id : `${base.id}-${encodeURIComponent(calendar.id)}`;
          if (current.ignoredGoogleAccountIds?.includes(stableId) || nextSources.some((source) => source.accountId === account.id && (source.googleCalendarId === calendar.id || (calendar.primary && !source.googleCalendarId)))) continue;
          const id = readAccountDocuments().records[`calendar/source/${encodeURIComponent(stableId)}`] === null ? `${stableId}-${generateUuid()}` : stableId;
          nextSources.push({ ...base, id, googleCalendarId: calendar.id, googleCalendarKey: stableId, name: calendar.name, color: calendar.color });
        }
      }
      if (nextSources.length === current.sources.length && nextSources.every((source, index) => source === current.sources[index])) return current;
      const next = { ...current, sources: nextSources };
      return next;
    });
  }, [updateState]);

  useEffect(() => {
    void syncGoogleAccounts();
    const refresh = () => { updateState((current) => ({ ...current, ignoredGoogleAccountIds: [] })); void syncGoogleAccounts(); };
    window.addEventListener(CALENDAR_ACCOUNT_EVENT, refresh);
    return () => window.removeEventListener(CALENDAR_ACCOUNT_EVENT, refresh);
  }, [syncGoogleAccounts, updateState, accountVersion]);

  useEffect(() => {
    const remoteSources = state.sources.filter((source) => (source.type === "ics" && source.url) || (source.type === "google" && source.accountId));
    remoteSources.filter((source) => isCalendarSourceDue(source)).forEach((source) => { void syncRemoteSource(source); });
    const timer = window.setInterval(() => {
      remoteSources.filter((source) => isCalendarSourceDue(source, new Date())).forEach((source) => { void syncRemoteSource(source); });
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [state.sources, syncRemoteSource]);

  useEffect(() => {
    for (const source of state.sources) {
      if (source.type === "google" && source.enabled && (!source.coverageFrom || !source.coverageTo || source.coverageFrom > dateKey(range.from) || source.coverageTo < dateKey(range.to))) {
        if (!source.syncError) void syncRemoteSource(source, true);
      }
    }
  }, [range.from, range.to, state.sources, syncRemoteSource]);

  function moveRange(amount: number) {
    setAnchorDate((current) => mode === "month" ? new Date(current.getFullYear(), current.getMonth() + amount, 1) : addDays(current, amount * (mode === "day" ? 1 : 7)));
    setSelectedEvent(null);
  }

  function openImport(): void {
    setImportMode("options");
    setIcsError("");
    setImportError("");
    setImportOpen(true);
  }

  function closeImport(): void {
    setImportOpen(false);
    setImportMode("options");
    setIcsError("");
    setImportError("");
  }

  async function addCalendar(type: Exclude<CalendarSourceType, "demo" | "local">): Promise<void> {
    if (type === "ics") {
      setImportMode("ics");
      setIcsError("");
      return;
    }
    if (type === "google") {
      setImportError("");
      closeImport();
      try {
        await startGoogleCalendarConnect();
      } catch {
        setImportError(t("common.calendar.import.googleError"));
        setImportMode("options");
        setImportOpen(true);
      }
      return;
    }
    if (type === "outlook" && import.meta.env.DEV === true) {
      const source = createImportedDemoSource(type, anchorDate, state.sources.length);
      updateState({ ...state, sources: [...state.sources, source] });
      closeImport();
    }
  }

  async function addIcsCalendar(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const importAccount = getAccountId();
    const trimmedUrl = icsUrl.trim();
    try {
      const parsedUrl = new URL(trimmedUrl);
      if (!/^https?:$/.test(parsedUrl.protocol)) throw new Error("invalid-url");
    } catch {
      setIcsError(t("common.calendar.import.icsInvalidUrl"));
      return;
    }
    const source = createIcsUrlSource(icsName, trimmedUrl, icsRefresh, state.sources.length);
    setIcsError("");
    setSyncingSourceId(source.id);
    try {
      const session = await getToken();
      if (!session && import.meta.env.DEV !== true) {
        setIcsError(t("common.calendar.import.icsAuthRequired"));
        return;
      }
      const { events, icsData } = await fetchIcsDocument(trimmedUrl, source.id, source.color, undefined, session ?? undefined);
      if (importAccount !== getAccountId()) return;
      if (!updateState((current) => ({ ...current, sources: [...current.sources, { ...source, events, icsData, lastSyncedAt: new Date().toISOString() }] }))) return;
      setIcsName("");
      setIcsUrl("");
      closeImport();
    } catch {
      setIcsError(t("common.calendar.import.icsError"));
    } finally {
      setSyncingSourceId(null);
    }
  }

  return (
    <section className="calendar-page" aria-label={t("common.views.calendar")}>
      <div className="calendar-toolbar">
        <div className="calendar-navigation"><button type="button" className="calendar-icon-button" aria-label={t("common.calendar.previous")} onClick={() => moveRange(-1)}><Icon name="chevron-left" /></button><button type="button" className="calendar-range-label" onClick={() => setAnchorDate(new Date())}>{rangeLabel}</button><button type="button" className="calendar-icon-button" aria-label={t("common.calendar.next")} onClick={() => moveRange(1)}><Icon name="chevron-right" /></button><button type="button" className="calendar-today-button" onClick={() => setAnchorDate(new Date())}>{t("common.calendar.today")}</button></div>
        <div className="calendar-toolbar-actions"><div className="calendar-view-switch" role="tablist" aria-label={t("common.calendar.viewMode")}>
          {(["day", "week", "month", "agenda"] as const).map((option) => <button type="button" role="tab" aria-selected={mode === option} className={mode === option ? "active" : ""} key={option} onClick={() => setMode(option)}>{option === "day" ? (lang === "fr" ? "Jour" : "Day") : t(`common.calendar.views.${option}`)}</button>)}
        </div><button type="button" className="primary-button calendar-add-button" onClick={() => createEvent()}><Icon name="plus" /><span>{l.newEvent}</span></button></div>
      </div>

      {storageError && <p role="alert" className="calendar-import-error">{storageError}</p>}
      <div className="calendar-tools">
        <button type="button" className={`calendar-sources-toggle${sidebarOpen ? " active" : ""}`} aria-expanded={sidebarOpen} onClick={() => setSidebarOpen((value) => !value)}>
          <Icon name="calendar-check" /><span>{t("common.calendar.sourcesTitle")}</span><em>{state.sources.length}</em>
        </button>
        <button type="button" role="switch" aria-checked={state.showHabits} aria-label={t("common.calendar.habitsTitle")} className={`calendar-habits-toggle${state.showHabits ? " on" : ""}`} onClick={() => updateState({ ...state, showHabits: !state.showHabits })}>
          <span className="calendar-toggle-dot" aria-hidden="true" /><span>{t("common.calendar.habitsTitle")}</span>
        </button>
        <input type="search" aria-label={l.search} placeholder={l.search} value={query} onChange={(event) => setQuery(event.target.value)} /><label>{l.jump}<input type="date" value={dateKey(anchorDate)} onChange={(event) => { if (event.target.value) setAnchorDate(parseDateKey(event.target.value)); }} /></label>
      </div>
      <div className={`calendar-layout${sidebarOpen ? "" : " sidebar-collapsed"}`}>
        {sidebarOpen && <aside className="calendar-sidebar" aria-label={t("common.calendar.sourcesLabel")}>
          <div className="calendar-sidebar-section"><div className="calendar-sidebar-heading"><h2>{t("common.calendar.sourcesTitle")}</h2><span>{state.sources.length}</span></div>
            {(["local", "imported"] as const).map((group) => <div className="calendar-source-group" key={group}><h3>{group === "local" ? l.personal : l.imported}</h3><div className="calendar-sources">{state.sources.filter((source) => (source.type === "local") === (group === "local")).map((source) => <div className="calendar-source-item" key={source.id}><button type="button" className={`calendar-source-row ${source.enabled ? "enabled" : "disabled"}`} aria-pressed={source.enabled} onClick={() => updateState({ ...state, sources: state.sources.map((item) => item.id === source.id ? { ...item, enabled: !item.enabled } : item) })}><span className="calendar-source-swatch" style={{ background: source.color }} /><span className="calendar-source-copy"><strong>{source.name}</strong>{source.syncError && <small title={l.syncError}>!</small>}</span><span className="calendar-source-check">{source.enabled && <Icon name="check" />}</span></button><button type="button" className="calendar-icon-button" aria-label={`${l.settings} · ${source.name}`} onClick={() => setSourceEditor({ source, isNew: false })}>···</button></div>)}</div></div>)}
            <button type="button" className="calendar-sidebar-add" onClick={() => setSourceEditor({ source: createLocalCalendar(l.personal), isNew: true })}><Icon name="plus" />{l.newCalendar}</button>
            <button type="button" className="calendar-sidebar-add" onClick={openImport}><Icon name="plus" />{t("common.calendar.importAnother")}</button>
          </div>
        </aside>}
        <div className="calendar-board">
          {(mode === "week" || mode === "day") && <WeekCalendar days={range.days} events={events} t={t} onOpen={setSelectedEvent} onCreate={createEvent} />}
          {mode === "month" && <MonthCalendar days={range.days} events={events} onOpen={setSelectedEvent} onCreate={createEvent} onDay={(date) => { setAnchorDate(parseDateKey(date)); setMode("day"); }} />}
          {mode === "agenda" && <AgendaCalendar events={events} lang={lang} t={t} onOpen={setSelectedEvent} />}

        </div>
      </div>


      {selectedEvent && <Modal title={selectedEvent.title} onClose={() => setSelectedEvent(null)} className="calendar-editor-modal"><div className="calendar-editor-form">
        <div className="calendar-detail-heading"><span style={{ background: selectedEvent.color }} className="calendar-source-swatch" /><strong>{eventLabel(selectedEvent, t)}</strong></div>
        <p>{dayLabel(parseDateKey(selectedEvent.date), lang, { dateStyle: "full" })} · {formatTimeRange(selectedEvent, lang) || l.allDay}</p>
        {selectedEvent.location && <p>{selectedEvent.location}</p>}{selectedEvent.description && <p className="calendar-description">{selectedEvent.description}</p>}
        {selectedEvent.kind !== "habit" && (state.sources.find((source) => source.id === selectedEvent.sourceId)?.type === "local" ? <>
          <p>{state.sources.find((source) => source.id === selectedEvent.sourceId)?.name}{selectedEvent.locked ? ` · 🔒 ${l.locked}` : ""}</p>
          <button type="button" className="primary-button" onClick={() => editEvent(selectedEvent)}>{l.editEvent}</button>
          <button type="button" className="secondary-button" onClick={() => { const original = state.sources.find((source) => source.id === selectedEvent.sourceId)?.events.find((event) => event.id === selectedEvent.seriesId); if (original) { setEditor({ initial: { ...original, id: generateUuid(), excludedDates: undefined } }); setSelectedEvent(null); } }}>{l.duplicate}</button>
        </> : <>
          <strong>{l.readOnly}</strong><p>{l.readOnlyHint}</p>
          <CalendarColors value={state.sources.find((source) => source.id === selectedEvent.sourceId)?.eventOverrides?.[selectedEvent.seriesId ?? selectedEvent.id]?.color ?? ""} defaultOption onChange={(color) => setEventPreference(selectedEvent, { color: color || undefined })} />
          <label className="calendar-checkbox"><input type="checkbox" checked={selectedEvent.locked ?? false} disabled={state.sources.find((source) => source.id === selectedEvent.sourceId)?.locked} onChange={(event) => setEventPreference(selectedEvent, { locked: event.target.checked })} />{l.locked}</label><small>{l.lockHint}</small>
          <button type="button" className="secondary-button" onClick={() => setEventPreference(selectedEvent, { hidden: true })}>{l.hide}</button>
        </>)}
      </div></Modal>}
      {editor && <CalendarEventEditor initial={editor.initial} editing={editor.original} sources={state.sources} onClose={() => setEditor(null)} onSave={(draft, scope) => { const saved = updateState((current) => saveLocalEvent(current, draft, editor.original, scope)); if (saved) setAnchorDate(parseDateKey(draft.date)); return saved; }} onDelete={editor.original ? (scope) => updateState((current) => deleteLocalEvent(current, editor.original!, scope)) : undefined} />}
      {sourceEditor && <CalendarSourceEditor initial={sourceEditor.source} isNew={sourceEditor.isNew} onClose={() => setSourceEditor(null)} syncing={syncingSourceId === sourceEditor.source.id} onRefresh={() => void syncRemoteSource(sourceEditor.source, true)} onSave={(source) => {
        const saved = updateState((current) => ({ ...current, sources: sourceEditor.isNew ? [...current.sources, source] : current.sources.map((item) => item.id === source.id ? { ...source, events: item.events, icsData: item.icsData, coverageFrom: item.coverageFrom, coverageTo: item.coverageTo, lastSyncedAt: item.lastSyncedAt, syncError: item.syncError } : item) }));
        if (saved && sourceEditor.thenCreate) createEvent(sourceEditor.thenCreate.date, sourceEditor.thenCreate.time, source.id);
        return saved;
      }} onRemove={() => updateState((current) => ({ ...current, ignoredGoogleAccountIds: sourceEditor.source.accountId ? [...(current.ignoredGoogleAccountIds ?? []), sourceEditor.source.googleCalendarKey ?? sourceEditor.source.id] : current.ignoredGoogleAccountIds, sources: current.sources.filter((source) => source.id !== sourceEditor.source.id) }))} />}
      {importOpen && <Modal title={t("common.calendar.importTitle")} onClose={closeImport} className="calendar-import-modal">
        {importMode === "options" ? <div className="calendar-import-body">{importError && <p className="calendar-import-error" role="alert">{importError}</p>}<div className="calendar-import-options"><label className="calendar-file-import">{l.file}<input type="file" accept=".ics,text/calendar" onChange={async (event) => { const file = event.target.files?.[0]; const importAccount = getAccountId(); if (!file) return; try { if (file.size > 8000000) throw new Error("large-file"); const source = createIcsUrlSource(file.name.replace(/\.ics$/i, ""), "", "hourly", state.sources.length); source.icsData = await file.text(); if (importAccount !== getAccountId()) return; source.events = parseIcsCalendar(source.icsData, source.id, source.color); if (updateState((current) => ({ ...current, sources: [...current.sources, source] }))) closeImport(); } catch { setImportError(l.fileError); } }} /></label>{IMPORT_OPTIONS.map((option) => <button type="button" className="calendar-import-option" key={option.type} onClick={() => { void addCalendar(option.type); }}><span className="calendar-import-option-icon"><Icon name={option.icon} /></span><span><strong>{t(option.labelKey)}</strong></span><Icon name="chevron-right" /></button>)}</div></div> : <form className="calendar-import-form" onSubmit={(event) => { void addIcsCalendar(event); }}>
          <label htmlFor="calendar-ics-name"><span>{t("common.modal.name")}</span><input id="calendar-ics-name" value={icsName} onChange={(event) => setIcsName(event.target.value)} placeholder="IUT INFO" /></label>
          <label htmlFor="calendar-ics-url"><span>{t("common.calendar.import.icsUrl")}</span><input id="calendar-ics-url" type="url" required value={icsUrl} onChange={(event) => setIcsUrl(event.target.value)} placeholder="https://…" /></label>
          <label htmlFor="calendar-ics-refresh"><span>{t("common.calendar.import.icsRefresh")}</span><select id="calendar-ics-refresh" value={icsRefresh} onChange={(event) => setIcsRefresh(event.target.value as CalendarRefreshInterval)}><option value="15m">{t("common.calendar.import.every15m")}</option><option value="hourly">{t("common.calendar.import.everyHour")}</option><option value="daily">{t("common.calendar.import.everyDay")}</option></select></label>
          {icsError && <p className="calendar-import-error" role="alert">{icsError}</p>}
          <div className="calendar-import-actions"><button type="button" className="secondary-button" onClick={() => setImportMode("options")}>{t("common.actions.cancel")}</button><button type="submit" className="primary-button" disabled={syncingSourceId !== null}>{syncingSourceId ? t("common.actions.loading") : t("common.calendar.import.icsAdd")}</button></div>
        </form>}
      </Modal>}
    </section>
  );
}
