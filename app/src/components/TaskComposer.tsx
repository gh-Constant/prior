import { useEffect, useRef, useState } from "react";
import type { Task } from "../types";
import { Icon } from "./Icon";

type Props = { onSave: (input: Pick<Task, "title" | "important" | "urgent">) => Promise<void>; onCancel?: () => void };

export function TaskComposer({ onSave, onCancel }: Props) {
  const [title, setTitle] = useState("");
  const [important, setImportant] = useState(false);
  const [urgent, setUrgent] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => inputRef.current?.focus(), []);

  async function submit() {
    const clean = title.trim();
    if (!clean) return;
    await onSave({ title: clean, important, urgent });
    setTitle("");
    setImportant(false);
    setUrgent(false);
  }

  return (
    <form className="composer" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <div className="composer-input-row">
        <span className="composer-mark" aria-hidden="true"><Icon name="plus" /></span>
        <input ref={inputRef} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="What needs doing?" aria-label="Task title" />
        <button className="text-button composer-submit" type="submit" disabled={!title.trim()}>Add <span className="shortcut">↵</span></button>
      </div>
      <div className="composer-options">
        <button type="button" className={`option-button ${important ? "selected important" : ""}`} aria-pressed={important} onClick={() => setImportant((value) => !value)}><Icon name="star" /> Important</button>
        <button type="button" className={`option-button ${urgent ? "selected urgent" : ""}`} aria-pressed={urgent} onClick={() => setUrgent((value) => !value)}><Icon name="bolt" /> Urgent</button>
        {onCancel && <button type="button" className="text-button composer-cancel" onClick={onCancel}>Cancel <span className="shortcut">esc</span></button>}
      </div>
    </form>
  );
}
