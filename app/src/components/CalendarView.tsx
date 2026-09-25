import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent, type MouseEvent as ReactMouseEvent } from "react";
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
type Translate = (key: string) => string;

const DAY_MINUTES = 24 * 60;
/** Height of one hour row in the time grid, in pixels (one pixel per minute). */
const HOUR_HEIGHT = 60;
const PX_PER_MINUTE = HOUR_HEIGHT / 60;
/** Breathing room above 00:00 so the first hour label is never clipped. */
const GRID_TOP_PAD = 8;
/** Events shorter than this render on a single line ("Title · 09:00"). */
const SHORT_EVENT_MINUTES = 40;
/** Minimum rendered duration, so very short events stay clickable and readable. */
const MIN_EVENT_MINUTES = 22;
const MONTH_VISIBLE_EVENTS = 3;
const WEEKDAY_KEYS = ["common.calendar.weekdays.monday", "common.calendar.weekdays.tuesday", "common.calendar.weekdays.wednesday", "common.calendar.weekdays.thursday", "common.calendar.weekdays.friday", "common.calendar.weekdays.saturday", "common.calendar.weekdays.sunday"] as const;
const VIEW_MODES = ["day", "week", "month", "agenda"] as const;
const IMPORT_OPTIONS = [
  { type: "google", icon: "google", labelKey: "common.calendar.import.google" } as const,
  ...(import.meta.env.DEV ? [{ type: "outlook", icon: "cloud", labelKey: "common.calendar.import.outlook" } as const] : []),
  { type: "ics", icon: "file", labelKey: "common.calendar.import.ics" } as const,
];

function dayLabel(value: Date, lang: string, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat(lang, options).format(value);
}

function capitalize(value: string, lang: string): string {
  return value ? value.charAt(0).toLocaleUpperCase(lang) + value.slice(1) : value;
}

function isWeekend(day: Date): boolean {
  return day.getDay() === 0 || day.getDay() === 6;
}

function firstOfMonth(value: Date): Date {
  return new Date(value.getFullYear(), value.getMonth(), 1);
}

function isoWeek(value: Date): number {
  const date = new Date(Date.UTC(value.getFullYear(), value.getMonth(), value.getDate()));
  const weekday = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - weekday);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil(((date.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
}

function uses12HourClock(lang: string): boolean {
  try { return new Intl.DateTimeFormat(lang, { hour: "numeric" }).resolvedOptions().hour12 === true; }
  catch { return false; }
}

function hourLabel(hour: number, lang: string, twelveHour: boolean): string {
  if (!twelveHour) return timeFromMinutes(hour * 60);
  return new Intl.DateTimeFormat(lang, { hour: "numeric" }).format(new Date(2020, 0, 1, hour));
}

function formatClock(time: string | null, lang: string): string {
  if (!time) return "";
  return new Intl.DateTimeFormat(lang, { hour: "numeric", minute: "2-digit" }).format(new Date(`2020-01-01T${time}`));
}

function formatTimeRange(event: CalendarEvent, lang: string): string {
  if (!event.startTime) return "";
  return event.endTime ? `${formatClock(event.startTime, lang)} – ${formatClock(event.endTime, lang)}` : formatClock(event.startTime, lang);
}

function eventLabel(event: CalendarEvent, t: Translate): string {
  if (event.kind === "habit") return `${event.title} · ${t("common.calendar.habit")}`;
  return event.title;
}

function dayModeLabel(lang: string): string {
  try {
    const label = new Intl.DisplayNames(lang, { type: "dateTimeField" }).of("day");
    if (label) return capitalize(label, lang);
  } catch { /* Older engines: fall back below. */ }
  return lang === "fr" ? "Jour" : "Day";
}

function groupByDate(events: CalendarEvent[]): Map<string, CalendarEvent[]> {
  const map = new Map<string, CalendarEvent[]>();
  for (const event of events) {
    const list = map.get(event.date);
    if (list) list.push(event); else map.set(event.date, [event]);
  }
  return map;
}

function eventClasses(base: string, event: CalendarEvent): string {
  return `${base}${event.kind === "habit" ? " is-habit" : ""}${event.completed ? " is-done" : ""}`;
}

/** Re-renders once per minute, aligned to the minute boundary, for the now indicator. */
function useMinuteClock(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    let interval: number | undefined;
    const timeout = window.setTimeout(() => {
      setNow(new Date());
      interval = window.setInterval(() => setNow(new Date()), 60_000);
    }, 60_000 - (Date.now() % 60_000));
    return () => { window.clearTimeout(timeout); window.clearInterval(interval); };
  }, []);
  return now;
}

