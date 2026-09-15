import { useEffect, useRef, useState } from "react";
import type { Task } from "../types";
import { CompletionBurst } from "./CompletionBurst";
import { Icon } from "./Icon";

type Props = { task: Task; onChange: (task: Task) => Promise<void>; onDelete: (task: Task) => Promise<void> };

export function TaskRow({ task, onChange, onDelete }: Props) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(task.title);
  const [completionBurstKey, setCompletionBurstKey] = useState(0);
  const previousCompleted = useRef(task.completed);
  const pendingCompletion = useRef(false);

  useEffect(() => {
    const transitionedToCompleted = !previousCompleted.current && task.completed;
    if (transitionedToCompleted) {
      if (!pendingCompletion.current) setCompletionBurstKey((key) => key + 1);
      pendingCompletion.current = false;
    } else if (!task.completed) {
      setCompletionBurstKey(0);
    }
    previousCompleted.current = task.completed;
  }, [task.completed]);

  async function saveTitle() {
    const nextTitle = title.trim();
    if (nextTitle && nextTitle !== task.title) await onChange({ ...task, title: nextTitle });
    setEditing(false);
  }

  async function toggleCompletion() {
    const nextCompleted = !task.completed;
    if (nextCompleted) {
      pendingCompletion.current = true;
      setCompletionBurstKey((key) => key + 1);
    }

    try {
      await onChange({ ...task, completed: nextCompleted });
    } catch (error) {
      if (nextCompleted) pendingCompletion.current = false;
      throw error;
    }
  }

  return (
    <div className={`task-row ${task.completed ? "completed" : ""}`}>
      <span className="complete-control">
        <button className={`complete-button ${task.completed ? "checked" : ""}`} aria-label={task.completed ? `Mark ${task.title} incomplete` : `Mark ${task.title} complete`} onClick={() => void toggleCompletion()}>
          {task.completed && <Icon name="check" />}
        </button>
        <CompletionBurst trigger={completionBurstKey} />
      </span>
      {editing ? <input className="edit-input" value={title} autoFocus onChange={(event) => setTitle(event.target.value)} onBlur={() => void saveTitle()} onKeyDown={(event) => { if (event.key === "Enter") void saveTitle(); if (event.key === "Escape") setEditing(false); }} /> : <button className="task-title" onDoubleClick={() => setEditing(true)} onClick={() => setEditing(true)}>{task.title}</button>}
      <div className="task-actions">
        <button className={`task-action ${task.important ? "active important" : ""}`} aria-label={`${task.important ? "Remove" : "Mark"} important`} aria-pressed={task.important} onClick={() => void onChange({ ...task, important: !task.important })}><Icon name="star" /></button>
        <button className={`task-action ${task.urgent ? "active urgent" : ""}`} aria-label={`${task.urgent ? "Remove" : "Mark"} urgent`} aria-pressed={task.urgent} onClick={() => void onChange({ ...task, urgent: !task.urgent })}><Icon name="bolt" /></button>
        <button className="task-action danger" aria-label={`Delete ${task.title}`} onClick={() => void onDelete(task)}><Icon name="trash" /></button>
      </div>
    </div>
  );
}
