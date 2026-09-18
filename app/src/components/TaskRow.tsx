import { createContext, type ReactNode, useContext, useEffect, useRef, useState } from "react";
import type { Project, Task } from "../types";
import type { CompletionExitDeadlines } from "../lib/completionExit";
import { CompletionBurst } from "./CompletionBurst";
import { ContextMenu, useContextMenu } from "./ContextMenu";
import { Icon } from "./Icon";
import { DEFAULT_PROJECT_ICON, WorkspaceIcon } from "./WorkspaceIcon";

type Props = { readonly task: Task; readonly onChange: (task: Task) => Promise<void>; readonly onDelete: (task: Task) => Promise<void>; readonly onEdit?: (task: Task) => void; readonly hideFlags?: boolean; readonly project?: Pick<Project, "name" | "icon"> | null };
const CompletionExitContext = createContext<CompletionExitDeadlines>({});

function formatDueDate(value: string): string {
  return new Date(`${value}T00:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

function statusLabel(value: string | undefined): string | null {
  if (value === "next") return "Next";
  if (value === "in_progress") return "In progress";
  if (value === "waiting") return "Waiting";
  return null;
}

export function CompletionExitProvider({ deadlines, children }: { readonly deadlines: CompletionExitDeadlines; readonly children: ReactNode }) {
  return <CompletionExitContext.Provider value={deadlines}>{children}</CompletionExitContext.Provider>;
}

export function TaskRow({ task, onChange, onDelete, onEdit, hideFlags = false, project = null }: Props) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(task.title);
  const [completionBurstKey, setCompletionBurstKey] = useState(0);
  const previousCompleted = useRef(task.completed);
  const pendingCompletion = useRef(false);
  const completionInFlight = useRef(false);
  const [completionPending, setCompletionPending] = useState(false);
  const completionExitDeadlines = useContext(CompletionExitContext);
  const isExiting = task.completed && task.id in completionExitDeadlines;
  const { menu, openMenu, closeMenu, longPress } = useContextMenu();

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

  function startEditing() {
    if (onEdit) onEdit(task);
    else setEditing(true);
  }

  function handleTitleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") void saveTitle();
    else if (event.key === "Escape") setEditing(false);
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
    <div
      className={`task-row ${task.completed ? "completed" : ""} ${isExiting ? "completion-exiting" : ""}`}
      onContextMenu={(event) => openMenu(event, [
        { icon: "pencil", label: "Edit task", run: () => startEditing() },
        { icon: "check-circle", label: task.completed ? "Mark as incomplete" : "Mark as complete", run: () => void toggleCompletion() },
        { icon: "trash", label: "Delete task", danger: true, run: () => void onDelete(task) },
      ])}
      {...longPress(() => [
        { icon: "pencil", label: "Edit task", run: () => startEditing() },
        { icon: "check-circle", label: task.completed ? "Mark as incomplete" : "Mark as complete", run: () => void toggleCompletion() },
        { icon: "trash", label: "Delete task", danger: true, run: () => void onDelete(task) },
      ])}
    >
      <span className="complete-control">
        <button className={`complete-button ${task.completed ? "checked" : ""}`} type="button" aria-label={task.completed ? `Mark ${task.title} incomplete` : `Mark ${task.title} complete`} onClick={() => void toggleCompletion()} disabled={completionPending}>
          <Icon name="check" aria-hidden="true" />
        </button>
        <CompletionBurst trigger={completionBurstKey} />
      </span>
      <div className="task-content">
        {editing ? <input className="edit-input" value={title} autoFocus onChange={(event) => setTitle(event.target.value)} onBlur={() => void saveTitle()} onKeyDown={handleTitleKeyDown} /> : <button className="task-title" onDoubleClick={startEditing} onClick={startEditing}>{task.title}</button>}
        {task.description && <p className="task-description">{task.description}</p>}
        <div className="task-meta" aria-label="Task details">
          <span className={`task-priority priority-${task.priority ?? 4}`}><Icon name="flag" /> P{task.priority ?? 4}</span>
          {task.projectId && project?.name ? <span className="task-project-meta" title={project.name}><WorkspaceIcon icon={project.icon} fallback={DEFAULT_PROJECT_ICON} /><span className="task-project-name">{project.name}</span></span> : null}
          {task.dueDate && <span className="task-due-date"><Icon name="calendar-check" /> {formatDueDate(task.dueDate)}</span>}
          {statusLabel(task.status) && <span className="task-status-meta">{statusLabel(task.status)}</span>}
          {task.assigneeName && <span className="task-assignee-meta"><Icon name="user" /> {task.assigneeName}</span>}
        </div>
      </div>
      <div className="task-actions">
        {!hideFlags && <>
          <button className={`task-action flag-toggle ${task.important ? "active important" : ""}`} aria-label={`${task.important ? "Remove" : "Mark"} important`} aria-pressed={task.important} onClick={() => void onChange({ ...task, important: !task.important })}><Icon name="star" /></button>
          <button className={`task-action flag-toggle ${task.urgent ? "active urgent" : ""}`} aria-label={`${task.urgent ? "Remove" : "Mark"} urgent`} aria-pressed={task.urgent} onClick={() => void onChange({ ...task, urgent: !task.urgent })}><Icon name="bolt" /></button>
        </>}
        <button className="task-action danger" aria-label={`Delete ${task.title}`} onClick={() => void onDelete(task)}><Icon name="trash" /></button>
      </div>
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={closeMenu} />}
    </div>
  );
}
