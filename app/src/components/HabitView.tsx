import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Habit } from "../types";
import {
  dateKey,
  habitCompletionDate,
  habitIsScheduledInRange,
  habitOccurrenceDates,
  habitScheduleLabel,
  habitStatus,
  habitStatusLabel,
  type HabitStatus,
} from "../lib/habits";
import { CompletionBurst } from "./CompletionBurst";
import { Icon } from "./Icon";
import "./HabitView.css";

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
const GROUP_ORDER: ScheduleGroup[] = ["daily", "weekly", "monthly", "custom"];
const GROUP_DETAILS: Record<ScheduleGroup, { label: string; hint: string }> = {
  daily: { label: "Daily", hint: "Every day" },
  weekly: { label: "Weekly", hint: "Every week" },
  monthly: { label: "Monthly", hint: "Every month" },
  custom: { label: "Custom", hint: "Your cadence" },
};

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

function compareHabits(left: Habit, right: Habit, reference: Date): number {
  return statusRank(habitStatus(left, reference)) - statusRank(habitStatus(right, reference))
    || left.title.localeCompare(right.title)
    || left.id.localeCompare(right.id);
}

const PERIOD_LABELS: Record<HabitPeriod, string> = {
  today: "Today",
  week: "This week",
  month: "This month",
  all: "All habits",
};

function periodLabel(period: HabitPeriod): string {
  return PERIOD_LABELS[period];
}

const EMPTY_TITLES: Record<HabitPeriod, string> = {
  today: "Nothing due today",
  week: "Nothing scheduled this week",
  month: "Nothing scheduled this month",
  all: "No habits yet",
};

