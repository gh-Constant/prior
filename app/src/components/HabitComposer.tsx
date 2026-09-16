import { useEffect, useRef, useState } from "react";
import type { Habit, HabitUnit } from "../types";
import { habitScheduleLabel } from "../lib/habits";
import { Icon } from "./Icon";

type HabitInput = Pick<Habit, "title" | "important" | "urgent" | "interval" | "unit">;
type Props = { onSave: (input: HabitInput) => Promise<void>; onCancel: () => void };

export function HabitComposer({ onSave, onCancel }: Props) {
  const [title, setTitle] = useState("");
  const [important, setImportant] = useState(false);
  const [urgent, setUrgent] = useState(false);
  const [interval, setInterval] = useState(1);
  const [unit, setUnit] = useState<HabitUnit>("day");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => inputRef.current?.focus(), []);

  async function submit() {
    const clean = title.trim();
    if (!clean) return;
    await onSave({ title: clean, important, urgent, interval: Math.max(1, Math.floor(interval) || 1), unit });
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel(); }}>
      <form className="modal composer-modal habit-composer" role="dialog" aria-modal="true" aria-labelledby="new-habit-title" onSubmit={(event) => { event.preventDefault(); void submit(); }} onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <div><p className="eyebrow">Habits</p><h2 id="new-habit-title">New habit</h2></div>
          <button type="button" className="icon-button" aria-label="Close" onClick={onCancel}><Icon name="close" /></button>
        </div>
        <div className="composer-input-row">
          <span className="composer-mark habit-mark" aria-hidden="true"><Icon name="calendar-check" /></span>
          <input ref={inputRef} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Habit name" aria-label="Habit title" />
        </div>
        <div className="habit-schedule-fields">
          <label className="field"><span>Repeat every</span><input type="number" min="1" max="365" value={interval} onChange={(event) => setInterval(Number(event.target.value))} /></label>
          <label className="field"><span>Period</span><select value={unit} onChange={(event) => setUnit(event.target.value as HabitUnit)}><option value="day">Day</option><option value="week">Week</option><option value="month">Month</option><option value="year">Year</option></select></label>
        </div>
        <p className="habit-schedule-preview" aria-live="polite">{habitScheduleLabel({ interval, unit })} · starts today</p>
        <div className="composer-options">
          <button type="button" className={`option-button ${important ? "selected important" : ""}`} aria-pressed={important} onClick={() => setImportant((value) => !value)}><Icon name="star" /> Important</button>
          <button type="button" className={`option-button ${urgent ? "selected urgent" : ""}`} aria-pressed={urgent} onClick={() => setUrgent((value) => !value)}><Icon name="bolt" /> Urgent</button>
        </div>
        <div className="modal-footer"><button type="button" className="secondary-button" onClick={onCancel}>Cancel</button><button className="primary-button" type="submit" disabled={!title.trim()}>Create habit</button></div>
      </form>
    </div>
  );
}
