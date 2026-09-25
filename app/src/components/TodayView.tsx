import { useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent, type KeyboardEvent } from "react";
import type { Area, Habit, Project, Task, TaskDraft, TaskPriority, TaskStatus } from "../types";
import { useI18n } from "../lib/i18n";
import { rankFocusTasks } from "../lib/taskFocus";
import { parseTaskTitle, type TaskTitleToken } from "../lib/taskTitleParser";
import { eventsInRange, loadCalendarState, type CalendarEvent, type CalendarState } from "../lib/calendar";
import { ACCOUNT_DATA_CHANGED } from "../lib/accountDocuments";
import {
  DAY_END_MINUTES,
  DAY_START_MINUTES,
  avatarTone,
  completedOn,
  daysSince,
  firstFreeSlot,
  formatClock,
  habitScheduledOn,
  habitStreak,
  initials,
  localDateKey,
  minutesOfDay,
  parseClock,
  remainingFreeMinutes,
  waitingSince,
  type BusySpan,
} from "../lib/todayPlan";
import { AgentIdentity } from "./AgentIdentity";
import { Icon } from "./Icon";
import { TaskRow } from "./TaskRow";
import { TaskTitleInput } from "./TaskTitleInput";
import "./TodayView.css";

type NewTaskContext = Pick<TaskDraft, "areaId" | "projectId" | "status">;

export type TodayViewProps = {
  readonly tasks: Task[];
  readonly waitingTasks: Task[];
  readonly projects: Project[];
  readonly areas: Area[];
  readonly habits?: Habit[];
  readonly onHabitComplete?: (habit: Habit, date: string) => Promise<void>;
  readonly onNewTask: (context?: NewTaskContext) => void;
  readonly onQuickAddTask?: (draft: TaskDraft) => Promise<void>;
  readonly onOpenAgent?: () => void;
  readonly onOpenCalendar?: () => void;
  readonly onOpenHabits?: () => void;
  readonly onOpenWaiting: () => void;
  readonly onTaskChange: (task: Task) => Promise<void>;
  readonly onTaskDelete: (task: Task) => Promise<void>;
  readonly onTaskEdit: (task: Task) => void;
};

const PRIORITY_LIMIT = 3;
const NEXT_LIMIT = 5;
const DAY_SPAN = DAY_END_MINUTES - DAY_START_MINUTES;
const HOURS = Array.from({ length: (DAY_END_MINUTES - DAY_START_MINUTES) / 60 + 1 }, (_, index) => DAY_START_MINUTES / 60 + index);
const RING_RADIUS = 18;
const RING_LENGTH = 2 * Math.PI * RING_RADIUS;

type TimelineBlock = { readonly id: string; readonly kind: "event" | "habit"; readonly title: string; readonly start: number; readonly end: number; readonly color: string; readonly lane: number };

function addDays(value: Date, amount: number): Date {
  const next = new Date(value.getFullYear(), value.getMonth(), value.getDate());
  next.setDate(next.getDate() + amount);
  return next;
}

function capitalize(value: string): string {
  return value ? value.charAt(0).toLocaleUpperCase() + value.slice(1) : value;
}

function eventSpan(event: Pick<CalendarEvent, "startTime" | "endTime">): BusySpan | null {
  const start = parseClock(event.startTime);
  if (start === null) return null;
  const end = parseClock(event.endTime);
  return { start, end: end !== null && end > start ? end : start + 45 };
}

/** Re-render every minute so the now-line and relative labels stay honest. */
function useMinuteClock(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}

function readCalendar(): CalendarState | null {
  try {
    return loadCalendarState();
  } catch {
    return null;
  }
}