type LaidOutEvent = { readonly event: CalendarEvent; readonly start: number; readonly end: number; readonly column: number; readonly columns: number };

/**
 * Side-by-side layout for timed events of one day. Events are split into
 * collision groups (chains of visually overlapping events); every event of a
 * group gets the first free column and the group's column count, so
 * overlapping events share the width equally instead of cascading.
 */
function layoutDayEvents(events: CalendarEvent[]): LaidOutEvent[] {
  const items = events
    .map((event) => {
      const start = Math.min(DAY_MINUTES - 1, Math.max(0, minutesFromTime(event.startTime) ?? 0));
      const end = Math.min(DAY_MINUTES, Math.max(start + 1, minutesFromTime(event.endTime) ?? start + 45));
      return { event, start, end, visualEnd: Math.min(DAY_MINUTES, Math.max(end, start + MIN_EVENT_MINUTES)) };
    })
    .sort((left, right) => left.start - right.start || right.end - left.end);
  const result: LaidOutEvent[] = [];
  let group: { event: CalendarEvent; start: number; end: number; column: number }[] = [];
  let columnEnds: number[] = [];
  let groupEnd = -1;
  const flush = () => {
    for (const item of group) result.push({ ...item, columns: columnEnds.length });
    group = []; columnEnds = []; groupEnd = -1;
  };
  for (const item of items) {
    if (group.length > 0 && item.start >= groupEnd) flush();
    let column = columnEnds.findIndex((columnEnd) => columnEnd <= item.start);
    if (column < 0) { column = columnEnds.length; columnEnds.push(item.visualEnd); }
    else columnEnds[column] = item.visualEnd;
    group.push({ event: item.event, start: item.start, end: item.end, column });
    groupEnd = Math.max(groupEnd, item.visualEnd);
  }
  flush();
  return result;
}

function slotTime(event: ReactMouseEvent<HTMLButtonElement>, hour: number): string {
  const rect = event.currentTarget.getBoundingClientRect();
  const lowerHalf = event.detail > 0 && rect.height > 0 && event.clientY - rect.top >= rect.height / 2;
  return timeFromMinutes(hour * 60 + (lowerHalf ? 30 : 0));
}

function EventPill({ event, lang, t, showTime = false, onOpen }: { readonly event: CalendarEvent; readonly lang: string; readonly t: Translate; readonly showTime?: boolean; readonly onOpen: (event: CalendarEvent) => void }) {
  const time = formatTimeRange(event, lang);
  return (
    <button
      type="button"
      className={eventClasses(`cal-pill${event.startTime ? " is-timed" : ""}`, event)}
      style={{ "--event-color": event.color } as CSSProperties}
      onClick={() => onOpen(event)}
      title={time ? `${event.title} · ${time}` : event.title}
      aria-label={time ? `${eventLabel(event, t)} · ${time}` : eventLabel(event, t)}
    >
      <span className="cal-pill-dot" aria-hidden="true" />
      <span className="cal-pill-title">{event.locked && <Icon name="lock" className="cal-lock" aria-hidden="true" />}{event.title}</span>
      {showTime && event.startTime && <span className="cal-pill-time">{formatClock(event.startTime, lang)}</span>}
    </button>
  );
}

