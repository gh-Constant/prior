import { createContext, type ReactNode, useContext, useEffect, useRef, useState } from "react";
import type { Project, Task } from "../types";
import type { CompletionExitDeadlines } from "../lib/completionExit";
import { useI18n } from "../lib/i18n";
import { CompletionBurst } from "./CompletionBurst";
import { ContextMenu, useContextMenu, type ContextMenuItem } from "./ContextMenu";
import { Icon } from "./Icon";
import { TaskStatusBadge } from "./TaskStatusBadge";
import { DEFAULT_PROJECT_ICON, WorkspaceIcon } from "./WorkspaceIcon";

type Props = { readonly task: Task; readonly onChange: (task: Task) => Promise<void>; readonly onDelete: (task: Task) => Promise<void>; readonly onEdit?: (task: Task) => void; readonly hideFlags?: boolean; readonly project?: Pick<Project, "name" | "icon"> | null };
const CompletionExitContext = createContext<CompletionExitDeadlines>({});

function formatDueDate(value: string, lang: string): string {
  return new Date(`${value}T00:00:00`).toLocaleDateString(lang, { day: "numeric", month: "short" });
}

function statusLabel(value: string | undefined, t: (key: string) => string): string {
  if (value === "backlog") return t("tasks.composer.statusBacklog");
  if (value === "done") return t("tasks.composer.statusDone");
  if (value === "next") return t("tasks.row.statusNext");
  if (value === "in_progress") return t("tasks.row.statusInProgress");
  if (value === "waiting") return t("tasks.row.statusWaiting");
  return t("tasks.composer.statusInbox");
}

export function CompletionExitProvider({ deadlines, children }: { readonly deadlines: CompletionExitDeadlines; readonly children: ReactNode }) {
  return <CompletionExitContext.Provider value={deadlines}>{children}</CompletionExitContext.Provider>;
}

export function TaskRow({ task, onChange, onDelete, onEdit, hideFlags = false, project = null }: Props) {
  const { t, lang } = useI18n();
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

  const menuItems: ContextMenuItem[] = [
    { icon: "pencil", label: t("tasks.row.edit"), run: () => startEditing() },
    { icon: "check-circle", label: task.completed ? t("tasks.row.markIncomplete") : t("tasks.row.markComplete"), run: () => void toggleCompletion() },
    { icon: "trash", label: t("tasks.row.delete"), danger: true, run: () => void onDelete(task) },
  ];
  const completeLabel = task.completed
    ? t("tasks.row.markTitleIncomplete", { title: task.title })
    : t("tasks.row.markTitleComplete", { title: task.title });

  return (
    <div
      className={`task-row ${task.completed ? "completed" : ""} ${isExiting ? "completion-exiting" : ""}`}
      onContextMenu={(event) => openMenu(event, menuItems)}
      {...longPress(() => menuItems)}
    >
      <span className="complete-control">
        <button className={`complete-button ${task.completed ? "checked" : ""}`} type="button" aria-label={completeLabel} onClick={() => void toggleCompletion()} disabled={completionPending}>
          <Icon name="check" aria-hidden="true" />
        </button>
        <CompletionBurst trigger={completionBurstKey} />
      </span>
      <div className="task-content">
        {editing ? <input className="edit-input" value={title} autoFocus onChange={(event) => setTitle(event.target.value)} onBlur={() => void saveTitle()} onKeyDown={handleTitleKeyDown} /> : <button className="task-title" onDoubleClick={startEditing} onClick={startEditing}>{task.title}</button>}
        {task.description && <p className="task-description">{task.description}</p>}
        <div className="task-meta" aria-label={t("tasks.row.details")}>
          <span className={`task-priority priority-${task.priority ?? 4}`}><Icon name="flag" /> P{task.priority ?? 4}</span>
          {task.projectId && project?.name ? <span className="task-project-meta" title={project.name}><WorkspaceIcon icon={project.icon} fallback={DEFAULT_PROJECT_ICON} /><span className="task-project-name">{project.name}</span></span> : null}
          {task.dueDate && <span className="task-due-date"><Icon name="calendar-check" /> {formatDueDate(task.dueDate, lang)}{task.dueTime ? ` · ${task.dueTime}` : ""}</span>}
          <TaskStatusBadge status={task.completed ? "done" : task.status ?? "inbox"} label={statusLabel(task.completed ? "done" : task.status, t)} />
          {task.assigneeName && <span className="task-assignee-meta"><Icon name="user" /> {task.assigneeName}</span>}
        </div>
      </div>
      <div className="task-actions">
        {!hideFlags && <>
          <button className={`task-action flag-toggle ${task.important ? "active important" : ""}`} aria-label={task.important ? t("tasks.row.removeImportant") : t("tasks.row.markImportant")} aria-pressed={task.important} onClick={() => void onChange({ ...task, important: !task.important })}><Icon name="star" /></button>
          <button className={`task-action flag-toggle ${task.urgent ? "active urgent" : ""}`} aria-label={task.urgent ? t("tasks.row.removeUrgent") : t("tasks.row.markUrgent")} aria-pressed={task.urgent} onClick={() => void onChange({ ...task, urgent: !task.urgent })}><Icon name="bolt" /></button>
        </>}
        <button className="task-action danger" aria-label={t("tasks.row.deleteTitle", { title: task.title })} onClick={() => void onDelete(task)}><Icon name="trash" /></button>
      </div>
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={closeMenu} />}
    </div>
  );
}
