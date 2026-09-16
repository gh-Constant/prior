import { createContext, type ReactNode, useContext, useEffect, useRef, useState } from "react";
import type { Task } from "../types";
import type { CompletionExitDeadlines } from "../lib/completionExit";
import { CompletionBurst } from "./CompletionBurst";
import { Icon } from "./Icon";

type Props = { task: Task; onChange: (task: Task) => Promise<void>; onDelete: (task: Task) => Promise<void>; onEdit?: (task: Task) => void };
const CompletionExitContext = createContext<CompletionExitDeadlines>({});

function formatDueDate(value: string): string {
  return new Date(`${value}T00:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

export function CompletionExitProvider({ deadlines, children }: { deadlines: CompletionExitDeadlines; children: ReactNode }) {
  return <CompletionExitContext.Provider value={deadlines}>{children}</CompletionExitContext.Provider>;
}

export function TaskRow({ task, onChange, onDelete, onEdit }: Props) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(task.title);
  const [completionBurstKey, setCompletionBurstKey] = useState(0);
  const previousCompleted = useRef(task.completed);
  const pendingCompletion = useRef(false);
  const completionInFlight = useRef(false);
  const [completionPending, setCompletionPending] = useState(false);
  const completionExitDeadlines = useContext(CompletionExitContext);
  const isExiting = task.completed && task.id in completionExitDeadlines;

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
    if (completionInFlight.current) return;

    const nextCompleted = !task.completed;
    completionInFlight.current = true;
    setCompletionPending(true);
    if (nextCompleted) {
      pendingCompletion.current = true;
      setCompletionBurstKey((key) => key + 1);
    }

    try {
      await onChange({ ...task, completed: nextCompleted });
    } catch (error) {
      pendingCompletion.current = false;
      console.warn("Unable to update task completion", error);
    } finally {
      completionInFlight.current = false;
      setCompletionPending(false);
    }
  }

  return (
    <div className={`task-row ${task.completed ? "completed" : ""} ${isExiting ? "completion-exiting" : ""}`}>
      <span className="complete-control">
        <button className={`complete-button ${task.completed ? "checked" : ""}`} type="button" aria-label={task.completed ? `Mark ${task.title} incomplete` : `Mark ${task.title} complete`} onClick={() => void toggleCompletion()} disabled={completionPending}>
          {task.completed && <Icon name="check" />}
        </button>
        <CompletionBurst trigger={completionBurstKey} />
      </span>
      <div className="task-content">
        {editing ? <input className="edit-input" value={title} autoFocus onChange={(event) => setTitle(event.target.value)} onBlur={() => void saveTitle()} onKeyDown={(event) => { if (event.key === "Enter") void saveTitle(); if (event.key === "Escape") setEditing(false); }} /> : <button className="task-title" onDoubleClick={() => onEdit ? onEdit(task) : setEditing(true)} onClick={() => onEdit ? onEdit(task) : setEditing(true)}>{task.title}</button>}
        {task.description && <p className="task-description">{task.description}</p>}
        <div className="task-meta" aria-label="Task details">
          <span className={`task-priority priority-${task.priority ?? 4}`}>P{task.priority ?? 4}</span>
          {task.dueDate && <span className="task-due-date"><Icon name="calendar-check" /> {formatDueDate(task.dueDate)}</span>}
        </div>
      </div>
      <div className="task-actions">
        <button className={`task-action flag-toggle ${task.important ? "active important" : ""}`} aria-label={`${task.important ? "Remove" : "Mark"} important`} aria-pressed={task.important} onClick={() => void onChange({ ...task, important: !task.important })}><Icon name="star" /></button>
        <button className={`task-action flag-toggle ${task.urgent ? "active urgent" : ""}`} aria-label={`${task.urgent ? "Remove" : "Mark"} urgent`} aria-pressed={task.urgent} onClick={() => void onChange({ ...task, urgent: !task.urgent })}><Icon name="bolt" /></button>
        <button className="task-action danger" aria-label={`Delete ${task.title}`} onClick={() => void onDelete(task)}><Icon name="trash" /></button>
      </div>
    </div>
  );
}