function TimedEvent({ item, lang, t, onOpen }: { readonly item: LaidOutEvent; readonly lang: string; readonly t: Translate; readonly onOpen: (event: CalendarEvent) => void }) {
  const { event, start, end, column, columns } = item;
  const duration = end - start;
  const short = duration < SHORT_EVENT_MINUTES;
  const range = formatTimeRange(event, lang);
  const detail = short ? formatClock(event.startTime, lang) : `${range}${event.location ? ` · ${event.location}` : ""}`;
  return (
    <button
      type="button"
      className={eventClasses(`cal-event${short ? " is-short" : ""}`, event)}
      style={{ top: start * PX_PER_MINUTE, height: Math.max(MIN_EVENT_MINUTES, duration) * PX_PER_MINUTE - 1, "--event-color": event.color, "--col": column, "--cols": columns } as CSSProperties}
      onClick={() => onOpen(event)}
      title={`${event.title} · ${range}${event.location ? ` · ${event.location}` : ""}`}
      aria-label={`${eventLabel(event, t)} · ${range}${event.location ? ` · ${event.location}` : ""}`}
    >
      <span className="cal-event-title">{event.locked && <Icon name="lock" className="cal-lock" aria-hidden="true" />}{event.title}</span>
      <span className="cal-event-time">{detail}</span>
    </button>
  );
}

type TimeGridProps = {
  readonly days: Date[];
  readonly events: CalendarEvent[];
  readonly now: Date;
  readonly lang: string;
  readonly t: Translate;
  readonly onOpen: (event: CalendarEvent) => void;
  readonly onCreate: (date: string, time?: string) => void;
  readonly onDay?: (date: string) => void;
};

