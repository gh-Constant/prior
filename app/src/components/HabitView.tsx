import { useMemo, useState } from "react";
import type { Habit } from "../types";
import { dateKey, habitCompletionDate, habitIsScheduledInRange, habitScheduleLabel, habitStatus, habitStatusLabel, type HabitStatus } from "../lib/habits";
import { CompletionBurst } from "./CompletionBurst";
import { Icon } from "./Icon";

type HabitPeriod = "today" | "week" | "month" | "all";
type Props = {
  habits: Habit[];
  onAdd: () => void;
  onComplete: (habit: Habit, date: string) => Promise<void>;
  onChange: (habit: Habit) => Promise<void>;
  onDelete: (habit: Habit) => Promise<void>;
};

function startOfDay(value: Date): Date { const result = new Date(value); result.setHours(0, 0, 0, 0); return result; }
function rangeFor(period: HabitPeriod, reference: Date): [Date, Date] {
  const today = startOfDay(reference);
  if (period === "today") return [today, today];
  if (period === "week") {
    const monday = new Date(today); monday.setDate(today.getDate() - ((today.getDay() + 6) % 7));
    const sunday = new Date(monday); sunday.setDate(monday.getDate() + 6);
    return [monday, sunday];
  }
  const first = new Date(today.getFullYear(), today.getMonth(), 1);
  const last = new Date(today.getFullYear(), today.getMonth() + 1, 0);
  return [first, last];
}

function statusRank(status: HabitStatus): number { return status === "overdue" ? 0 : status === "due" ? 1 : status === "upcoming" ? 2 : 3; }

export function HabitView({ habits, onAdd, onComplete, onChange, onDelete }: Props) {
  const [period, setPeriod] = useState<HabitPeriod>("today");
  const reference = new Date();
  const [from, to] = rangeFor(period, reference);
  const visible = useMemo(() => habits
    .filter((habit) => {
      if (period === "all") return true;
      const status = habitStatus(habit, reference);
      return status === "overdue" || status === "complete" || habitIsScheduledInRange(habit, from, to);
    })
    .sort((left, right) => statusRank(habitStatus(left, reference)) - statusRank(habitStatus(right, reference)) || left.title.localeCompare(right.title)), [habits, period, from.getTime(), to.getTime()]);
  const dueCount = habits.filter((habit) => ["due", "overdue"].includes(habitStatus(habit, reference))).length;

  return (
    <section className="habits-view" aria-label="Habits">
      <div className="habits-intro"><div><p className="eyebrow">Routines</p><p className="habits-summary">{dueCount === 0 ? "You’re all caught up" : `${dueCount} habit${dueCount === 1 ? "" : "s"} to keep moving`}</p></div><button className="primary-button" type="button" onClick={onAdd}><Icon name="plus" /> New habit</button></div>
      <div className="habit-period-tabs" role="tablist" aria-label="Habit period">
        {(["today", "week", "month", "all"] as const).map((value) => <button key={value} type="button" role="tab" aria-selected={period === value} className={period === value ? "active" : ""} onClick={() => setPeriod(value)}>{value === "today" ? "Today" : value === "week" ? "This week" : value === "month" ? "This month" : "All habits"}</button>)}
      </div>
      {visible.length ? <div className="habit-list">{visible.map((habit) => <HabitCard key={habit.id} habit={habit} reference={reference} onComplete={onComplete} onChange={onChange} onDelete={onDelete} />)}</div> : <div className="habits-empty"><span className="habits-empty-mark"><Icon name="refresh" /></span><h2>{period === "today" ? "No habits due today" : "No habits here yet"}</h2><p>Create a routine and Prior will bring it back when it’s due.</p><button className="secondary-button" type="button" onClick={onAdd}><Icon name="plus" /> Create your first habit</button></div>}
    </section>
  );
}

function HabitCard({ habit, reference, onComplete, onChange, onDelete }: { habit: Habit; reference: Date; onComplete: Props["onComplete"]; onChange: Props["onChange"]; onDelete: Props["onDelete"] }) {
  const status = habitStatus(habit, reference);
  const [burst, setBurst] = useState(0);
  const checkedToday = habit.completedDates.includes(dateKey(reference));
  const completionDate = checkedToday ? dateKey(reference) : habitCompletionDate(habit, reference);

  async function complete() {
    if (!completionDate) return;
    setBurst((value) => value + 1);
    await onComplete(habit, completionDate);
  }

  return <article className={`habit-card habit-${status}`}>
    <span className="habit-check-wrap"><button className={`complete-button habit-check ${checkedToday ? "checked" : ""}`} type="button" aria-label={checkedToday ? `Mark ${habit.title} incomplete` : `Mark ${habit.title} complete`} onClick={() => void complete()} disabled={!completionDate}>{checkedToday && <Icon name="check" />}</button><CompletionBurst trigger={burst} /></span>
    <div className="habit-card-content"><div className="habit-card-heading"><h2>{habit.title}</h2><span className={`habit-status status-${status}`}>{habitStatusLabel(habit, reference)}</span></div><p className="habit-meta">{habitScheduleLabel(habit)}{habit.important ? " · Important" : ""}{habit.urgent ? " · Urgent" : ""}</p></div>
    <div className="habit-card-actions"><button className={`task-action ${habit.important ? "active important" : ""}`} type="button" aria-label={`${habit.important ? "Remove" : "Mark"} important`} aria-pressed={habit.important} onClick={() => void onChange({ ...habit, important: !habit.important })}><Icon name="star" /></button><button className={`task-action ${habit.urgent ? "active urgent" : ""}`} type="button" aria-label={`${habit.urgent ? "Remove" : "Mark"} urgent`} aria-pressed={habit.urgent} onClick={() => void onChange({ ...habit, urgent: !habit.urgent })}><Icon name="bolt" /></button><button className="task-action danger" type="button" aria-label={`Delete ${habit.title}`} onClick={() => void onDelete(habit)}><Icon name="trash" /></button></div>
  </article>;
}
