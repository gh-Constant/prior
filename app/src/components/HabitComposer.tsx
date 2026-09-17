import { useEffect, useRef, useState } from "react";
import type { Habit, HabitDraft, HabitUnit } from "../types";
import { dateKey, habitScheduleLabel } from "../lib/habits";
import { useModalDialog } from "../hooks/useModalDialog";
import { Icon } from "./Icon";

type Props = { readonly habit?: Habit; readonly onSave: (input: HabitDraft) => Promise<void>; readonly onCancel: () => void };

const WEEKDAYS = [
  { value: 1, short: "Mon", long: "Monday" },
  { value: 2, short: "Tue", long: "Tuesday" },
  { value: 3, short: "Wed", long: "Wednesday" },
  { value: 4, short: "Thu", long: "Thursday" },
  { value: 5, short: "Fri", long: "Friday" },
  { value: 6, short: "Sat", long: "Saturday" },
  { value: 0, short: "Sun", long: "Sunday" },
];

function today(): string {
  return dateKey(new Date());
}

export function HabitComposer({ habit, onSave, onCancel }: Props) {
  const editing = Boolean(habit);
  const initialStartDate = habit?.startDate ?? today();
  const [title, setTitle] = useState(habit?.title ?? "");
  const [important, setImportant] = useState(habit?.important ?? false);
  const [urgent, setUrgent] = useState(habit?.urgent ?? false);
  const [interval, setInterval] = useState(habit?.interval ?? 1);
  const [unit, setUnit] = useState<HabitUnit>(habit?.unit ?? "day");
  const [startDate, setStartDate] = useState(initialStartDate);
  const [endDate, setEndDate] = useState(habit?.endDate ?? "");
  const [daysOfWeek, setDaysOfWeek] = useState<number[]>(habit?.daysOfWeek ?? []);
  const [dateError, setDateError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  useModalDialog(dialogRef);

  useEffect(() => {
    if (typeof window !== "undefined" && window.matchMedia?.("(hover: none)")?.matches) return;
    inputRef.current?.focus();
  }, []);

  function toggleWeekday(value: number) {
    setDaysOfWeek((current) => current.includes(value) ? current.filter((day) => day !== value) : [...current, value].sort((left, right) => left - right));
  }

  function handleUnitChange(nextUnit: HabitUnit) {
    setUnit(nextUnit);
    if (nextUnit !== "week") setDaysOfWeek([]);
    setDateError("");
  }

  async function submit() {
    const clean = title.trim();
    if (!clean) return;
    if (endDate && endDate < startDate) {
      setDateError("The end date must be on or after the start date.");
      return;
    }
    setDateError("");
    await onSave({
      ...(habit ? { id: habit.id, completedDates: habit.completedDates, createdAt: habit.createdAt, updatedAt: habit.updatedAt, deletedAt: habit.deletedAt, serverRevision: habit.serverRevision } : {}),
      title: clean,
      important,
      urgent,
      interval: Math.max(1, Math.floor(interval) || 1),
      unit,
      startDate,
      endDate: endDate || null,
      daysOfWeek: unit === "week" ? daysOfWeek : [],
    });
  }

  function handleCancel(event: React.SyntheticEvent<HTMLDialogElement>) {
    event.preventDefault();
    onCancel();
  }

  const schedule = habitScheduleLabel({ interval, unit, daysOfWeek });

  return (
    <>
      <button type="button" className="modal-backdrop" aria-label="Close habit dialog" onClick={onCancel} />
      <dialog ref={dialogRef} className="modal composer-modal habit-composer" aria-labelledby="habit-dialog-title" onCancel={handleCancel}>
        <form onSubmit={(event) => { event.preventDefault(); void submit(); }}>
          <div className="modal-header">
            <div><p className="eyebrow">Habits</p><h2 id="habit-dialog-title">{editing ? "Edit habit" : "New habit"}</h2></div>
            <button type="button" className="icon-button" aria-label="Close" onClick={onCancel}><Icon name="close" /></button>
          </div>
          <div className="composer-input-row">
            <span className="composer-mark habit-mark" aria-hidden="true"><Icon name="calendar-check" /></span>
            <input ref={inputRef} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Habit name" aria-label="Habit title" />
          </div>

          <div className="habit-schedule-fields">
            <label className="field"><span>Repeat every</span><input type="number" min="1" max="365" value={interval} onChange={(event) => setInterval(Number(event.target.value))} /></label>
            <label className="field"><span>Period</span><select value={unit} onChange={(event) => handleUnitChange(event.target.value as HabitUnit)}><option value="day">Day</option><option value="week">Week</option><option value="month">Month</option><option value="year">Year</option></select></label>
          </div>

          {unit === "week" && <div className="habit-weekday-picker">
            <div className="habit-field-label"><span>On these days</span><small>Optional · empty uses the start day</small></div>
            <div className="habit-weekday-options" role="group" aria-label="Days of the week">
              {WEEKDAYS.map((day) => <button key={day.value} type="button" className={daysOfWeek.includes(day.value) ? "selected" : ""} aria-pressed={daysOfWeek.includes(day.value)} aria-label={day.long} onClick={() => toggleWeekday(day.value)}>{day.short}</button>)}
            </div>
          </div>}

          <div className="habit-date-fields">
            <label className="field"><span>Starts</span><input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} /></label>
            <label className="field"><span>Ends <em>optional</em></span><input type="date" min={startDate} value={endDate} onChange={(event) => setEndDate(event.target.value)} /></label>
          </div>
          <p className="habit-schedule-preview" aria-live="polite">{schedule} · {endDate ? `ends ${endDate}` : "no end date"}</p>
          {dateError && <p className="habit-form-error" role="alert">{dateError}</p>}
          <div className="composer-options">
            <button type="button" className={`option-button flag-toggle ${important ? "selected important" : ""}`} aria-pressed={important} onClick={() => setImportant((value) => !value)}><Icon name="star" /> Important</button>
            <button type="button" className={`option-button flag-toggle ${urgent ? "selected urgent" : ""}`} aria-pressed={urgent} onClick={() => setUrgent((value) => !value)}><Icon name="bolt" /> Urgent</button>
          </div>
          <div className="modal-footer"><button type="button" className="secondary-button" onClick={onCancel}>Cancel</button><button className="primary-button" type="submit" disabled={!title.trim()}>{editing ? "Save habit" : "Create habit"}</button></div>
        </form>
      </dialog>
    </>
  );
}