function TimeGrid({ days, events, now, lang, t, onOpen, onCreate, onDay }: TimeGridProps) {
  const l = useCalendarLabels();
  const scroll = useRef<HTMLDivElement>(null);
  const todayKey = dateKey(now);
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const showsToday = days.some((day) => dateKey(day) === todayKey);
  const initialMinute = useRef(showsToday ? Math.max(0, nowMinutes - 60) : 8 * 60);
  useEffect(() => {
    if (scroll.current) scroll.current.scrollTop = GRID_TOP_PAD + initialMinute.current * PX_PER_MINUTE;
  }, []);
  const byDate = useMemo(() => groupByDate(events), [events]);
  const twelveHour = useMemo(() => uses12HourClock(lang), [lang]);
  const hours = Array.from({ length: 24 }, (_, hour) => hour);
  return (
    <div className="cal-time-scroll" ref={scroll}>
      <div className={`cal-time-grid${days.length === 1 ? " is-single" : ""}`} style={{ "--cal-days": days.length, "--hour-h": `${HOUR_HEIGHT}px` } as CSSProperties}>
        <div className="cal-dayhead-row">
          <div className="cal-corner" aria-hidden="true" />
          {days.map((day) => {
            const key = dateKey(day);
            const className = `cal-dayhead${key === todayKey ? " is-today" : ""}${isWeekend(day) ? " is-weekend" : ""}`;
            const content = <><span className="cal-dayhead-weekday">{t(WEEKDAY_KEYS[(day.getDay() + 6) % 7])}</span><span className="cal-dayhead-date">{day.getDate()}</span></>;
            return onDay
              ? <button type="button" className={className} key={key} aria-label={dayLabel(day, lang, { dateStyle: "full" })} onClick={() => onDay(key)}>{content}</button>
              : <div className={className} key={key}>{content}</div>;
          })}
        </div>
        <div className="cal-allday-row">
          <div className="cal-gutter cal-allday-label">{t("common.calendar.anytime")}</div>
          {days.map((day) => {
            const key = dateKey(day);
            const anytime = byDate.get(key)?.filter((event) => !event.startTime) ?? [];
            return <div className={`cal-allday-cell${isWeekend(day) ? " is-weekend" : ""}`} key={key}>{anytime.map((event) => <EventPill key={event.id} event={event} lang={lang} t={t} onOpen={onOpen} />)}</div>;
          })}
        </div>
        <div className="cal-time-body">
          <div className="cal-gutter cal-hours" aria-hidden="true">
            {hours.map((hour) => <span key={hour} style={{ top: hour * HOUR_HEIGHT }}>{hourLabel(hour, lang, twelveHour)}</span>)}
            {showsToday && <span className="cal-now-label" style={{ top: nowMinutes * PX_PER_MINUTE }}>{formatClock(timeFromMinutes(nowMinutes), lang)}</span>}
          </div>
          {days.map((day) => {
            const key = dateKey(day);
            const timed = layoutDayEvents(byDate.get(key)?.filter((event) => event.startTime && minutesFromTime(event.startTime) !== null) ?? []);
            return (
              <div className={`cal-day-col${key === todayKey ? " is-today" : ""}${isWeekend(day) ? " is-weekend" : ""}`} key={key}>
                {hours.map((hour) => <button type="button" className="cal-slot" key={hour} aria-label={`${l.createAt} · ${key} ${timeFromMinutes(hour * 60)}`} onClick={(event) => onCreate(key, slotTime(event, hour))} />)}
                {timed.map((item) => <TimedEvent key={item.event.id} item={item} lang={lang} t={t} onOpen={onOpen} />)}
                {key === todayKey && <div className="cal-now" style={{ top: nowMinutes * PX_PER_MINUTE }} aria-hidden="true" />}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

type MonthGridProps = {
  readonly days: Date[];
  readonly anchor: Date;
  readonly events: CalendarEvent[];
  readonly now: Date;
  readonly lang: string;
  readonly t: Translate;
  readonly onOpen: (event: CalendarEvent) => void;
  readonly onCreate: (date: string) => void;
  readonly onDay: (date: string) => void;
};

function MonthGrid({ days, anchor, events, now, lang, t, onOpen, onCreate, onDay }: MonthGridProps) {
  const l = useCalendarLabels();
  const byDate = useMemo(() => groupByDate(events), [events]);
  const todayKey = dateKey(now);
  const month = anchor.getMonth();
  // Drop trailing weeks that sit entirely in the next month so rows fill the height.
  let visible = days;
  while (visible.length > 28 && visible.slice(-7).every((day) => day.getMonth() !== month)) visible = visible.slice(0, -7);
  return (
    <div className="cal-month">
      <div className="cal-month-head" aria-hidden="true">{WEEKDAY_KEYS.map((key) => <span key={key}>{t(key)}</span>)}</div>
      <div className="cal-month-grid" style={{ "--cal-weeks": visible.length / 7 } as CSSProperties}>
        {visible.map((day) => {
          const key = dateKey(day);
          const dayEvents = [...(byDate.get(key) ?? [])].sort((left, right) => Number(Boolean(left.startTime)) - Number(Boolean(right.startTime)));
          const hidden = dayEvents.length - MONTH_VISIBLE_EVENTS;
          return (
            <div className={`cal-month-cell${day.getMonth() !== month ? " is-outside" : ""}${key === todayKey ? " is-today" : ""}${isWeekend(day) ? " is-weekend" : ""}`} key={key}>
              <div className="cal-month-cell-head">
                <button type="button" className="cal-month-num" aria-label={dayLabel(day, lang, { dateStyle: "full" })} onClick={() => onDay(key)}>
                  {day.getDate() === 1 ? dayLabel(day, lang, { day: "numeric", month: "short" }) : day.getDate()}
                </button>
                <button type="button" className="cal-month-add" aria-label={`${l.createAt} · ${key}`} onClick={() => onCreate(key)}><Icon name="plus" /></button>
              </div>
              <div className="cal-month-events">
                {dayEvents.slice(0, MONTH_VISIBLE_EVENTS).map((event) => <EventPill key={event.id} event={event} lang={lang} t={t} showTime onOpen={onOpen} />)}
                {hidden > 0 && <button type="button" className="cal-month-more" aria-label={`+${hidden} ${l.more}`} onClick={() => onDay(key)}>+{hidden}</button>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function AgendaList({ events, sources, now, lang, t, onOpen }: { readonly events: CalendarEvent[]; readonly sources: CalendarSource[]; readonly now: Date; readonly lang: string; readonly t: Translate; readonly onOpen: (event: CalendarEvent) => void }) {
  const byDate = groupByDate(events);
  const entries = [...byDate.entries()].sort(([left], [right]) => left.localeCompare(right));
  const todayKey = dateKey(now);
  const sourceNames = new Map(sources.map((source) => [source.id, source.name]));
  if (entries.length === 0) {
    return <div className="cal-agenda"><div className="cal-empty"><span className="cal-empty-icon"><Icon name="calendar-check" /></span><strong>{t("common.calendar.empty")}</strong><span>{t("common.calendar.emptyHint")}</span></div></div>;
  }
  return (
    <div className="cal-agenda">
      {entries.map(([date, dayEvents]) => {
        const day = parseDateKey(date);
        return (
          <section className={`cal-agenda-day${date === todayKey ? " is-today" : ""}`} key={date} aria-label={dayLabel(day, lang, { dateStyle: "full" })}>
            <header className="cal-agenda-dayhead">
              <span className="cal-agenda-daynum">{day.getDate()}</span>
              <span className="cal-agenda-daytext"><strong>{capitalize(dayLabel(day, lang, { weekday: "long" }), lang)}</strong><span>{capitalize(dayLabel(day, lang, { month: "long", year: "numeric" }), lang)}</span></span>
              {date === todayKey && <span className="cal-today-tag">{t("common.calendar.today")}</span>}
            </header>
            <ul className="cal-agenda-list">
              {dayEvents.map((event) => {
                const meta = [event.kind === "habit" ? t("common.calendar.habitsTitle") : sourceNames.get(event.sourceId), event.location].filter(Boolean).join(" · ");
                return (
                  <li key={event.id}>
                    <button type="button" className={eventClasses("cal-agenda-row", event)} style={{ "--event-color": event.color } as CSSProperties} onClick={() => onOpen(event)}>
                      <span className="cal-agenda-time">
                        {event.startTime ? <><span>{formatClock(event.startTime, lang)}</span>{event.endTime && <span>{formatClock(event.endTime, lang)}</span>}</> : <span>{t("common.calendar.anytime")}</span>}
                      </span>
                      <span className="cal-agenda-bar" aria-hidden="true" />
                      <span className="cal-agenda-main">
                        <strong>{event.locked && <Icon name="lock" className="cal-lock" aria-hidden="true" />}{eventLabel(event, t)}</strong>
                        {meta && <small>{meta}</small>}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

type MiniMonthProps = {
  readonly month: Date;
  readonly selection: { readonly from: string; readonly to: string } | null;
  readonly now: Date;
  readonly lang: string;
  readonly t: Translate;
  readonly onMonth: (amount: number) => void;
  readonly onPick: (day: Date) => void;
};

function MiniMonth({ month, selection, now, lang, t, onMonth, onPick }: MiniMonthProps) {
  const days = monthGrid(month);
  const todayKey = dateKey(now);
  const initials = useMemo(() => Array.from({ length: 7 }, (_, index) => dayLabel(new Date(2024, 0, 1 + index), lang, { weekday: "narrow" })), [lang]);
  return (
    <div className="cal-mini">
      <div className="cal-mini-head">
        <strong>{capitalize(dayLabel(month, lang, { month: "long", year: "numeric" }), lang)}</strong>
        <div className="cal-mini-nav">
          <button type="button" className="cal-icon-btn is-small" aria-label={t("common.datePicker.previousMonth")} onClick={() => onMonth(-1)}><Icon name="chevron-left" /></button>
          <button type="button" className="cal-icon-btn is-small" aria-label={t("common.datePicker.nextMonth")} onClick={() => onMonth(1)}><Icon name="chevron-right" /></button>
        </div>
      </div>
      <div className="cal-mini-grid">
        {initials.map((initial, index) => <span className="cal-mini-weekday" key={index} aria-hidden="true">{initial}</span>)}
        {days.map((day) => {
          const key = dateKey(day);
          const inRange = selection !== null && key >= selection.from && key <= selection.to;
          const className = `cal-mini-day${day.getMonth() !== month.getMonth() ? " is-outside" : ""}${key === todayKey ? " is-today" : ""}${inRange ? " in-range" : ""}${inRange && key === selection?.from ? " range-start" : ""}${inRange && key === selection?.to ? " range-end" : ""}`;
          return (
            <button type="button" className={className} key={key} aria-label={dayLabel(day, lang, { dateStyle: "full" })} aria-current={key === todayKey ? "date" : undefined} aria-pressed={inRange} onClick={() => onPick(day)}>
              <span>{day.getDate()}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function CalendarView({ habits }: Props) {
  const { t, lang } = useI18n();
  const l = useCalendarLabels();
  const now = useMinuteClock();
  const [state, setState] = useState<CalendarState>(() => loadCalendarState());
  const stateRef = useRef(state);
  const [storageError, setStorageError] = useState("");
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [editor, setEditor] = useState<{ initial: CalendarEvent; original?: CalendarEvent } | null>(null);
  const [sourceEditor, setSourceEditor] = useState<{ source: CalendarSource; isNew: boolean; thenCreate?: { date: string; time: string } } | null>(null);
  const [mode, setMode] = useState<CalendarViewMode>(() => typeof window !== "undefined" && window.matchMedia?.("(max-width: 760px)").matches ? "day" : "week");
  const [railOpen, setRailOpen] = useState(false);
  const [anchorDate, setAnchorDate] = useState(() => new Date());
  const anchorMonthKey = `${anchorDate.getFullYear()}-${anchorDate.getMonth()}`;
  const [miniMonthState, setMiniMonthState] = useState(() => ({ key: anchorMonthKey, month: firstOfMonth(anchorDate) }));
  let miniMonth = miniMonthState.month;
  if (miniMonthState.key !== anchorMonthKey) {
    // Follow the main calendar when navigation crosses into another month.
    miniMonth = firstOfMonth(anchorDate);
    setMiniMonthState({ key: anchorMonthKey, month: miniMonth });
  }
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

  useEffect(() => {
    if (!railOpen) return;
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") setRailOpen(false); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [railOpen]);

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
  const eventCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const event of events) counts.set(event.sourceId, (counts.get(event.sourceId) ?? 0) + 1);
    return counts;
  }, [events]);
  const heading = useMemo(() => {
    const format = (value: Date, options: Intl.DateTimeFormatOptions) => capitalize(dayLabel(value, lang, options), lang);
    const fullRange = `${dayLabel(range.from, lang, { day: "numeric", month: "short" })} – ${dayLabel(range.to, lang, { day: "numeric", month: "short", year: "numeric" })}`;
    if (mode === "day") return { title: format(anchorDate, { day: "numeric", month: "long", year: "numeric" }), detail: format(anchorDate, { weekday: "long" }), full: format(anchorDate, { dateStyle: "full" }) };
    if (mode === "month") return { title: format(anchorDate, { month: "long", year: "numeric" }), detail: "", full: format(anchorDate, { month: "long", year: "numeric" }) };
    const { from, to } = range;
    const title = from.getMonth() === to.getMonth()
      ? format(from, { month: "long", year: "numeric" })
      : from.getFullYear() === to.getFullYear()
        ? `${format(from, { month: "short" })} – ${format(to, { month: "short", year: "numeric" })}`
        : `${format(from, { month: "short", year: "numeric" })} – ${format(to, { month: "short", year: "numeric" })}`;
    return { title, detail: `${t("common.calendar.views.week")} ${isoWeek(from)}`, full: fullRange };
  }, [anchorDate, lang, mode, range, t]);
  const miniSelection = mode === "month" ? null : { from: dateKey(range.from), to: dateKey(range.to) };
  const localSources = state.sources.filter((source) => source.type === "local");
  const importedSources = state.sources.filter((source) => source.type !== "local");

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

  function toggleSource(source: CalendarSource) {
    updateState({ ...state, sources: state.sources.map((item) => item.id === source.id ? { ...item, enabled: !item.enabled } : item) });
  }

  function pickDay(day: Date) {
    setAnchorDate(day);
    setSelectedEvent(null);
    setRailOpen(false);
  }

  function openDay(date: string) {
    setAnchorDate(parseDateKey(date));
    setMode("day");
    setSelectedEvent(null);
  }

  function renderSource(source: CalendarSource) {
    const count = source.enabled ? eventCounts.get(source.id) ?? 0 : 0;
    return (
      <li className={`cal-source${source.enabled ? "" : " is-off"}`} key={source.id} style={{ "--source-color": source.color } as CSSProperties}>
        <button type="button" className="cal-source-toggle" aria-pressed={source.enabled} onClick={() => toggleSource(source)}>
          <span className="cal-check" aria-hidden="true"><Icon name="check" /></span>
          <span className="cal-source-name">{source.name}</span>
          {syncingSourceId === source.id && <Icon name="refresh" className="cal-source-syncing" aria-hidden="true" />}
          {source.syncError && <span className="cal-source-error" title={l.syncError}>!</span>}
          {count > 0 && <span className="cal-source-count">{count}</span>}
        </button>
        <button type="button" className="cal-icon-btn is-small cal-source-more" aria-label={`${l.settings} · ${source.name}`} title={l.settings} onClick={() => setSourceEditor({ source, isNew: false })}><Icon name="gear" /></button>
      </li>
    );
  }

  return (
    <section className="calendar-page" aria-label={t("common.views.calendar")}>
      <aside id="calendar-rail" className={`cal-rail${railOpen ? " is-open" : ""}`} aria-label={t("common.calendar.sourcesLabel")}>
        <MiniMonth
          month={miniMonth}
          selection={miniSelection}
          now={now}
          lang={lang}
          t={t}
          onMonth={(amount) => setMiniMonthState((current) => ({ ...current, month: new Date(miniMonth.getFullYear(), miniMonth.getMonth() + amount, 1) }))}
          onPick={pickDay}
        />
        <section className="cal-rail-section">
          <div className="cal-rail-heading">
            <h3>{l.personal}</h3>
            <button type="button" className="cal-icon-btn is-small" aria-label={l.newCalendar} title={l.newCalendar} onClick={() => setSourceEditor({ source: createLocalCalendar(l.personal), isNew: true })}><Icon name="plus" /></button>
          </div>
          {localSources.length > 0 ? <ul className="cal-source-list">{localSources.map(renderSource)}</ul> : <p className="cal-rail-hint">{l.emptyLocal}</p>}
        </section>
        <section className="cal-rail-section">
          <div className="cal-rail-heading">
            <h3>{l.imported}</h3>
            <button type="button" className="cal-icon-btn is-small" aria-label={t("common.calendar.importAnother")} title={t("common.calendar.importAnother")} onClick={openImport}><Icon name="plus" /></button>
          </div>
          {importedSources.length > 0
            ? <ul className="cal-source-list">{importedSources.map(renderSource)}</ul>
            : <button type="button" className="cal-rail-ghost" onClick={openImport}><Icon name="download" /><span>{t("common.calendar.addCalendar")}</span></button>}
        </section>
        <section className="cal-rail-section">
          <button type="button" role="switch" aria-checked={state.showHabits} aria-label={t("common.calendar.habitsTitle")} className="cal-switch-row" onClick={() => updateState({ ...state, showHabits: !state.showHabits })}>
            <Icon name="sun" className="cal-switch-icon" aria-hidden="true" />
            <span className="cal-switch-label">{t("common.calendar.habitsTitle")}</span>
            <span className="cal-switch" aria-hidden="true" />
          </button>
        </section>
        <p className="cal-rail-foot">{l.timezone}</p>
      </aside>
      {railOpen && <button type="button" className="cal-rail-backdrop" aria-label={t("common.actions.close")} tabIndex={-1} onClick={() => setRailOpen(false)} />}

      <div className="cal-main">
        <header className="cal-header">
          <button type="button" className="cal-icon-btn cal-rail-toggle" aria-label={t("common.calendar.sourcesTitle")} aria-expanded={railOpen} aria-controls="calendar-rail" onClick={() => setRailOpen((value) => !value)}><Icon name="calendar-check" /></button>
          <div className="cal-title" title={heading.full}>
            <h2>{heading.title}</h2>
            {heading.detail && <span>{heading.detail}</span>}
          </div>
          <div className="cal-header-controls">
            <div className="cal-nav" role="group" aria-label={heading.full}>
              <button type="button" className="cal-nav-arrow" aria-label={t("common.calendar.previous")} onClick={() => moveRange(-1)}><Icon name="chevron-left" /></button>
              <button type="button" className="cal-nav-today" onClick={() => { setAnchorDate(new Date()); setSelectedEvent(null); }}>{t("common.calendar.today")}</button>
              <button type="button" className="cal-nav-arrow" aria-label={t("common.calendar.next")} onClick={() => moveRange(1)}><Icon name="chevron-right" /></button>
            </div>
            <div className="cal-views" role="tablist" aria-label={t("common.calendar.viewMode")}>
              {VIEW_MODES.map((option) => <button type="button" role="tab" aria-selected={mode === option} className={mode === option ? "active" : ""} key={option} onClick={() => setMode(option)}>{option === "day" ? dayModeLabel(lang) : t(`common.calendar.views.${option}`)}</button>)}
            </div>
          </div>
          {searchOpen || query ? (
            <label className="cal-search">
              <Icon name="search" aria-hidden="true" />
              <input
                type="search"
                aria-label={l.search}
                placeholder={l.search}
                value={query}
                autoFocus
                onChange={(event) => setQuery(event.target.value)}
                onBlur={() => { if (!query) setSearchOpen(false); }}
                onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); setQuery(""); setSearchOpen(false); } }}
              />
            </label>
          ) : (
            <button type="button" className="cal-icon-btn cal-search-button" aria-label={l.search} title={l.search} onClick={() => setSearchOpen(true)}><Icon name="search" /></button>
          )}
          <button type="button" className="primary-button cal-new" aria-label={l.newEvent} onClick={() => createEvent()}><Icon name="plus" /><span>{l.newEvent}</span></button>
        </header>

        {storageError && <p role="alert" className="cal-banner">{storageError}</p>}
        <div className="cal-body">
          {(mode === "week" || mode === "day") && <TimeGrid key={mode} days={range.days} events={events} now={now} lang={lang} t={t} onOpen={setSelectedEvent} onCreate={createEvent} onDay={mode === "week" ? openDay : undefined} />}
          {mode === "month" && <MonthGrid days={range.days} anchor={anchorDate} events={events} now={now} lang={lang} t={t} onOpen={setSelectedEvent} onCreate={createEvent} onDay={openDay} />}
          {mode === "agenda" && <AgendaList events={events} sources={state.sources} now={now} lang={lang} t={t} onOpen={setSelectedEvent} />}
        </div>
      </div>

      {selectedEvent && <Modal title={selectedEvent.title} onClose={() => setSelectedEvent(null)} className="calendar-editor-modal"><div className="calendar-editor-form calendar-detail">
        <div className="calendar-detail-heading"><span style={{ background: selectedEvent.color }} className="calendar-source-swatch" /><strong>{eventLabel(selectedEvent, t)}</strong></div>
        <p className="calendar-detail-meta"><Icon name="clock" aria-hidden="true" /><span>{capitalize(dayLabel(parseDateKey(selectedEvent.date), lang, { dateStyle: "full" }), lang)} · {formatTimeRange(selectedEvent, lang) || l.allDay}</span></p>
        {selectedEvent.location && <p className="calendar-detail-meta"><Icon name="map-pin" aria-hidden="true" /><span>{selectedEvent.location}</span></p>}{selectedEvent.description && <p className="calendar-description">{selectedEvent.description}</p>}
        {selectedEvent.kind !== "habit" && (state.sources.find((source) => source.id === selectedEvent.sourceId)?.type === "local" ? <>
          <p className="calendar-detail-meta"><span className="calendar-source-swatch" style={{ background: state.sources.find((source) => source.id === selectedEvent.sourceId)?.color }} /><span>{state.sources.find((source) => source.id === selectedEvent.sourceId)?.name}</span>{selectedEvent.locked && <span className="calendar-detail-lock"><Icon name="lock" aria-hidden="true" />{l.locked}</span>}</p>
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
