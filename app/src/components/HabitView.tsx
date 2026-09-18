import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Habit } from "../types";
import {
  dateKey,
  habitCompletionDate,
  habitIsScheduledInRange,
  habitOccurrenceDates,
  habitStatus,
  type HabitStatus,
} from "../lib/habits";
import { useI18n } from "../lib/i18n";
import { CompletionBurst } from "./CompletionBurst";
import { Icon } from "./Icon";
import "./HabitView.css";

type Vars = Record<string, string | number>;
type TFn = (key: string, vars?: Vars) => string;
type TpFn = (base: string, count: number, vars?: Vars) => string;

type HabitPeriod = "today" | "week" | "month" | "all";
type ScheduleGroup = "daily" | "weekly" | "monthly" | "custom";

type Props = {
  readonly habits: Habit[];
  readonly onAdd: () => void;
  readonly onComplete: (habit: Habit, date: string) => Promise<void>;
  readonly onChange: (habit: Habit) => Promise<void>;
  readonly onDelete: (habit: Habit) => Promise<void>;
  readonly onEdit: (habit: Habit) => void;
};

type CompletionSnapshot = {
  habit: Habit;
  completionDate: string;
  order: number;
  period: HabitPeriod;
  token: string;
};

type HabitCardProps = {
  readonly habit: Habit;
  readonly reference: Date;
  readonly period: HabitPeriod;
  readonly from: Date;
  readonly to: Date;
  readonly snapshot?: CompletionSnapshot;
  readonly onComplete: Props["onComplete"];
  readonly onChange: Props["onChange"];
  readonly onDelete: Props["onDelete"];
  readonly onEdit: Props["onEdit"];
  readonly onVisualCompletionStart: (habit: Habit, date: string, order: number) => void;
  readonly onVisualCompletionFailure: (habitId: string) => void;
  readonly order: number;
};

const VISUAL_HOLD_MS = 600;
const DAY_MS = 24 * 60 * 60 * 1000;
const GROUP_ORDER: ScheduleGroup[] = ["daily", "weekly", "monthly", "custom"];
const GROUP_KEYS: Record<ScheduleGroup, { label: string; hint: string }> = {
  daily: { label: "habits.view.groupDaily", hint: "habits.view.groupDailyHint" },
  weekly: { label: "habits.view.groupWeekly", hint: "habits.view.groupWeeklyHint" },
  monthly: { label: "habits.view.groupMonthly", hint: "habits.view.groupMonthlyHint" },
  custom: { label: "habits.view.groupCustom", hint: "habits.view.groupCustomHint" },
};

const SCHEDULE_WEEKDAY_KEYS = [
  "habits.schedule.weekdaySunday",
  "habits.schedule.weekdayMonday",
  "habits.schedule.weekdayTuesday",
  "habits.schedule.weekdayWednesday",
  "habits.schedule.weekdayThursday",
  "habits.schedule.weekdayFriday",
  "habits.schedule.weekdaySaturday",
] as const;

function joinLocalizedList(items: string[], lang = "fr"): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0];
  try {
    const formatter = new Intl.ListFormat(lang, { style: "long", type: "conjunction" });
    return formatter.format(items);
  } catch {
    const conj = lang === "fr" ? " et " : lang === "de" ? " und " : lang === "es" ? " y " : lang === "pt" ? " e " : " and ";
    return `${items.slice(0, -1).join(", ")}${conj}${items[items.length - 1]}`;
  }
}

function scheduleLabelFor(input: Pick<Habit, "interval" | "unit" | "daysOfWeek">, t: TFn, tp: TpFn, lang = "fr"): string {
  const interval = Number.isFinite(input.interval) && input.interval > 0 ? Math.floor(input.interval) : 1;
  const selected = [...new Set((input.daysOfWeek ?? []).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))].sort((left, right) => ((left + 6) % 7) - ((right + 6) % 7));
  if (input.unit === "week" && selected.length) {
    if (selected.length === 7) {
      if (interval === 1) {
        return lang === "fr" ? "Tous les jours" : lang === "en" ? "Every day" : tp("habits.schedule.day", 1);
      }
      return t("habits.schedule.everyWeeks", { count: interval, days: lang === "fr" ? "jours" : "days" });
    }
    const dayNames = selected.map((day) => {
      const raw = t(SCHEDULE_WEEKDAY_KEYS[day]);
      if (lang === "fr") {
        return raw.endsWith("s") ? raw : `${raw}s`;
      }
      return raw;
    });
    const days = joinLocalizedList(dayNames, lang);
    return interval === 1
      ? t("habits.schedule.everyDays", { days })
      : t("habits.schedule.everyWeeks", { count: interval, days });
  }
  if (input.unit === "day") {
    if (interval === 1) {
      return lang === "fr" ? "Tous les jours" : lang === "en" ? "Every day" : tp("habits.schedule.day", 1);
    }
    return tp("habits.schedule.day", interval);
  }
  if (input.unit === "week") return tp("habits.schedule.week", interval);
  if (input.unit === "month") return tp("habits.schedule.month", interval);
  return tp("habits.schedule.year", interval);
}

