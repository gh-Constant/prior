import { useEffect, useRef, useState } from "react";
import type { Task, TaskDraft, TaskPriority } from "../types";
import { useModalDialog } from "../hooks/useModalDialog";
import { Icon } from "./Icon";

type Props = { readonly task?: Task; readonly onSave: (input: TaskDraft) => Promise<void>; readonly onCancel: () => void };

export function TaskComposer({ task, onSave, onCancel }: Props) {
  const [title, setTitle] = useState(task?.title ?? "");
  const [description, setDescription] = useState(task?.description ?? "");
  const [dueDate, setDueDate] = useState(task?.dueDate ?? "");
  const [priority, setPriority] = useState<TaskPriority>(task?.priority ?? 4);
  const [important, setImportant] = useState(task?.important ?? false);
  const [urgent, setUrgent] = useState(task?.urgent ?? false);
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  useModalDialog(dialogRef);

  // Don't steal focus on touch devices: it pops the keyboard, shrinks the
  // visual viewport, and can push the sheet footer out of view.
  useEffect(() => {
    if (typeof window !== "undefined" && window.matchMedia?.("(hover: none)")?.matches) return;
    inputRef.current?.focus();
  }, []);

  async function submit() {
    const clean = title.trim();
    if (!clean) return;
    await onSave({ title: clean, description: description.trim(), dueDate: dueDate || null, priority, important, urgent });
    if (!task) {
      setTitle("");
      setDescription("");
      setDueDate("");
      setPriority(4);
      setImportant(false);
      setUrgent(false);
    }
  }

  function handleCancel(event: React.SyntheticEvent<HTMLDialogElement>) {
    event.preventDefault();
    onCancel();
  }

  return (
    <>
      <button type="button" className="modal-backdrop" aria-label="Close task dialog" onClick={onCancel} />
      <dialog ref={dialogRef} className="modal composer-modal task-composer-modal" aria-labelledby="new-task-title" onCancel={handleCancel}>
      <form onSubmit={(event) => { event.preventDefault(); void submit(); }}>
        <div className="modal-header">
          <h2 id="new-task-title">{task ? "Edit task" : "New task"}</h2>
          <button type="button" className="icon-button" aria-label="Close" onClick={onCancel}><Icon name="close" /></button>
        </div>
        <div className="composer-input-row">
          <span className="composer-mark" aria-hidden="true"><Icon name="plus" /></span>
          <input ref={inputRef} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Task name" aria-label="Task title" />
        </div>
        <textarea className="composer-description" value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Description" aria-label="Task description" rows={3} />
        <div className="composer-options task-composer-options">
          <label className="option-button due-date-option">
            <Icon name="calendar-check" />
            <span>{dueDate ? new Date(`${dueDate}T00:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "short" }) : "Due date"}</span>
            <input type="date" value={dueDate} aria-label="Due date" onChange={(event) => setDueDate(event.target.value)} />
          </label>
          <label className="option-button priority-option">
            <Icon name="star" />
            <span>Priority {priority}</span>
            <select value={priority} aria-label="Priority" onChange={(event) => setPriority(Number(event.target.value) as TaskPriority)}>
              <option value={1}>Priority 1</option>
              <option value={2}>Priority 2</option>
              <option value={3}>Priority 3</option>
              <option value={4}>Priority 4</option>
            </select>
          </label>
          <button type="button" className={`option-button flag-toggle ${important ? "selected important" : ""}`} aria-pressed={important} onClick={() => setImportant((value) => !value)}><Icon name="star" /> Important</button>
          <button type="button" className={`option-button flag-toggle ${urgent ? "selected urgent" : ""}`} aria-pressed={urgent} onClick={() => setUrgent((value) => !value)}><Icon name="bolt" /> Urgent</button>
        </div>
        <div className="modal-footer">
          <button type="button" className="secondary-button" onClick={onCancel}>Cancel</button>
          <button className="primary-button" type="submit" disabled={!title.trim()}>{task ? "Save task" : "Create task"}</button>
        </div>
      </form>
    </dialog>
    </>
  );
}
