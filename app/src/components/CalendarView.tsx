import { useCallback, useEffect, useMemo, useState, type CSSProperties, type FormEvent } from "react";
import type { Habit } from "../types";
import { useI18n } from "../lib/i18n";
import {
  addDays,
  createIcsUrlSource,
  createImportedDemoSource,
  dateKey,
  eventsInRange,
  fetchIcsCalendar,
  isCalendarSourceDue,
  loadCalendarState,
  mondayOf,
  monthGrid,
  minutesFromTime,
  parseDateKey,
  positionOverlappingEvents,
  saveCalendarState,
  timeFromMinutes,
  type CalendarEvent,
  type CalendarRefreshInterval,
  type CalendarSource,
  type CalendarSourceType,
  type CalendarState,
  type CalendarViewMode,
} from "../lib/calendar";
import { Icon } from "./Icon";
import { Modal } from "./Modal";
import "./CalendarView.css";

type Props = { readonly habits: Habit[] };

const TIME_START = 7 * 60;
const TIME_END = 22 * 60;
const HOUR_HEIGHT = 64;
const WEEKDAY_KEYS = ["common.calendar.weekdays.monday", "common.calendar.weekdays.tuesday", "common.calendar.weekdays.wednesday", "common.calendar.weekdays.thursday", "common.calendar.weekdays.friday", "common.calendar.weekdays.saturday", "common.calendar.weekdays.sunday"] as const;
const IMPORT_OPTIONS: Array<{ type: Exclude<CalendarSourceType, "demo">; icon: "google" | "cloud" | "file"; labelKey: string }> = [
  { type: "google", icon: "google", labelKey: "common.calendar.import.google" },
  { type: "outlook", icon: "cloud", labelKey: "common.calendar.import.outlook" },
  { type: "ics", icon: "file", labelKey: "common.calendar.import.ics" },
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
      <span className="calendar-event-chip-title">{event.title}</span>
      {event.startTime && <small>{event.startTime}</small>}
    </button>
  );
}