function statusLabelFor(habit: Habit, reference: Date, t: TFn): string {
  const status = habitStatus(habit, reference);
  if (status === "complete") return t("habits.card.statusDone");
  if (status === "due") return t("habits.card.statusDue");
  if (status === "overdue") return t("habits.card.statusOverdue");
  if (status === "ended") return t("habits.card.statusEnded");
  const start = startOfDay(reference);
  const next = habitOccurrenceDates(habit, start, new Date(start.getTime() + 370 * DAY_MS))[0];
  return next ? t("habits.card.nextOn", { date: next }) : t("habits.card.statusUpcoming");
}

function startOfDay(value: Date): Date {
  const result = new Date(value);
  result.setHours(0, 0, 0, 0);
  return result;
}

function addDays(value: Date, amount: number): Date {
  const result = new Date(value);
  result.setDate(result.getDate() + amount);
  return result;
}

function dateFromKey(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function rangeFor(period: HabitPeriod, reference: Date): [Date, Date] {
  const today = startOfDay(reference);
  if (period === "today") return [today, today];
  if (period === "week") {
    const monday = new Date(today);
    monday.setDate(today.getDate() - ((today.getDay() + 6) % 7));
    return [monday, addDays(monday, 6)];
  }
  if (period === "month") {
    return [
      new Date(today.getFullYear(), today.getMonth(), 1),
      new Date(today.getFullYear(), today.getMonth() + 1, 0),
    ];
  }
  return [today, today];
}

function intervalFor(habit: Pick<Habit, "interval">): number {
  return Number.isFinite(habit.interval) && habit.interval > 0 ? Math.floor(habit.interval) : 1;
}

function scheduleGroupFor(habit: Habit): ScheduleGroup {
  if (habit.unit === "day" && intervalFor(habit) === 1) return "daily";
  if (habit.unit === "week" && intervalFor(habit) === 1) return "weekly";
  if (habit.unit === "month" && intervalFor(habit) === 1) return "monthly";
  return "custom";
}

function statusRank(status: HabitStatus): number {
  if (status === "overdue") return 0;
  if (status === "due") return 1;
  if (status === "upcoming") return 2;
  if (status === "complete") return 3;
  return 4;
}

function compareHabits(left: Habit, right: Habit, reference: Date, lang: string): number {
  return statusRank(habitStatus(left, reference)) - statusRank(habitStatus(right, reference))
    || left.title.localeCompare(right.title, lang)
    || left.id.localeCompare(right.id);
}

const PERIOD_KEYS: Record<HabitPeriod, string> = {
  today: "habits.view.periodToday",
  week: "habits.view.periodWeek",
  month: "habits.view.periodMonth",
  all: "habits.view.periodAll",
};

function periodLabel(period: HabitPeriod, t: TFn): string {
  return t(PERIOD_KEYS[period]);
}

const EMPTY_KEYS: Record<HabitPeriod, string> = {
  today: "habits.view.emptyToday",
  week: "habits.view.emptyWeek",
  month: "habits.view.emptyMonth",
  all: "habits.view.emptyAll",
};

function rangeLabel(period: HabitPeriod, from: Date, to: Date, lang: string, t: TFn): string {
  if (period === "today") {
    return new Intl.DateTimeFormat(lang, { weekday: "long", month: "short", day: "numeric" }).format(from);
  }
  if (period === "all") return t("habits.view.everyCadence");
  if (from.getMonth() === to.getMonth()) {
    return `${new Intl.DateTimeFormat(lang, { month: "short" }).format(from)} ${from.getDate()}–${to.getDate()}`;
  }
  return `${new Intl.DateTimeFormat(lang, { month: "short", day: "numeric" }).format(from)}–${new Intl.DateTimeFormat(lang, { month: "short", day: "numeric" }).format(to)}`;
}

function countPeriodProgress(habits: Habit[], from: Date, to: Date): { completed: number; scheduled: number } {
  let completed = 0;
  let scheduled = 0;
  for (const habit of habits) {
    const completedDates = new Set(habit.completedDates ?? []);
    for (const occurrence of habitOccurrenceDates(habit, from, to)) {
      scheduled += 1;
      if (completedDates.has(occurrence)) completed += 1;
    }
  }
  return { completed, scheduled };
}

function periodSummary(period: HabitPeriod, dueCount: number, habitCount: number, progress: { completed: number; scheduled: number }, t: TFn, tp: TpFn): string {
  if (period === "today") return dueCount === 0 ? t("habits.view.allClear") : tp("habits.view.due", dueCount);
  if (period === "all") return tp("habits.view.count", habitCount);
  if (!progress.scheduled) return tp("habits.view.count", habitCount);
  return t("habits.view.progress", { completed: progress.completed, scheduled: progress.scheduled });
}

export function HabitView({ habits, onAdd, onComplete, onChange, onDelete, onEdit }: Props) {
  const { t, tp, lang } = useI18n();
  const [period, setPeriod] = useState<HabitPeriod>("today");
  const reference = new Date();
  const [from, to] = rangeFor(period, reference);
  const [completionSnapshots, setCompletionSnapshots] = useState<Record<string, CompletionSnapshot>>({});
  const snapshotTimers = useRef(new Map<string, number>());

  useEffect(() => () => {
    snapshotTimers.current.forEach((timer) => window.clearTimeout(timer));
    snapshotTimers.current.clear();
  }, []);

  const clearVisualCompletion = useCallback((habitId: string) => {
    const timer = snapshotTimers.current.get(habitId);
    if (timer !== undefined) window.clearTimeout(timer);
    snapshotTimers.current.delete(habitId);
    setCompletionSnapshots((current) => {
      if (!current[habitId]) return current;
      const next = { ...current };
      delete next[habitId];
      return next;
    });
  }, []);

  const holdVisualCompletion = useCallback((habit: Habit, completionDate: string, order: number) => {
    const completedDates = new Set(habit.completedDates ?? []);
    completedDates.add(completionDate);
    const snapshot: CompletionSnapshot = {
      habit: { ...habit, completedDates: [...completedDates] },
      completionDate,
      order,
      period,
      token: `${habit.id}:${completionDate}:${Date.now()}`,
    };
    const previousTimer = snapshotTimers.current.get(habit.id);
    if (previousTimer !== undefined) window.clearTimeout(previousTimer);
    setCompletionSnapshots((current) => ({ ...current, [habit.id]: snapshot }));
    const timer = window.setTimeout(() => {
      setCompletionSnapshots((current) => {
        if (current[habit.id]?.token !== snapshot.token) return current;
        const next = { ...current };
        delete next[habit.id];
        return next;
      });
      snapshotTimers.current.delete(habit.id);
    }, VISUAL_HOLD_MS);
    snapshotTimers.current.set(habit.id, timer);
  }, [period]);

  const visibleHabits = useMemo(() => {
    const baseVisible = habits
      .filter((habit) => {
        if (period === "all") return true;
        const status = habitStatus(habit, reference);
        return status === "overdue" || status === "complete" || habitIsScheduledInRange(habit, from, to);
      })
      .sort((left, right) => compareHabits(left, right, reference, lang));
    const baseIds = new Set(baseVisible.map((habit) => habit.id));
    const currentIndexes = new Map(baseVisible.map((habit, index) => [habit.id, index]));
    const heldOnly = Object.values(completionSnapshots)
      .filter((snapshot) => snapshot.period === period && habits.some((habit) => habit.id === snapshot.habit.id) && !baseIds.has(snapshot.habit.id))
      .map((snapshot) => snapshot.habit);
    const candidates = [...baseVisible, ...heldOnly];

    return candidates.sort((left, right) => {
      const leftSnapshot = completionSnapshots[left.id];
      const rightSnapshot = completionSnapshots[right.id];
      if (leftSnapshot && rightSnapshot) return leftSnapshot.order - rightSnapshot.order;
      if (leftSnapshot) return leftSnapshot.order - (currentIndexes.get(right.id) ?? baseVisible.length);
      if (rightSnapshot) return (currentIndexes.get(left.id) ?? baseVisible.length) - rightSnapshot.order;
      return compareHabits(left, right, reference, lang);
    });
  }, [completionSnapshots, from.getTime(), habits, lang, period, reference.getTime(), to.getTime()]);

  const visibleItems = visibleHabits.map((habit) => ({ habit: completionSnapshots[habit.id]?.habit ?? habit, snapshot: completionSnapshots[habit.id] }));
  const sections = GROUP_ORDER
    .map((group) => ({ group, items: visibleItems.filter(({ habit }) => scheduleGroupFor(habit) === group) }))
    .filter(({ items }) => items.length > 0);
  const dueCount = habits.filter((habit) => ["due", "overdue"].includes(habitStatus(habit, reference))).length;
  const progress = useMemo(() => countPeriodProgress(visibleItems.map(({ habit }) => habit), from, to), [from.getTime(), to.getTime(), visibleItems]);
  const emptyTitle = t(EMPTY_KEYS[period]);

  return (
    <section className="habits-view" aria-label={t("habits.view.label")}>
      <div className="habits-intro">
        <div className="habits-intro-copy">
          <p className="eyebrow">{t("habits.view.eyebrow")}</p>
          <p className="habits-summary">{periodSummary(period, dueCount, habits.length, progress, t, tp)}</p>
        </div>
      </div>

      <div className="habit-period-bar">
        <div className="habit-period-tabs" role="tablist" aria-label={t("habits.view.periodLabel")}>
          {(["today", "week", "month", "all"] as const).map((value) => (
            <button key={value} type="button" role="tab" aria-selected={period === value} className={period === value ? "active" : ""} onClick={() => setPeriod(value)}>
              {periodLabel(value, t)}
            </button>
          ))}
        </div>
        <span className="habit-range-label">{rangeLabel(period, from, to, lang, t)}</span>
      </div>

      {period === "week" && <HabitWeekStrip habits={visibleItems.map(({ habit }) => habit)} reference={reference} from={from} />}

      {sections.length ? (
        <div className="habit-groups">
          {sections.map(({ group, items }) => (
            <section className={`habit-group habit-group-${group}`} key={group} aria-labelledby={`habit-group-${group}`}>
              <div className="habit-group-heading">
                <div className="habit-group-title-wrap">
                  <h2 id={`habit-group-${group}`} className="habit-group-title">{t(GROUP_KEYS[group].label)}</h2>
                  <span className="habit-group-hint">{t(GROUP_KEYS[group].hint)}</span>
                </div>
                <span className="habit-group-count">{items.length}</span>
              </div>
              <div className="habit-list">
                {items.map(({ habit, snapshot }, index) => (
                  <HabitCard
                    key={habit.id}
                    habit={habit}
                    reference={reference}
                    period={period}
                    from={from}
                    to={to}
                    snapshot={snapshot}
                    order={index}
                    onComplete={onComplete}
                    onChange={onChange}
                    onDelete={onDelete}
                    onEdit={onEdit}
                    onVisualCompletionStart={holdVisualCompletion}
                    onVisualCompletionFailure={clearVisualCompletion}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <div className="habits-empty">
          <span className="habits-empty-mark"><Icon name="calendar-check" /></span>
          <h2>{emptyTitle}</h2>
          <p>{t("habits.view.emptyHint")}</p>
          <button className="secondary-button" type="button" onClick={onAdd}><Icon name="plus" /> {t("habits.view.createHabit")}</button>
        </div>
      )}
    </section>
  );
}

function HabitWeekStrip({ habits, reference, from }: { readonly habits: Habit[]; readonly reference: Date; readonly from: Date }) {
  const { t, lang } = useI18n();
  const today = dateKey(reference);
  const days = Array.from({ length: 7 }, (_, index) => addDays(from, index));
  const stats = days.map((day) => {
    const key = dateKey(day);
    let scheduled = 0;
    let completed = 0;
    for (const habit of habits) {
      if (!habitOccurrenceDates(habit, day, day).includes(key)) continue;
      scheduled += 1;
      if ((habit.completedDates ?? []).includes(key)) completed += 1;
    }
    return { day, key, scheduled, completed };
  });
  const totalScheduled = stats.reduce((total, day) => total + day.scheduled, 0);
  const totalCompleted = stats.reduce((total, day) => total + day.completed, 0);

  return (
    <div className="habit-week-card" aria-label={t("habits.week.label")}>
      <div className="habit-week-heading">
        <span>{t("habits.week.title")}</span>
        <span>{t("habits.week.progress", { completed: totalCompleted, scheduled: totalScheduled })}</span>
      </div>
      <ul className="habit-week-strip" aria-label={t("habits.week.label")}>
        {stats.map(({ day, key, scheduled, completed }) => {
          const isToday = key === today;
          const isMissed = key < today && scheduled > completed;
          return (
            <li className={`habit-week-day ${isToday ? "is-today" : ""} ${scheduled ? "is-scheduled" : ""} ${completed === scheduled && scheduled ? "is-done" : ""} ${isMissed ? "is-missed" : ""}`} key={key} aria-label={t("habits.week.dayLabel", { date: new Intl.DateTimeFormat(lang, { weekday: "long", month: "long", day: "numeric" }).format(day), completed, scheduled })}>
              <span className="habit-week-day-name">{new Intl.DateTimeFormat(lang, { weekday: "short" }).format(day)}</span>
              <span className="habit-week-day-number">{day.getDate()}</span>
              <span className="habit-week-day-progress">{scheduled ? `${completed}/${scheduled}` : "—"}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function HabitOccurrenceTrail({ habit, period, from, to }: { readonly habit: Habit; readonly period: HabitPeriod; readonly from: Date; readonly to: Date }) {
  const { t, lang } = useI18n();
  if (period === "today" || period === "all") return null;
  const occurrences = habitOccurrenceDates(habit, from, to);
  if (!occurrences.length) return null;
  const completedDates = new Set(habit.completedDates ?? []);

  if (period === "week") {
    return (
      <div className="habit-occurrence-trail" aria-label={t("habits.view.scheduledWeek")}>
        {occurrences.map((occurrence) => {
          const occurrenceDate = dateFromKey(occurrence);
          return (
            <span className={`habit-occurrence-chip ${completedDates.has(occurrence) ? "is-complete" : ""}`} key={occurrence} title={occurrence}>
              {new Intl.DateTimeFormat(lang, { weekday: "short" }).format(occurrenceDate)} {occurrenceDate.getDate()}
            </span>
          );
        })}
      </div>
    );
  }

  const completed = occurrences.filter((occurrence) => completedDates.has(occurrence)).length;
  return <span className="habit-month-progress">{t("habits.view.monthProgress", { completed, total: occurrences.length })}</span>;
}

function checkAccessibilityLabel(habitTitle: string, isSaving: boolean, checkVisible: boolean, t: TFn): string {
  if (isSaving) return t("habits.card.savingTitle", { title: habitTitle });
  if (checkVisible) return t("habits.card.markIncompleteTitle", { title: habitTitle });
  return t("habits.card.markCompleteTitle", { title: habitTitle });
}

function cardStatusLabel(isSettling: boolean, isSaving: boolean, habit: Habit, reference: Date, t: TFn): string {
  if (isSettling) return t("habits.card.saved");
  if (isSaving) return t("habits.card.saving");
  return statusLabelFor(habit, reference, t);
}

type HabitCardActionsProps = {
  readonly habit: Habit;
  readonly disabled: boolean;
  readonly onToggleImportant: () => void;
  readonly onToggleUrgent: () => void;
  readonly onDelete: () => void;
  readonly onEdit: () => void;
};

function HabitCardActions({ habit, disabled, onToggleImportant, onToggleUrgent, onDelete, onEdit }: HabitCardActionsProps) {
  const { t } = useI18n();
  const importantLabel = habit.important ? t("habits.card.removeImportant") : t("habits.card.markImportant");
  const urgentLabel = habit.urgent ? t("habits.card.removeUrgent") : t("habits.card.markUrgent");
  return (
    <div className="habit-card-actions">
      <button className={`task-action flag-toggle ${habit.important ? "active important" : ""}`} type="button" aria-label={importantLabel} title={importantLabel} aria-pressed={habit.important} onClick={onToggleImportant} disabled={disabled}><Icon name="star" /></button>
      <button className={`task-action flag-toggle ${habit.urgent ? "active urgent" : ""}`} type="button" aria-label={urgentLabel} title={urgentLabel} aria-pressed={habit.urgent} onClick={onToggleUrgent} disabled={disabled}><Icon name="bolt" /></button>
      <button className="task-action" type="button" aria-label={t("habits.card.editTitle", { title: habit.title })} title={t("habits.card.editTitle", { title: habit.title })} onClick={onEdit} disabled={disabled}><Icon name="pencil" /></button>
      <button className="task-action danger" type="button" aria-label={t("habits.card.deleteTitle", { title: habit.title })} title={t("habits.card.deleteTitle", { title: habit.title })} onClick={onDelete} disabled={disabled}><Icon name="trash" /></button>
    </div>
  );
}

async function runGuarded(action: () => Promise<void>, onError: (message: string) => void, message: string, mounted: { current: boolean }): Promise<void> {
  try {
    await action();
  } catch {
    if (mounted.current) onError(message);
  }
}

function HabitCard({ habit, reference, period, from, to, snapshot, onComplete, onChange, onDelete, onEdit, onVisualCompletionStart, onVisualCompletionFailure, order }: HabitCardProps) {
  const { t, tp, lang } = useI18n();
  const status = habitStatus(habit, reference);
  const today = dateKey(reference);
  const completedDates = new Set(habit.completedDates ?? []);
  const checkedToday = completedDates.has(today);
  const completionDate = checkedToday ? today : habitCompletionDate(habit, reference);
  const isSettling = Boolean(snapshot);
  const isSettlingDateComplete = Boolean(snapshot && completedDates.has(snapshot.completionDate));
  const [burst, setBurst] = useState(0);
  const [isSaving, setIsSaving] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);
  const completionInFlight = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  async function complete() {
    if (completionInFlight.current || isSettling || !completionDate) return;
    completionInFlight.current = true;
    setIsSaving(true);
    setError(null);
    const markingComplete = !completedDates.has(completionDate);
    if (markingComplete) {
      setBurst((value) => value + 1);
      onVisualCompletionStart(habit, completionDate, order);
    }

    await runGuarded(async () => {
      await onComplete(habit, completionDate);
    }, (message) => {
      if (markingComplete) onVisualCompletionFailure(habit.id);
      setBurst(0);
      setError(message);
    }, t("habits.card.saveError"), mounted);
    completionInFlight.current = false;
    if (mounted.current) setIsSaving(false);
  }

  async function changeHabit(nextHabit: Habit) {
    if (actionBusy || isSaving || isSettling) return;
    setActionBusy(true);
    setError(null);
    await runGuarded(async () => {
      await onChange(nextHabit);
    }, setError, t("habits.card.saveError"), mounted);
    if (mounted.current) setActionBusy(false);
  }

  async function deleteHabit() {
    if (actionBusy || isSaving || isSettling) return;
    setActionBusy(true);
    setError(null);
    await runGuarded(async () => {
      await onDelete(habit);
    }, (message) => {
      setActionBusy(false);
      setError(message);
    }, t("habits.card.deleteError"), mounted);
  }

  const disabled = isSaving || actionBusy || isSettling;
  const checkVisible = checkedToday || isSettlingDateComplete;
  const statusLabel = cardStatusLabel(isSettling, isSaving, habit, reference, t);

  return (
    <article className={`habit-card habit-${status} ${isSettling ? "is-completing" : ""}`}>
      <span className="habit-check-wrap">
        <button className={`complete-button habit-check ${checkVisible ? "checked" : ""}`} type="button" aria-label={checkAccessibilityLabel(habit.title, isSaving, checkVisible, t)} onClick={() => void complete()} disabled={disabled || !completionDate}>
          <Icon name="check" aria-hidden="true" />
        </button>
        <CompletionBurst trigger={burst} />
      </span>
      <div className="habit-card-content">
        <div className="habit-card-heading">
          <h3>{habit.title}</h3>
          <span className={`habit-status status-${status} ${isSettling ? "is-saved" : ""}`}>{statusLabel}</span>
        </div>
        <div className="habit-meta">
          <span className="habit-schedule-label">{scheduleLabelFor(habit, t, tp, lang)}</span>
          {habit.endDate && <span className="habit-end-date">{t("habits.card.until", { date: habit.endDate })}</span>}
          {habit.important && <span className="habit-flag important"><Icon name="star" /> {t("habits.card.important")}</span>}
          {habit.urgent && <span className="habit-flag urgent"><Icon name="bolt" /> {t("habits.card.urgent")}</span>}
        </div>
        <HabitOccurrenceTrail habit={habit} period={period} from={from} to={to} />
        {error && <p className="habit-card-error" role="alert">{error}</p>}
      </div>
      <HabitCardActions
        habit={habit}
        disabled={disabled}
        onEdit={() => onEdit(habit)}
        onToggleImportant={() => void changeHabit({ ...habit, important: !habit.important })}
        onToggleUrgent={() => void changeHabit({ ...habit, urgent: !habit.urgent })}
        onDelete={() => void deleteHabit()}
      />
    </article>
  );
}