/** Today's calendar sources, refreshed when account data or another tab changes them. */
function useCalendarState(): CalendarState | null {
  const [state, setState] = useState<CalendarState | null>(readCalendar);
  useEffect(() => {
    const refresh = () => setState(readCalendar());
    window.addEventListener(ACCOUNT_DATA_CHANGED, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(ACCOUNT_DATA_CHANGED, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);
  return state;
}

/** Up to two lanes so overlapping blocks stay readable in the compact strip. */
function assignLanes(blocks: Omit<TimelineBlock, "lane">[]): TimelineBlock[] {
  const laneEnds: number[] = [];
  return [...blocks].sort((left, right) => left.start - right.start || right.end - left.end).map((block) => {
    let lane = laneEnds.findIndex((end) => end <= block.start);
    if (lane === -1) lane = laneEnds.length < 2 ? laneEnds.length : laneEnds.indexOf(Math.min(...laneEnds));
    laneEnds[lane] = block.end;
    return { ...block, lane };
  });
}

function percent(minutes: number): number {
  return ((Math.min(DAY_END_MINUTES, Math.max(DAY_START_MINUTES, minutes)) - DAY_START_MINUTES) / DAY_SPAN) * 100;
}

export function TodayView({ tasks, waitingTasks, projects, areas, habits = [], onHabitComplete, onNewTask, onQuickAddTask, onOpenAgent, onOpenCalendar, onOpenHabits, onOpenWaiting, onTaskChange, onTaskDelete, onTaskEdit }: TodayViewProps) {
  const { t, tp, lang } = useI18n();
  const now = useMinuteClock();
  const calendar = useCalendarState();
  const todayKey = localDateKey(now);
  const tomorrow = addDays(now, 1);
  const tomorrowKey = localDateKey(tomorrow);
  const nowMinutes = minutesOfDay(now);
  const shortcut = typeof navigator !== "undefined" && /Mac|iPhone|iPad/i.test(navigator.platform) ? "⌘ N" : "Ctrl N";

  const projectById = useMemo(() => new Map(projects.map((project) => [project.id, project])), [projects]);
  const ranked = useMemo(() => rankFocusTasks(tasks, todayKey), [tasks, todayKey]);
  const priorities = ranked.slice(0, PRIORITY_LIMIT);
  const upNext = ranked.slice(PRIORITY_LIMIT, PRIORITY_LIMIT + NEXT_LIMIT);
  const doneToday = useMemo(() => completedOn(tasks, now), [tasks, now]);
  const [doneOpen, setDoneOpen] = useState(false);

  const events = useMemo(() => {
    if (!calendar) return [];
    try {
      return eventsInRange({ ...calendar, showHabits: false }, [], new Date(now.getFullYear(), now.getMonth(), now.getDate()), tomorrow)
        .filter((event) => event.kind === "event");
    } catch {
      return [];
    }
    // `todayKey` changes once a day; the minute clock must not re-expand recurrences.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calendar, todayKey]);
  const sourceName = useMemo(() => new Map((calendar?.sources ?? []).map((source) => [source.id, source.name])), [calendar]);
  const todayEvents = useMemo(() => events.filter((event) => event.date === todayKey), [events, todayKey]);
  const tomorrowEvents = useMemo(() => events.filter((event) => event.date === tomorrowKey), [events, tomorrowKey]);

  const todaysHabits = useMemo(() => habits
    .filter((habit) => !habit.deletedAt && habitScheduledOn(habit, now))
    .sort((left, right) => (parseClock(left.timeOfDay) ?? 24 * 60) - (parseClock(right.timeOfDay) ?? 24 * 60) || left.title.localeCompare(right.title, lang)),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [habits, todayKey, lang]);
  const habitsDone = todaysHabits.filter((habit) => habit.completedDates.includes(todayKey)).length;

  const blocks = useMemo(() => {
    const raw: Omit<TimelineBlock, "lane">[] = [];
    for (const event of todayEvents) {
      const span = eventSpan(event);
      if (span && span.end > DAY_START_MINUTES && span.start < DAY_END_MINUTES) raw.push({ id: event.id, kind: "event", title: event.title, color: event.customColor ?? event.color, ...span });
    }
    for (const habit of todaysHabits) {
      const start = parseClock(habit.timeOfDay);
      if (start !== null && start < DAY_END_MINUTES && start + 45 > DAY_START_MINUTES) raw.push({ id: `habit-${habit.id}`, kind: "habit", title: habit.title, color: "", start, end: start + 45 });
    }
    return assignLanes(raw);
  }, [todayEvents, todaysHabits]);
  const busy = blocks.map(({ start, end }) => ({ start, end }));
  const freeMinutes = remainingFreeMinutes(busy, nowMinutes);
  const freeSlot = firstFreeSlot(busy, nowMinutes);
  const laneCount = Math.max(1, ...blocks.map((block) => block.lane + 1));
  const showNowLine = nowMinutes >= DAY_START_MINUTES && nowMinutes <= DAY_END_MINUTES;
  const daySummary = `${todayEvents.length ? tp("tasks.today.dayEvents", todayEvents.length) : t("tasks.today.dayNoEvents")} · ${freeMinutes > 0 ? t("tasks.today.dayFree", { duration: duration(freeMinutes) }) : t("tasks.today.dayNoFree")}`;

  function duration(minutes: number): string {
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    if (hours && rest) return t("tasks.today.durationHoursMinutes", { hours, minutes: String(rest).padStart(2, "0") });
    if (hours) return t("tasks.today.durationHours", { hours });
    return t("tasks.today.durationMinutes", { minutes: rest });
  }

  function timeRange(event: CalendarEvent): string {
    const span = eventSpan(event);
    if (!span) return t("tasks.today.allDay");
    return `${formatClock(span.start)} – ${formatClock(Math.min(span.end, 24 * 60))}`;
  }

  function eventMeta(event: CalendarEvent): string {
    const source = sourceName.get(event.sourceId);
    return source ? `${timeRange(event)} · ${source}` : timeRange(event);
  }

  function countWord(count: number): string {
    if (count === 2) return t("tasks.today.numberTwo");
    if (count === 3) return t("tasks.today.numberThree");
    return String(count);
  }

  function dueLabel(task: Task): string | null {
    if (!task.dueDate) return null;
    if (task.dueDate < todayKey) return t("tasks.today.dueOverdue");
    if (task.dueDate === todayKey) return t("tasks.today.dueToday");
    if (task.dueDate === tomorrowKey) return t("tasks.today.dueTomorrow");
    return new Date(`${task.dueDate}T00:00:00`).toLocaleDateString(lang, { day: "numeric", month: "short" });
  }

  function waitingAge(task: Task): string {
    const days = daysSince(waitingSince(task), now) ?? 0;
    return days > 0 ? tp("tasks.today.waitingSince", days) : t("tasks.today.waitingSinceToday");
  }

  const greetingKey = now.getHours() < 12 ? "greetingMorning" : now.getHours() < 18 ? "greetingAfternoon" : "greetingEvening";
  const summary = priorities.length ? tp("tasks.today.focusSummary", priorities.length, { countWord: countWord(priorities.length) }) : t("tasks.today.focusSummaryEmpty");
  const mobileTitle = priorities.length ? capitalize(tp("tasks.today.mobileTitle", priorities.length, { countWord: countWord(priorities.length) })) : t("tasks.today.mobileTitleEmpty");
  const eyebrow = capitalize(now.toLocaleDateString(lang, { weekday: "long", day: "numeric", month: "long" }));

  // "Prochain" card (phones): the event happening now, else the next one today, else tomorrow's first.
  const timedToday = todayEvents.map((event) => ({ event, span: eventSpan(event) })).filter((item): item is { event: CalendarEvent; span: BusySpan } => item.span !== null);
  const current = timedToday.find(({ span }) => span.start <= nowMinutes && nowMinutes < span.end);
  const upcoming = timedToday.find(({ span }) => span.start > nowMinutes);
  const tomorrowFirst = tomorrowEvents.find((event) => eventSpan(event) !== null);
  const nextEvent = current
    ? { event: current.event, label: t("tasks.today.nextEventNow") }
    : upcoming
      ? { event: upcoming.event, label: t("tasks.today.nextEventIn", { duration: duration(upcoming.span.start - nowMinutes) }) }
      : tomorrowFirst ? { event: tomorrowFirst, label: t("tasks.today.nextEventTomorrow") } : null;

  const remainingHabits = todaysHabits.filter((habit) => !habit.completedDates.includes(todayKey)).map((habit) => habit.title);
  const remainingList = remainingHabits.length ? formatList(remainingHabits.slice(0, 2), lang) : "";

  const oldestWaiting = useMemo(() => [...waitingTasks].sort((left, right) => waitingSince(left).localeCompare(waitingSince(right))), [waitingTasks]);

  return (
    <section className="today-dashboard" aria-label={t("common.views.today")}>
      <header className="today-dash-header">
        <div className="today-dash-heading">
          <p className="today-dash-eyebrow">{eyebrow}</p>
          <h2 className="today-dash-title">
            <span className="today-dash-title-desktop">{t(`tasks.today.${greetingKey}`)} {summary}</span>
            <span className="today-dash-title-mobile">{mobileTitle}</span>
          </h2>
        </div>
        <div className="today-dash-actions">
          {onOpenAgent && <button type="button" className="secondary-button today-plan-button" onClick={onOpenAgent}><Icon name="sparkles" /><span>{t("tasks.today.planDay")}</span></button>}
          <button type="button" className="primary-button today-new-button" aria-keyshortcuts={shortcut.startsWith("⌘") ? "Meta+N" : "Control+N"} onClick={() => onNewTask({ status: "next" })}><Icon name="plus" /><span>{t("common.header.newTask")}</span><kbd aria-hidden="true">{shortcut}</kbd></button>
          {onOpenAgent && <button type="button" className="mobile-icon-button mobile-agent-button today-agent-button" aria-label={t("tasks.today.openAgent")} aria-controls="prior-ai-assistant" onClick={onOpenAgent}><AgentIdentity size="small" /></button>}
        </div>
      </header>

      {onQuickAddTask && <QuickAdd projects={projects} areas={areas} onAdd={onQuickAddTask} />}

      {nextEvent && (
        <button type="button" className="today-next-event" onClick={onOpenCalendar} disabled={!onOpenCalendar}>
          <span className="today-next-event-bar" style={{ background: nextEvent.event.customColor ?? nextEvent.event.color } as CSSProperties} aria-hidden="true" />
          <span className="today-next-event-copy">
            <span className="today-next-event-label">{nextEvent.label}</span>
            <strong>{nextEvent.event.title}</strong>
            <span className="today-next-event-meta">{eventMeta(nextEvent.event)}</span>
          </span>
          <Icon name="chevron-right" aria-hidden="true" />
        </button>
      )}

      <section className="today-card today-timeline-card" aria-labelledby="today-timeline-title">
        <div className="today-timeline-head">
          <div className="today-timeline-heading">
            <h3 id="today-timeline-title" className="today-card-title">{t("tasks.today.dayTitle")}</h3>
            <span className="today-timeline-summary">{daySummary}</span>
          </div>
          {onOpenCalendar && <button type="button" className="today-ghost-button" onClick={onOpenCalendar}><Icon name="calendar-check" /><span>{t("tasks.today.openCalendar")}</span></button>}
        </div>
        <div className="today-timeline" role="img" aria-label={[t("tasks.today.timelineLabel"), freeSlot && t("tasks.today.freeSlotLabel", { start: formatClock(freeSlot.start), end: formatClock(freeSlot.end) })].filter(Boolean).join(". ")} style={{ "--today-lanes": laneCount } as CSSProperties}>
          {HOURS.map((hour) => (
            <span key={hour} className="today-timeline-hour" style={{ left: `${percent(hour * 60)}%` }}>
              <span className="today-timeline-hour-label">{hour}:00</span>
            </span>
          ))}
          {freeSlot && (
            <span className="today-timeline-free" style={{ left: `${percent(freeSlot.start)}%`, width: `${percent(freeSlot.end) - percent(freeSlot.start)}%` }} title={t("tasks.today.freeSlotLabel", { start: formatClock(freeSlot.start), end: formatClock(freeSlot.end) })}>
              <span>{priorities[0] ? t("tasks.today.freeSlot", { title: priorities[0].title }) : t("tasks.today.freeSlotPlain", { duration: duration(freeSlot.end - freeSlot.start) })}</span>
            </span>
          )}
          {blocks.map((block) => (
            <span
              key={block.id}
              className={`today-timeline-block ${block.kind === "habit" ? "is-habit" : ""}`}
              style={{ left: `${percent(block.start)}%`, width: `${percent(block.end) - percent(block.start)}%`, "--today-lane": block.lane, ...(block.kind === "event" ? { "--today-block-color": block.color } : {}) } as CSSProperties}
              title={`${block.title} · ${formatClock(block.start)} – ${formatClock(block.end)}`}
            >
              <strong>{block.title}</strong>
              <span>{block.kind === "habit" ? t("tasks.today.habitTag") : formatClock(block.start)}</span>
            </span>
          ))}
          {showNowLine && <span className="today-timeline-now" style={{ left: `${percent(nowMinutes)}%` }} title={`${t("tasks.today.now")} · ${formatClock(nowMinutes)}`} />}
        </div>
      </section>

      <div className="today-dash-grid">
        <div className="today-dash-main">
          <section className="today-card today-priorities" aria-labelledby="today-priorities-title">
            <div className="today-card-head">
              <div className="today-card-heading">
                <Icon name="target" className="today-priorities-icon" aria-hidden="true" />
                <h3 id="today-priorities-title" className="today-card-title">{t("tasks.today.prioritiesTitle")}</h3>
                <span className="today-count-pill is-accent">{priorities.length}</span>
              </div>
              {onOpenAgent && <button type="button" className="today-ghost-button today-replan-button" onClick={onOpenAgent}><Icon name="sparkles" /><span>{t("tasks.today.replan")}</span></button>}
            </div>
            {priorities.length
              ? <div className="today-priority-list">{priorities.map((task) => <TaskRow key={task.id} task={task} project={task.projectId ? projectById.get(task.projectId) ?? null : null} hideNextStatus onChange={onTaskChange} onDelete={onTaskDelete} onEdit={onTaskEdit} />)}</div>
              : <div className="today-empty"><Icon name="check-circle" /><strong>{t("common.workhub.nowEmptyTitle")}</strong><span>{t("common.workhub.nowEmptyHint")}</span></div>}
          </section>

          {(upNext.length > 0 || doneToday.length > 0) && (
            <section className="today-card today-up-next" aria-labelledby={upNext.length ? "today-next-title" : undefined} aria-label={upNext.length ? undefined : t("tasks.today.doneToday", { count: doneToday.length })}>
              {upNext.length > 0 && <>
                <div className="today-card-head is-compact">
                  <div className="today-card-heading">
                    <h3 id="today-next-title" className="today-card-title">{t("tasks.today.nextTitle")}</h3>
                    <span className="today-count-muted">{upNext.length}</span>
                  </div>
                </div>
                <ul className="today-next-list">
                  {upNext.map((task) => {
                    const project = task.projectId ? projectById.get(task.projectId) : undefined;
                    const due = dueLabel(task);
                    return (
                      <li key={task.id} className="today-next-row">
                        <button type="button" className="complete-button" aria-label={t("tasks.row.markTitleComplete", { title: task.title })} onClick={() => void onTaskChange({ ...task, completed: true })}><Icon name="check" aria-hidden="true" /></button>
                        <button type="button" className="today-next-title" onClick={() => onTaskEdit(task)}>{task.title}</button>
                        <span className="today-next-meta">
                          {due && <span className={`today-chip ${task.dueDate && task.dueDate < todayKey ? "is-danger" : ""}`}><Icon name="calendar-check" aria-hidden="true" />{due}</span>}
                          {project && <span className="today-chip today-chip-project"><Icon name="folder" aria-hidden="true" /><span>{project.name}</span></span>}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </>}
              {doneToday.length > 0 && <>
                <button type="button" className="today-done-toggle" aria-expanded={doneOpen} onClick={() => setDoneOpen((open) => !open)}>
                  <Icon name="check" aria-hidden="true" />
                  <span>{t("tasks.today.doneToday", { count: doneToday.length })}</span>
                  <Icon name="chevron-right" className="today-done-chevron" aria-hidden="true" />
                </button>
                {doneOpen && <div className="today-done-list">{doneToday.map((task) => <TaskRow key={task.id} task={task} project={task.projectId ? projectById.get(task.projectId) ?? null : null} hideFlags onChange={onTaskChange} onDelete={onTaskDelete} onEdit={onTaskEdit} />)}</div>}
              </>}
            </section>
          )}

          {todaysHabits.length > 0 && (
            <button type="button" className="today-card today-habits-summary" onClick={onOpenHabits} disabled={!onOpenHabits}>
              <HabitRing done={habitsDone} total={todaysHabits.length} label={t("tasks.today.habitsProgress", { done: habitsDone, total: todaysHabits.length })} />
              <span className="today-habits-summary-copy">
                <strong>{habitsDone}<span className="today-faint">/{todaysHabits.length}</span> {tp("tasks.today.habitsMobile", todaysHabits.length)}</strong>
                <span>{remainingHabits.length ? tp("tasks.today.habitsRemaining", remainingHabits.length, { list: remainingList }) : t("tasks.today.habitsAllDone")}</span>
              </span>
              <Icon name="chevron-right" aria-hidden="true" />
            </button>
          )}

          {oldestWaiting[0] && (
            <div className="today-card today-waiting-row">
              <button type="button" className="today-waiting-row-main" onClick={onOpenWaiting}>
                <Avatar name={oldestWaiting[0].assigneeName} />
                <span className="today-waiting-copy">
                  <strong>{oldestWaiting[0].title}</strong>
                  <span>{t("tasks.today.waitingSinceShort", { count: daysSince(waitingSince(oldestWaiting[0]), now) ?? 0 })}</span>
                </span>
              </button>
              <button type="button" className="secondary-button today-small-button" aria-label={t("tasks.today.followUpAria", { title: oldestWaiting[0].title })} onClick={() => onTaskEdit(oldestWaiting[0])}>{t("tasks.today.followUp")}</button>
            </div>
          )}
        </div>

        <aside className="today-dash-side" aria-label={t("tasks.today.agendaTitle")}>
          <section className="today-card today-agenda" aria-labelledby="today-agenda-title">
            <div className="today-card-head is-compact">
              <div className="today-card-heading">
                <Icon name="calendar-check" className="today-head-icon" aria-hidden="true" />
                <h3 id="today-agenda-title" className="today-card-title">{t("tasks.today.agendaTitle")}</h3>
              </div>
            </div>
            <div className="today-agenda-body">
              <AgendaDay label={t("tasks.today.agendaToday")} events={todayEvents} emptyLabel={t("tasks.today.agendaEmpty")} meta={eventMeta} />
              <AgendaDay label={t("tasks.today.agendaTomorrow")} events={tomorrowEvents} emptyLabel={t("tasks.today.agendaEmpty")} meta={eventMeta} />
            </div>
          </section>

          {habits.length > 0 && (
            <section className="today-card today-habits" aria-labelledby="today-habits-title">
              <div className="today-card-head is-compact">
                <div className="today-card-heading">
                  <Icon name="sun" className="today-head-icon" aria-hidden="true" />
                  <h3 id="today-habits-title" className="today-card-title">{t("tasks.today.habitsTitle")}</h3>
                </div>
              </div>
              {todaysHabits.length ? <>
                <div className="today-habits-progress">
                  <HabitRing done={habitsDone} total={todaysHabits.length} label={t("tasks.today.habitsProgress", { done: habitsDone, total: todaysHabits.length })} />
                  <div>
                    <div className="today-habits-score">{habitsDone}<span className="today-faint">/{todaysHabits.length}</span></div>
                    <div className="today-muted-xs">{t("tasks.today.habitsToday")}</div>
                  </div>
                </div>
                <ul className="today-habit-list">
                  {todaysHabits.map((habit) => {
                    const done = habit.completedDates.includes(todayKey);
                    const streak = habitStreak(habit, now);
                    return (
                      <li key={habit.id} className={`today-habit-row ${done ? "is-done" : ""}`}>
                        <button
                          type="button"
                          className="today-habit-check"
                          role="checkbox"
                          aria-checked={done}
                          aria-label={done ? t("tasks.today.habitUndone", { title: habit.title }) : t("tasks.today.habitDone", { title: habit.title })}
                          disabled={!onHabitComplete}
                          onClick={() => void onHabitComplete?.(habit, todayKey)}
                        >
                          <Icon name="check" aria-hidden="true" />
                        </button>
                        <span className="today-habit-title">{habit.title}</span>
                        <span className="today-habit-streak" title={t("tasks.today.streak", { count: streak })}><Icon name="trending-up" aria-hidden="true" />{streak}</span>
                      </li>
                    );
                  })}
                </ul>
              </> : <p className="today-card-empty">{t("tasks.today.habitsEmpty")}</p>}
            </section>
          )}

          {oldestWaiting.length > 0 && (
            <section className="today-card today-waiting" aria-labelledby="today-waiting-title">
              <div className="today-card-head is-compact">
                <div className="today-card-heading">
                  <Icon name="later" className="today-head-icon" aria-hidden="true" />
                  <h3 id="today-waiting-title" className="today-card-title">{t("tasks.today.waitingTitle")}</h3>
                </div>
                <button type="button" className="today-count-pill today-count-link" aria-label={`${t("tasks.today.viewAll")} · ${oldestWaiting.length}`} onClick={onOpenWaiting}>{oldestWaiting.length}</button>
              </div>
              <ul className="today-waiting-list">
                {oldestWaiting.slice(0, 3).map((task) => (
                  <li key={task.id} className="today-waiting-item">
                    <button type="button" className="today-waiting-item-main" onClick={onOpenWaiting}>
                      <Avatar name={task.assigneeName} />
                      <span className="today-waiting-copy">
                        <strong>{task.title}</strong>
                        <span>{task.assigneeName?.trim() || t("tasks.today.someone")} · {waitingAge(task)}</span>
                      </span>
                    </button>
                    <button type="button" className="secondary-button today-small-button" aria-label={t("tasks.today.followUpAria", { title: task.title })} onClick={() => onTaskEdit(task)}><Icon name="mail" aria-hidden="true" />{t("tasks.today.followUp")}</button>
                  </li>
                ))}
              </ul>
              {oldestWaiting.length > 3 && <button type="button" className="today-view-all" onClick={onOpenWaiting}>{t("tasks.today.viewAll")}<Icon name="chevron-right" aria-hidden="true" /></button>}
            </section>
          )}
        </aside>
      </div>
    </section>
  );
}

function formatList(items: string[], lang: string): string {
  try {
    return new Intl.ListFormat(lang, { style: "long", type: "conjunction" }).format(items);
  } catch {
    return items.join(", ");
  }
}

function Avatar({ name }: { readonly name?: string | null }) {
  const clean = name?.trim() ?? "";
  return <span className={`today-avatar tone-${clean ? avatarTone(clean) : "neutral"}`} aria-hidden="true">{clean ? initials(clean) : <Icon name="user" />}</span>;
}

function HabitRing({ done, total, label }: { readonly done: number; readonly total: number; readonly label: string }) {
  const filled = total ? (done / total) * RING_LENGTH : 0;
  return (
    <svg className="today-habit-ring" width="44" height="44" viewBox="0 0 44 44" role="img" aria-label={label}>
      <circle cx="22" cy="22" r={RING_RADIUS} className="today-habit-ring-track" />
      <circle cx="22" cy="22" r={RING_RADIUS} className="today-habit-ring-value" strokeDasharray={`${filled} ${RING_LENGTH}`} transform="rotate(-90 22 22)" />
    </svg>
  );
}

function AgendaDay({ label, events, emptyLabel, meta }: { readonly label: string; readonly events: CalendarEvent[]; readonly emptyLabel: string; readonly meta: (event: CalendarEvent) => string }) {
  return (
    <div className="today-agenda-day">
      <span className="today-agenda-day-label">{label}</span>
      {events.length ? (
        <ul>
          {events.slice(0, 4).map((event) => (
            <li key={event.id} className="today-agenda-event">
              <span className="today-agenda-bar" style={{ background: event.customColor ?? event.color }} aria-hidden="true" />
              <span>
                <strong>{event.title}</strong>
                <span>{meta(event)}</span>
              </span>
            </li>
          ))}
        </ul>
      ) : <span className="today-agenda-empty">{emptyLabel}</span>}
    </div>
  );
}

const PARSED_STATUSES: readonly TaskStatus[] = ["inbox", "backlog", "next", "in_progress", "waiting", "done"];

/** Parse a quick-add line into a task draft with the same token rules as the composer. */
export function quickAddDraft(parsed: ReturnType<typeof parseTaskTitle>, projects: readonly Project[]): TaskDraft | null {
  const clean = parsed.cleanTitle.trim();
  if (!clean) return null;
  const fields = parsed.fields;
  const status = PARSED_STATUSES.includes(fields.status as TaskStatus) ? fields.status as TaskStatus : "next";
  const projectId = typeof fields.projectId === "string" ? fields.projectId : null;
  const project = projectId ? projects.find((item) => item.id === projectId) : undefined;
  const dueDate = typeof fields.dueDate === "string" ? fields.dueDate : null;
  return {
    title: clean,
    description: "",
    important: fields.important === true,
    urgent: fields.urgent === true,
    priority: ([1, 2, 3, 4] as const).includes(Number(fields.priority) as TaskPriority) ? Number(fields.priority) as TaskPriority : 4,
    status,
    dueDate,
    dueTime: dueDate && typeof fields.dueTime === "string" ? fields.dueTime : null,
    projectId,
    areaId: typeof fields.areaId === "string" ? fields.areaId : project?.areaId ?? null,
    assigneeName: typeof fields.assigneeName === "string" ? fields.assigneeName : "",
  };
}

function QuickAdd({ projects, areas, onAdd }: { readonly projects: Project[]; readonly areas: Area[]; readonly onAdd: (draft: TaskDraft) => Promise<void> }) {
  const { t, lang } = useI18n();
  const [value, setValue] = useState("");
  const [ignored, setIgnored] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const parsed = useMemo(() => parseTaskTitle(value, { projects, areas, lang }, ignored), [areas, ignored, lang, projects, value]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const draft = quickAddDraft(parsed, projects);
    if (!draft || busy) return;
    setBusy(true);
    setStatus(null);
    try {
      await onAdd(draft);
      setValue("");
      setIgnored([]);
      setStatus({ tone: "ok", text: t("tasks.today.quickAddAdded", { title: draft.title }) });
    } catch {
      setStatus({ tone: "error", text: t("tasks.today.quickAddError") });
    } finally {
      setBusy(false);
      window.setTimeout(() => inputRef.current?.focus(), 0);
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLFormElement>) {
    if (event.key === "Escape" && value) {
      event.stopPropagation();
      setValue("");
      setIgnored([]);
    }
  }

  return (
    <form className="today-quick-add" onSubmit={(event) => void submit(event)} onKeyDown={onKeyDown} aria-busy={busy}>
      <Icon name="plus" className="today-quick-add-icon" aria-hidden="true" />
      <TaskTitleInput
        inputRef={inputRef}
        value={value}
        disabled={busy}
        onChange={(next) => { setValue(next); if (status) setStatus(null); }}
        parsed={parsed}
        onTokenClick={(token: TaskTitleToken) => setIgnored((current) => current.includes(token.key) ? current : [...current, token.key])}
        placeholder={t("tasks.today.quickAddPlaceholder")}
        ariaLabel={t("tasks.today.quickAddLabel")}
      />
      <button type="submit" className="today-quick-add-key" disabled={busy || !parsed.cleanTitle.trim()}>{t("tasks.today.quickAddKey")}</button>
      <span className={`today-quick-add-status ${status?.tone === "error" ? "is-error" : ""}`} role={status?.tone === "error" ? "alert" : "status"}>{status?.text ?? ""}</span>
    </form>
  );
}