function WeekCalendar({ days, events, t, onOpen }: { readonly days: Date[]; readonly events: CalendarEvent[]; readonly t: (key: string) => string; readonly onOpen: (event: CalendarEvent) => void }) {
  const eventByDate = useMemo(() => new Map(days.map((day) => [dateKey(day), events.filter((event) => event.date === dateKey(day))])), [days, events]);
  const timeLabels = Array.from({ length: 16 }, (_, index) => TIME_START + index * 60);
  return (
    <div className="calendar-week-scroll">
      <div className="calendar-week-grid">
        <div className="calendar-week-header">
          <span className="calendar-time-gutter" />
          {days.map((day, index) => <div className={`calendar-day-heading ${isToday(dateKey(day)) ? "today" : ""}`} key={dateKey(day)}><span>{t(WEEKDAY_KEYS[index])}</span><strong>{day.getDate()}</strong></div>)}
        </div>
        <div className="calendar-anytime-row">
          <span className="calendar-time-gutter">{t("common.calendar.anytime")}</span>
          {days.map((day) => {
            const anytime = eventByDate.get(dateKey(day))?.filter((event) => !event.startTime) ?? [];
            return <div className="calendar-anytime-cell" key={dateKey(day)}>{anytime.map((event) => <EventChip key={event.id} event={event} compact onOpen={onOpen} />)}</div>;
          })}
        </div>
        <div className="calendar-time-body">
          <div className="calendar-time-labels">{timeLabels.map((minutes) => <span key={minutes}>{timeFromMinutes(minutes)}</span>)}</div>
          <div className="calendar-day-columns" style={{ "--calendar-hours": timeLabels.length - 1 } as CSSProperties}>
            {days.map((day) => {
              const timedEvents = positionOverlappingEvents(eventByDate.get(dateKey(day))?.filter((event) => event.startTime) ?? []);
              return (
                <div className={`calendar-day-column ${isToday(dateKey(day)) ? "today" : ""}`} key={dateKey(day)}>
                  <div className="calendar-grid-lines" aria-hidden="true">{timeLabels.slice(0, -1).map((minutes) => <span key={minutes} />)}</div>
                  {timedEvents.map((event) => {
                    const start = Math.max(TIME_START, minutesFromTime(event.startTime) ?? TIME_START);
                    const end = Math.min(TIME_END, Math.max(start + 30, minutesFromTime(event.endTime) ?? start + 45));
                    return <button key={event.id} type="button" className={`calendar-timed-event ${event.kind === "habit" ? "habit" : ""} ${event.completed ? "completed" : ""}`} style={{ top: (start - TIME_START) * (HOUR_HEIGHT / 60), height: Math.max(30, (end - start) * (HOUR_HEIGHT / 60)), left: `calc(${(event.column / event.columns) * 100}% + 3px)`, width: `calc(${(100 / event.columns)}% - 6px)`, "--event-color": event.color } as CSSProperties} onClick={() => onOpen(event)} title={event.title}><strong>{event.title}</strong><span>{event.startTime}{event.location ? ` · ${event.location}` : ""}</span></button>;
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

function MonthCalendar({ days, events, onOpen }: { readonly days: Date[]; readonly events: CalendarEvent[]; readonly onOpen: (event: CalendarEvent) => void }) {
  return (
    <div className="calendar-month-grid">
      {days.map((day) => {
        const key = dateKey(day);
        const dayEvents = events.filter((event) => event.date === key);
        return <div className={`calendar-month-cell ${day.getMonth() !== days[15].getMonth() ? "outside" : ""} ${isToday(key) ? "today" : ""}`} key={key}>
          <div className="calendar-month-date"><span>{day.getDate()}</span>{isToday(key) && <small>Today</small>}</div>
          <div className="calendar-month-events">{dayEvents.slice(0, 4).map((event) => <EventChip key={event.id} event={event} compact onOpen={onOpen} />)}{dayEvents.length > 4 && <span className="calendar-more-events">+{dayEvents.length - 4} more</span>}</div>
        </div>;
      })}
    </div>
  );
}

function AgendaCalendar({ events, lang, t, onOpen }: { readonly events: CalendarEvent[]; readonly lang: string; readonly t: (key: string) => string; readonly onOpen: (event: CalendarEvent) => void }) {
  const grouped = events.reduce<Record<string, CalendarEvent[]>>((result, event) => { (result[event.date] ??= []).push(event); return result; }, {});
  const entries = Object.entries(grouped);
  return <div className="calendar-agenda">{entries.length === 0 ? <div className="calendar-empty-state"><Icon name="calendar-check" /><strong>{t("common.calendar.empty")}</strong><span>{t("common.calendar.emptyHint")}</span></div> : entries.map(([date, dayEvents]) => <section className="calendar-agenda-day" key={date}><div className="calendar-agenda-date"><strong>{dayLabel(parseDateKey(date), lang, { weekday: "long", day: "numeric", month: "long" })}</strong>{isToday(date) && <span>{t("common.calendar.today")}</span>}</div><div className="calendar-agenda-events">{dayEvents.map((event) => <button type="button" className="calendar-agenda-event" style={{ "--event-color": event.color } as CSSProperties} key={event.id} onClick={() => onOpen(event)}><span className="calendar-event-dot" /><span><strong>{event.title}</strong><small>{event.startTime ? formatTimeRange(event, lang) : t("common.calendar.anytime")}{event.location ? ` · ${event.location}` : ""}</small></span><Icon name="chevron-right" /></button>)}</div></section>)}</div>;
}

export function CalendarView({ habits }: Props) {
  const { t, lang } = useI18n();
  const [state, setState] = useState<CalendarState>(() => loadCalendarState());
  const [mode, setMode] = useState<CalendarViewMode>("week");
  const [anchorDate, setAnchorDate] = useState(() => new Date());
  const [importOpen, setImportOpen] = useState(false);
  const [importMode, setImportMode] = useState<"options" | "ics">("options");
  const [icsName, setIcsName] = useState("");
  const [icsUrl, setIcsUrl] = useState("");
  const [icsRefresh, setIcsRefresh] = useState<CalendarRefreshInterval>("hourly");
  const [icsError, setIcsError] = useState("");
  const [syncingSourceId, setSyncingSourceId] = useState<string | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);

  const range = useMemo(() => {
    if (mode === "month") {
      const days = monthGrid(anchorDate);
      return { from: days[0], to: days[days.length - 1], days };
    }
    const days = Array.from({ length: 7 }, (_, index) => addDays(mondayOf(anchorDate), index));
    return { from: days[0], to: days[days.length - 1], days };
  }, [anchorDate, mode]);
  const events = useMemo(() => eventsInRange(state, habits, range.from, range.to), [habits, range.from, range.to, state]);
  const rangeLabel = mode === "month"
    ? dayLabel(anchorDate, lang, { month: "long", year: "numeric" })
    : `${dayLabel(range.from, lang, { day: "numeric", month: "short" })} – ${dayLabel(range.to, lang, { day: "numeric", month: "short", year: "numeric" })}`;

  function updateState(next: CalendarState) {
    setState(next);
    saveCalendarState(next);
  }

  const syncIcsSource = useCallback(async (source: CalendarSource, force = false) => {
    if (!source.url || (!force && !isCalendarSourceDue(source))) return;
    setSyncingSourceId(source.id);
    try {
      const events = await fetchIcsCalendar(source.url, source.id, source.color);
      setState((current) => {
        const currentSource = current.sources.find((item) => item.id === source.id);
        if (!currentSource || currentSource.url !== source.url) return current;
        const next = {
          ...current,
          sources: current.sources.map((item) => item.id === source.id ? { ...item, events, lastSyncedAt: new Date().toISOString(), syncError: undefined } : item),
        };
        saveCalendarState(next);
        return next;
      });
    } catch {
      setState((current) => {
        const currentSource = current.sources.find((item) => item.id === source.id);
        if (!currentSource || currentSource.url !== source.url) return current;
        const next = { ...current, sources: current.sources.map((item) => item.id === source.id ? { ...item, syncError: "sync-failed", lastSyncedAt: new Date().toISOString() } : item) };
        saveCalendarState(next);
        return next;
      });
    } finally {
      setSyncingSourceId((current) => current === source.id ? null : current);
    }
  }, []);

  useEffect(() => {
    const remoteSources = state.sources.filter((source) => source.type === "ics" && source.url);
    remoteSources.filter((source) => isCalendarSourceDue(source)).forEach((source) => { void syncIcsSource(source); });
    const timer = window.setInterval(() => {
      remoteSources.filter((source) => isCalendarSourceDue(source, new Date())).forEach((source) => { void syncIcsSource(source); });
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [state.sources, syncIcsSource]);

  function moveRange(amount: number) {
    setAnchorDate((current) => mode === "month" ? new Date(current.getFullYear(), current.getMonth() + amount, 1) : addDays(current, amount * 7));
    setSelectedEvent(null);
  }

  function openImport(): void {
    setImportMode("options");
    setIcsError("");
    setImportOpen(true);
  }

  function closeImport(): void {
    setImportOpen(false);
    setImportMode("options");
    setIcsError("");
  }

  function addCalendar(type: Exclude<CalendarSourceType, "demo">) {
    if (type === "ics") {
      setImportMode("ics");
      setIcsError("");
      return;
    }
    const source = createImportedDemoSource(type, anchorDate, state.sources.length);
    updateState({ ...state, sources: [...state.sources, source] });
    closeImport();
  }

  async function addIcsCalendar(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
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
      const events = await fetchIcsCalendar(trimmedUrl, source.id, source.color);
      updateState({ ...state, sources: [...state.sources, { ...source, events, lastSyncedAt: new Date().toISOString() }] });
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
          {(["week", "month", "agenda"] as const).map((option) => <button type="button" role="tab" aria-selected={mode === option} className={mode === option ? "active" : ""} key={option} onClick={() => setMode(option)}>{t(`common.calendar.views.${option}`)}</button>)}
        </div><button type="button" className="primary-button calendar-add-button" onClick={openImport}><Icon name="plus" /><span>{t("common.calendar.addCalendar")}</span></button></div>
      </div>

      <div className="calendar-layout">
        <aside className="calendar-sidebar" aria-label={t("common.calendar.sourcesLabel")}>
          <div className="calendar-sidebar-section"><div className="calendar-sidebar-heading"><h2>{t("common.calendar.sourcesTitle")}</h2><span>{state.sources.length}</span></div>
            <div className="calendar-sources">{state.sources.map((source) => <button type="button" className={`calendar-source-row ${source.enabled ? "enabled" : "disabled"}`} key={source.id} aria-pressed={source.enabled} onClick={() => updateState({ ...state, sources: state.sources.map((item) => item.id === source.id ? { ...item, enabled: !item.enabled } : item) })}><span className="calendar-source-swatch" style={{ background: source.color }} /><span className="calendar-source-copy"><strong>{source.name}</strong></span><span className="calendar-source-check">{source.enabled && <Icon name="check" />}</span></button>)}</div>
            <button type="button" className="calendar-sidebar-add" onClick={openImport}><Icon name="plus" />{t("common.calendar.importAnother")}</button>
          </div>
          <div className="calendar-sidebar-section calendar-habit-section"><div className="calendar-habit-toggle-row"><h2>{t("common.calendar.habitsTitle")}</h2><button type="button" role="switch" aria-label={state.showHabits ? t("common.calendar.showHabits") : t("common.calendar.hideHabits")} aria-checked={state.showHabits} className={`calendar-toggle ${state.showHabits ? "on" : ""}`} onClick={() => updateState({ ...state, showHabits: !state.showHabits })}><span /></button></div></div>
        </aside>
        <div className="calendar-board">
          {mode === "week" && <WeekCalendar days={range.days} events={events} t={t} onOpen={setSelectedEvent} />}
          {mode === "month" && <MonthCalendar days={range.days} events={events} onOpen={setSelectedEvent} />}
          {mode === "agenda" && <AgendaCalendar events={events} lang={lang} t={t} onOpen={setSelectedEvent} />}
          {selectedEvent && <div className="calendar-event-detail" role="dialog" aria-label={selectedEvent.title}><div className="calendar-event-detail-color" style={{ background: selectedEvent.color }} /><div className="calendar-event-detail-copy"><strong>{eventLabel(selectedEvent, t)}</strong><span>{formatTimeRange(selectedEvent, lang) || t("common.calendar.anytime")}</span>{selectedEvent.location && <span>{selectedEvent.location}</span>}</div><button type="button" className="calendar-icon-button" aria-label={t("common.actions.close")} onClick={() => setSelectedEvent(null)}><Icon name="close" /></button></div>}
        </div>
      </div>

      {importOpen && <Modal title={t("common.calendar.importTitle")} onClose={closeImport} className="calendar-import-modal">
        {importMode === "options" ? <div className="calendar-import-body"><div className="calendar-import-options">{IMPORT_OPTIONS.map((option) => <button type="button" className="calendar-import-option" key={option.type} onClick={() => addCalendar(option.type)}><span className="calendar-import-option-icon"><Icon name={option.icon} /></span><span><strong>{t(option.labelKey)}</strong></span><Icon name="chevron-right" /></button>)}</div></div> : <form className="calendar-import-form" onSubmit={(event) => { void addIcsCalendar(event); }}>
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
