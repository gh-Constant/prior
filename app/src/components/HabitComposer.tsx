import { useEffect, useRef, useState } from "react";
import type { Habit, HabitUnit } from "../types";
import { habitScheduleLabel } from "../lib/habits";
import { useModalDialog } from "../hooks/useModalDialog";
import { Icon } from "./Icon";

type HabitInput = Pick<Habit, "title" | "important" | "urgent" | "interval" | "unit">;
type Props = { readonly onSave: (input: HabitInput) => Promise<void>; readonly onCancel: () => void };

export function HabitComposer({ onSave, onCancel }: Props) {
  const [title, setTitle] = useState("");
  const [important, setImportant] = useState(false);
  const [urgent, setUrgent] = useState(false);
  const [interval, setInterval] = useState(1);
  const [unit, setUnit] = useState<HabitUnit>("day");
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  useModalDialog(dialogRef);

  useEffect(() => inputRef.current?.focus(), []);

  async function submit() {
    const clean = title.trim();
    if (!clean) return;
    await onSave({ title: clean, important, urgent, interval: Math.max(1, Math.floor(interval) || 1), unit });
  }

  function handleCancel(event: React.SyntheticEvent<HTMLDialogElement>) {
    event.preventDefault();
    onCancel();
  }

  return (
    <>
      <button type="button" className="modal-backdrop" aria-label="Close habit dialog" onClick={onCancel} />
      <dialog ref={dialogRef} className="modal composer-modal habit-composer" aria-labelledby="new-habit-title" onCancel={handleCancel}>
      <form onSubmit={(event) => { event.preventDefault(); void submit(); }}>
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
          <button type="button" className={`option-button flag-toggle ${important ? "selected important" : ""}`} aria-pressed={important} onClick={() => setImportant((value) => !value)}><Icon name="star" /> Important</button>
          <button type="button" className={`option-button flag-toggle ${urgent ? "selected urgent" : ""}`} aria-pressed={urgent} onClick={() => setUrgent((value) => !value)}><Icon name="bolt" /> Urgent</button>
        </div>
        <div className="modal-footer"><button type="button" className="secondary-button" onClick={onCancel}>Cancel</button><button className="primary-button" type="submit" disabled={!title.trim()}>Create habit</button></div>
      </form>
    </dialog>
    </>
  );
}
