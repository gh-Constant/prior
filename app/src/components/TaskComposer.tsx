import { useEffect, useRef, useState } from "react";
import type { Task } from "../types";
import { Icon } from "./Icon";

type Props = { onSave: (input: Pick<Task, "title" | "important" | "urgent">) => Promise<void>; onCancel: () => void };

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
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel(); }}>
      <form className="modal composer-modal" role="dialog" aria-modal="true" aria-labelledby="new-task-title" onSubmit={(event) => { event.preventDefault(); void submit(); }} onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <h2 id="new-task-title">New task</h2>
          <button type="button" className="icon-button" aria-label="Close" onClick={onCancel}><Icon name="close" /></button>
        </div>
        <div className="composer-input-row">
          <span className="composer-mark" aria-hidden="true"><Icon name="plus" /></span>
          <input ref={inputRef} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Task name" aria-label="Task title" />
        </div>
        <div className="composer-options">
          <button type="button" className={`option-button ${important ? "selected important" : ""}`} aria-pressed={important} onClick={() => setImportant((value) => !value)}><Icon name="star" /> Important</button>
          <button type="button" className={`option-button ${urgent ? "selected urgent" : ""}`} aria-pressed={urgent} onClick={() => setUrgent((value) => !value)}><Icon name="bolt" /> Urgent</button>
        </div>
        <div className="modal-footer">
          <button type="button" className="secondary-button" onClick={onCancel}>Cancel</button>
          <button className="primary-button" type="submit" disabled={!title.trim()}>Create task</button>
        </div>
      </form>
    </div>
  );
}