function rangeLabel(period: HabitPeriod, from: Date, to: Date): string {
  if (period === "today") {
    return new Intl.DateTimeFormat(undefined, { weekday: "long", month: "short", day: "numeric" }).format(from);
  }
  if (period === "all") return "Every cadence";
  if (from.getMonth() === to.getMonth()) {
    return `${new Intl.DateTimeFormat(undefined, { month: "short" }).format(from)} ${from.getDate()}–${to.getDate()}`;
  }
  return `${new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(from)}–${new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(to)}`;
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

function periodSummary(period: HabitPeriod, dueCount: number, habitCount: number, progress: { completed: number; scheduled: number }): string {
  if (period === "today") return dueCount === 0 ? "All clear" : `${dueCount} due`;
  if (period === "all") return `${habitCount} habit${habitCount === 1 ? "" : "s"}`;
  if (!progress.scheduled) return `${habitCount} habit${habitCount === 1 ? "" : "s"}`;
  return `${progress.completed}/${progress.scheduled} done`;
}

export function HabitView({ habits, onAdd, onComplete, onChange, onDelete, onEdit }: Props) {
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
      .sort((left, right) => compareHabits(left, right, reference));
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
      return compareHabits(left, right, reference);
    });
  }, [completionSnapshots, from.getTime(), habits, period, reference.getTime(), to.getTime()]);

  const visibleItems = visibleHabits.map((habit) => ({ habit: completionSnapshots[habit.id]?.habit ?? habit, snapshot: completionSnapshots[habit.id] }));
  const sections = GROUP_ORDER
    .map((group) => ({ group, items: visibleItems.filter(({ habit }) => scheduleGroupFor(habit) === group) }))
    .filter(({ items }) => items.length > 0);
  const dueCount = habits.filter((habit) => ["due", "overdue"].includes(habitStatus(habit, reference))).length;
  const progress = useMemo(() => countPeriodProgress(visibleItems.map(({ habit }) => habit), from, to), [from.getTime(), to.getTime(), visibleItems]);
  const emptyTitle = EMPTY_TITLES[period];

  return (
    <section className="habits-view" aria-label="Habits">
      <div className="habits-intro">
        <div className="habits-intro-copy">
          <p className="eyebrow">Routines</p>
          <p className="habits-summary">{periodSummary(period, dueCount, habits.length, progress)}</p>
        </div>
      </div>

      <div className="habit-period-bar">
        <div className="habit-period-tabs" role="tablist" aria-label="Habit period">
          {(["today", "week", "month", "all"] as const).map((value) => (
            <button key={value} type="button" role="tab" aria-selected={period === value} className={period === value ? "active" : ""} onClick={() => setPeriod(value)}>
              {periodLabel(value)}
            </button>
          ))}
        </div>
        <span className="habit-range-label">{rangeLabel(period, from, to)}</span>
      </div>

      {period === "week" && <HabitWeekStrip habits={visibleItems.map(({ habit }) => habit)} reference={reference} from={from} />}

      {sections.length ? (
        <div className="habit-groups">
          {sections.map(({ group, items }) => (
            <section className={`habit-group habit-group-${group}`} key={group} aria-labelledby={`habit-group-${group}`}>
              <div className="habit-group-heading">
                <div className="habit-group-title-wrap">
                  <h2 id={`habit-group-${group}`} className="habit-group-title">{GROUP_DETAILS[group].label}</h2>
                  <span className="habit-group-hint">{GROUP_DETAILS[group].hint}</span>
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
          <p>Prior will bring routines back when they’re due.</p>
          <button className="secondary-button" type="button" onClick={onAdd}><Icon name="plus" /> Create a habit</button>
        </div>
      )}
    </section>
  );
}

function HabitWeekStrip({ habits, reference, from }: { readonly habits: Habit[]; readonly reference: Date; readonly from: Date }) {
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
    <div className="habit-week-card" aria-label="This week">
      <div className="habit-week-heading">
        <span>Week at a glance</span>
        <span>{totalCompleted}/{totalScheduled} done</span>
      </div>
      <ul className="habit-week-strip" aria-label="This week">
        {stats.map(({ day, key, scheduled, completed }) => {
          const isToday = key === today;
          const isMissed = key < today && scheduled > completed;
          return (
            <li className={`habit-week-day ${isToday ? "is-today" : ""} ${scheduled ? "is-scheduled" : ""} ${completed === scheduled && scheduled ? "is-done" : ""} ${isMissed ? "is-missed" : ""}`} key={key} aria-label={`${new Intl.DateTimeFormat(undefined, { weekday: "long", month: "long", day: "numeric" }).format(day)}: ${completed} of ${scheduled} complete`}>
              <span className="habit-week-day-name">{new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(day)}</span>
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
  if (period === "today" || period === "all") return null;
  const occurrences = habitOccurrenceDates(habit, from, to);
  if (!occurrences.length) return null;
  const completedDates = new Set(habit.completedDates ?? []);

  if (period === "week") {
    return (
      <div className="habit-occurrence-trail" aria-label="Scheduled dates this week">
        {occurrences.map((occurrence) => {
          const occurrenceDate = dateFromKey(occurrence);
          return (
            <span className={`habit-occurrence-chip ${completedDates.has(occurrence) ? "is-complete" : ""}`} key={occurrence} title={occurrence}>
              {new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(occurrenceDate)} {occurrenceDate.getDate()}
            </span>
          );
        })}
      </div>
    );
  }

  const completed = occurrences.filter((occurrence) => completedDates.has(occurrence)).length;
  return <span className="habit-month-progress">{completed}/{occurrences.length} this month</span>;
}

function checkAccessibilityLabel(habitTitle: string, isSaving: boolean, checkVisible: boolean): string {
  if (isSaving) return `Saving ${habitTitle}`;
  if (checkVisible) return `Mark ${habitTitle} incomplete`;
  return `Mark ${habitTitle} complete`;
}

function cardStatusLabel(isSettling: boolean, isSaving: boolean, habit: Habit, reference: Date): string {
  if (isSettling) return "Saved";
  if (isSaving) return "Saving";
  return habitStatusLabel(habit, reference);
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
  return (
    <div className="habit-card-actions">
      <button className={`task-action flag-toggle ${habit.important ? "active important" : ""}`} type="button" aria-label={`${habit.important ? "Remove" : "Mark"} important`} title={`${habit.important ? "Remove" : "Mark"} important`} aria-pressed={habit.important} onClick={onToggleImportant} disabled={disabled}><Icon name="star" /></button>
      <button className={`task-action flag-toggle ${habit.urgent ? "active urgent" : ""}`} type="button" aria-label={`${habit.urgent ? "Remove" : "Mark"} urgent`} title={`${habit.urgent ? "Remove" : "Mark"} urgent`} aria-pressed={habit.urgent} onClick={onToggleUrgent} disabled={disabled}><Icon name="bolt" /></button>
      <button className="task-action" type="button" aria-label={`Edit ${habit.title}`} title={`Edit ${habit.title}`} onClick={onEdit} disabled={disabled}><Icon name="pencil" /></button>
      <button className="task-action danger" type="button" aria-label={`Delete ${habit.title}`} title={`Delete ${habit.title}`} onClick={onDelete} disabled={disabled}><Icon name="trash" /></button>
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
    }, "Couldn’t save. Try again.", mounted);
    completionInFlight.current = false;
    if (mounted.current) setIsSaving(false);
  }

  async function changeHabit(nextHabit: Habit) {
    if (actionBusy || isSaving || isSettling) return;
    setActionBusy(true);
    setError(null);
    await runGuarded(async () => {
      await onChange(nextHabit);
    }, setError, "Couldn’t save. Try again.", mounted);
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
    }, "Couldn’t delete. Try again.", mounted);
  }

  const disabled = isSaving || actionBusy || isSettling;
  const checkVisible = checkedToday || isSettlingDateComplete;
  const statusLabel = cardStatusLabel(isSettling, isSaving, habit, reference);

  return (
    <article className={`habit-card habit-${status} ${isSettling ? "is-completing" : ""}`}>
      <span className="habit-check-wrap">
        <button className={`complete-button habit-check ${checkVisible ? "checked" : ""}`} type="button" aria-label={checkAccessibilityLabel(habit.title, isSaving, checkVisible)} onClick={() => void complete()} disabled={disabled || !completionDate}>
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
          <span className="habit-schedule-label">{habitScheduleLabel(habit)}</span>
          {habit.endDate && <span className="habit-end-date">Until {habit.endDate}</span>}
          {habit.important && <span className="habit-flag important"><Icon name="star" /> Important</span>}
          {habit.urgent && <span className="habit-flag urgent"><Icon name="bolt" /> Urgent</span>}
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
