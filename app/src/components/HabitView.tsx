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
  readonly weekDays: Date[];
  readonly streak: number;
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
const PERIODS: readonly HabitPeriod[] = ["today", "week", "month", "all"];
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
  const [year, month, day] = value.slice(0, 10).split("-").map(Number);
  return new Date(year, month - 1, day);
}

function formatShortDate(value: string, lang: string): string {
  const parsed = dateFromKey(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat(lang, { month: "short", day: "numeric" }).format(parsed);
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
    || (left.timeOfDay ?? "99:99").localeCompare(right.timeOfDay ?? "99:99")
    || left.title.localeCompare(right.title, lang)
    || left.id.localeCompare(right.id);
}

/**
 * Consecutive completed occurrences, counted back from the most recent one.
 * Today's still-open occurrence does not break the streak.
 */
function currentStreak(habit: Habit, reference: Date): number {
  const today = startOfDay(reference);
  const start = dateFromKey(habit.startDate ?? "");
  if (Number.isNaN(start.getTime()) || today < start) return 0;
  const todayKey = dateKey(today);
  const completed = new Set(habit.completedDates ?? []);
  const occurrences = habitOccurrenceDates(habit, start, today);
  let streak = 0;
  for (let index = occurrences.length - 1; index >= 0; index -= 1) {
    const occurrence = occurrences[index];
    if (completed.has(occurrence)) streak += 1;
    else if (occurrence === todayKey) continue;
    else break;
  }
  return streak;
}

/** Scheduled vs. completed occurrences for the summary ring. "all" measures today. */
function periodProgress(habits: Habit[], period: HabitPeriod, from: Date, to: Date): { done: number; total: number } {
  const [rangeStart, rangeEnd] = period === "all" ? [from, from] : [from, to];
  let done = 0;
  let total = 0;
  for (const habit of habits) {
    const completed = new Set(habit.completedDates ?? []);
    for (const occurrence of habitOccurrenceDates(habit, rangeStart, rangeEnd)) {
      total += 1;
      if (completed.has(occurrence)) done += 1;
    }
  }
  return { done, total };
}

const PERIOD_KEYS: Record<HabitPeriod, string> = {
  today: "habits.view.periodToday",
  week: "habits.view.periodWeek",
  month: "habits.view.periodMonth",
  all: "habits.view.periodAll",
};

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

export function HabitView({ habits, onAdd, onComplete, onChange, onDelete, onEdit }: Props) {
  const { t, lang } = useI18n();
  const [period, setPeriod] = useState<HabitPeriod>("today");
  const reference = new Date();
  const [from, to] = rangeFor(period, reference);
  const [weekStart] = rangeFor("week", reference);
  const [completionSnapshots, setCompletionSnapshots] = useState<Record<string, CompletionSnapshot>>({});
  const snapshotTimers = useRef(new Map<string, number>());
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

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
        if (period === "today") {
          const today = dateKey(reference);
          return habitOccurrenceDates(habit, from, to).includes(today) || (habit.completedDates ?? []).includes(today);
        }
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
  const weekDays = Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));
  const todayKey = dateKey(reference);

  // Summary figures are derived from the live habit data (not the held visual snapshots).
  const liveVisible = visibleHabits.map((habit) => habits.find((candidate) => candidate.id === habit.id) ?? habit);
  const streaks = new Map(visibleItems.map(({ habit }) => [habit.id, currentStreak(habit, reference)]));
  const progress = periodProgress(liveVisible, period, from, to);
  const overdueCount = liveVisible.filter((habit) => habitStatus(habit, reference) === "overdue").length;
  const bestStreak = Math.max(0, ...streaks.values());

  function focusTab(index: number) {
    const next = PERIODS[(index + PERIODS.length) % PERIODS.length];
    setPeriod(next);
    tabRefs.current[PERIODS.indexOf(next)]?.focus();
  }

  return (
    <section className="habits-view" aria-label={t("habits.view.label")}>
      <div className="habit-period-bar">
        <div className="habit-period-tabs" role="tablist" aria-label={t("habits.view.periodLabel")}>
          {PERIODS.map((value, index) => (
            <button
              key={value}
              ref={(node) => { tabRefs.current[index] = node; }}
              type="button"
              role="tab"
              aria-selected={period === value}
              tabIndex={period === value ? 0 : -1}
              className={period === value ? "active" : ""}
              onClick={() => setPeriod(value)}
              onKeyDown={(event) => {
                if (event.key === "ArrowRight") { event.preventDefault(); focusTab(index + 1); }
                else if (event.key === "ArrowLeft") { event.preventDefault(); focusTab(index - 1); }
              }}
            >
              {t(PERIOD_KEYS[value])}
            </button>
          ))}
        </div>
        <span className="habit-range-label">{rangeLabel(period, from, to, lang, t)}</span>
      </div>

      {sections.length ? (
        <>
          <HabitSummary
            done={progress.done}
            total={progress.total}
            remaining={Math.max(0, progress.total - progress.done)}
            overdue={overdueCount}
            bestStreak={bestStreak}
            periodName={t(PERIOD_KEYS[period === "all" ? "today" : period])}
          />

          <div className="habit-board">
            {sections.map(({ group, items }) => (
              <section className={`habit-group habit-group-${group}`} key={group} aria-labelledby={`habit-group-${group}`}>
                <div className="habit-group-heading">
                  <div className="habit-group-title-wrap" title={t(GROUP_KEYS[group].hint)}>
                    <h2 id={`habit-group-${group}`} className="habit-group-title">{t(GROUP_KEYS[group].label)}</h2>
                    <span className="habit-group-count">{items.length}</span>
                  </div>
                  <ol className="habit-week-legend" aria-hidden="true">
                    {weekDays.map((day) => (
                      <li key={day.getTime()} className={dateKey(day) === todayKey ? "is-today" : ""}>
                        {new Intl.DateTimeFormat(lang, { weekday: "narrow" }).format(day)}
                      </li>
                    ))}
                  </ol>
                  <span className="habit-group-spacer" aria-hidden="true" />
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
                      weekDays={weekDays}
                      streak={streaks.get(habit.id) ?? 0}
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
        </>
      ) : (
        <div className="habits-empty">
          <HabitEmptyIllustration />
          <h2>{t(EMPTY_KEYS[period])}</h2>
          <p>{t("habits.view.emptyHint")}</p>
          <div className="habits-empty-actions">
            <button className="primary-button" type="button" onClick={onAdd}><Icon name="plus" /> {t("habits.view.createHabit")}</button>
            {period !== "all" && habits.length > 0 && (
              <button className="secondary-button" type="button" onClick={() => setPeriod("all")}>{t("habits.view.periodAll")}</button>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

type HabitSummaryProps = {
  readonly done: number;
  readonly total: number;
  readonly remaining: number;
  readonly overdue: number;
  readonly bestStreak: number;
  readonly periodName: string;
};

function HabitSummary({ done, total, remaining, overdue, bestStreak, periodName }: HabitSummaryProps) {
  const { t } = useI18n();
  const ratio = total > 0 ? done / total : 0;
  const percent = Math.round(ratio * 100);
  const allDone = total > 0 && done >= total;
  return (
    <div className={`habit-summary ${allDone ? "is-complete" : ""}`} role="group" aria-label={t("habits.view.summaryLabel")}>
      <div className="habit-summary-main">
        <span className="habit-ring" role="img" aria-label={t("habits.view.progress", { completed: done, scheduled: total })}>
          <svg viewBox="0 0 48 48" aria-hidden="true">
            <circle className="habit-ring-track" cx="24" cy="24" r="20" pathLength={100} />
            <circle className="habit-ring-value" cx="24" cy="24" r="20" pathLength={100} style={{ strokeDashoffset: 100 - percent }} />
          </svg>
          <span className="habit-ring-center" aria-hidden="true">
            {allDone ? <Icon name="check" /> : `${percent}%`}
          </span>
        </span>
        <div className="habit-summary-figure">
          <strong>{done}<span>/{total}</span></strong>
          <span>{allDone ? t("habits.view.allClear") : `${t("habits.view.summaryDone")} · ${periodName}`}</span>
        </div>
      </div>
      <dl className="habit-summary-stats">
        <div className="habit-stat">
          <dt>{t("habits.view.summaryRemaining")}</dt>
          <dd>{remaining}</dd>
        </div>
        <div className={`habit-stat ${overdue ? "is-alert" : ""}`}>
          <dt>{t("habits.card.statusOverdue")}</dt>
          <dd>{overdue}</dd>
        </div>
        <div className="habit-stat">
          <dt>{t("habits.view.summaryStreak")}</dt>
          <dd><Icon name="trending-up" aria-hidden="true" />{bestStreak}</dd>
        </div>
      </dl>
    </div>
  );
}

function HabitEmptyIllustration() {
  const filled = new Set([0, 1, 3]);
  return (
    <svg className="habits-empty-art" viewBox="0 0 148 64" aria-hidden="true">
      <rect className="art-card" x="0.5" y="12.5" width="147" height="39" rx="9.5" />
      {Array.from({ length: 7 }, (_, index) => (
        <rect
          key={index}
          className={filled.has(index) ? "art-day is-done" : index === 4 ? "art-day is-today" : "art-day"}
          x={12 + index * 18}
          y={25}
          width={14}
          height={14}
          rx={4}
        />
      ))}
      <circle className="art-badge" cx="130" cy="14" r="11" />
      <path className="art-check" d="m125 14 3.4 3.4 6.6-6.8" />
    </svg>
  );
}

type WeekCellState = "done" | "missed" | "upcoming" | "open" | "off";

function HabitWeekStrip({ habit, days, reference }: { readonly habit: Habit; readonly days: Date[]; readonly reference: Date }) {
  const { t, lang } = useI18n();
  const today = dateKey(reference);
  const scheduled = new Set(habitOccurrenceDates(habit, days[0], days[days.length - 1]));
  const completed = new Set(habit.completedDates ?? []);
  const cells = days.map((day) => {
    const key = dateKey(day);
    let state: WeekCellState = "off";
    if (completed.has(key)) state = "done";
    else if (scheduled.has(key)) state = key < today ? "missed" : key === today ? "open" : "upcoming";
    return { day, key, state, isToday: key === today };
  });
  const scheduledCount = cells.filter((cell) => cell.state !== "off").length;
  const doneCount = cells.filter((cell) => cell.state === "done").length;
  const dayFormat = new Intl.DateTimeFormat(lang, { weekday: "long", day: "numeric", month: "short" });

  return (
    <ol className="habit-week" role="img" aria-label={`${t("habits.week.label")} · ${t("habits.week.progress", { completed: doneCount, scheduled: scheduledCount })}`}>
      {cells.map(({ day, key, state, isToday }) => (
        <li key={key} className={`habit-week-cell is-${state} ${isToday ? "is-today" : ""}`} title={dayFormat.format(day)} />
      ))}
    </ol>
  );
}

function checkAccessibilityLabel(habitTitle: string, isSaving: boolean, checkVisible: boolean, t: TFn): string {
  if (isSaving) return t("habits.card.savingTitle", { title: habitTitle });
  if (checkVisible) return t("habits.card.markIncompleteTitle", { title: habitTitle });
  return t("habits.card.markCompleteTitle", { title: habitTitle });
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

function HabitCard({ habit, reference, period, from, to, weekDays, streak, snapshot, onComplete, onChange, onDelete, onEdit, onVisualCompletionStart, onVisualCompletionFailure, order }: HabitCardProps) {
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
  const nextOccurrence = status === "upcoming"
    ? habitOccurrenceDates(habit, startOfDay(reference), new Date(startOfDay(reference).getTime() + 370 * DAY_MS))[0]
    : undefined;
  const monthOccurrences = period === "month" ? habitOccurrenceDates(habit, from, to) : [];
  const monthDone = monthOccurrences.filter((occurrence) => completedDates.has(occurrence)).length;

  let chip: { tone: string; label: string } | null = null;
  if (isSettling) chip = { tone: "saved", label: t("habits.card.saved") };
  else if (isSaving) chip = { tone: "saving", label: t("habits.card.saving") };
  else if (status === "overdue") chip = { tone: "overdue", label: t("habits.card.statusOverdue") };

  return (
    <article className={`habit-card habit-${status} ${checkVisible ? "is-checked" : ""} ${isSettling ? "is-completing" : ""}`}>
      <span className="habit-check-wrap">
        <button className={`habit-check ${checkVisible ? "checked" : ""}`} type="button" aria-label={checkAccessibilityLabel(habit.title, isSaving, checkVisible, t)} onClick={() => void complete()} disabled={disabled || !completionDate}>
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m3.6 8.4 2.9 2.9 5.9-6.1" pathLength={1} /></svg>
        </button>
        <CompletionBurst trigger={burst} />
      </span>
      <div className="habit-card-content">
        <div className="habit-card-heading">
          <h3>{habit.title}</h3>
          {chip && <span className={`habit-status status-${chip.tone}`}>{chip.label}</span>}
        </div>
        <div className="habit-meta">
          <span className="habit-schedule-label">{scheduleLabelFor(habit, t, tp, lang)}</span>
          {habit.timeOfDay && <span className="habit-time"><Icon name="clock" aria-hidden="true" /><span>{habit.timeOfDay}</span></span>}
          {nextOccurrence && <span className="habit-next">{t("habits.card.nextOn", { date: formatShortDate(nextOccurrence, lang) })}</span>}
          {status === "upcoming" && !nextOccurrence && <span className="habit-next">{t("habits.card.statusUpcoming")}</span>}
          {status === "ended" && <span className="habit-next">{t("habits.card.statusEnded")}</span>}
          {habit.endDate && status !== "ended" && <span className="habit-end-date">{t("habits.card.until", { date: formatShortDate(habit.endDate, lang) })}</span>}
          {monthOccurrences.length > 0 && <span className="habit-month-progress">{t("habits.view.monthProgress", { completed: monthDone, total: monthOccurrences.length })}</span>}
        </div>
        {error && <p className="habit-card-error" role="alert">{error}</p>}
      </div>
      <HabitWeekStrip habit={habit} days={weekDays} reference={reference} />
      <span className={`habit-streak ${streak > 0 ? "is-active" : ""}`} role="img" title={t("habits.card.streak", { count: streak })} aria-label={t("habits.card.streak", { count: streak })}>
        <Icon name="trending-up" aria-hidden="true" />
        <span>{streak}</span>
      </span>
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
