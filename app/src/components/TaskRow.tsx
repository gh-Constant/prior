import { createContext, type ReactNode, useContext, useEffect, useRef, useState } from "react";
import type { Project, Task } from "../types";
import type { CompletionExitDeadlines } from "../lib/completionExit";
import { useI18n } from "../lib/i18n";
import { dueTone, initialsFor, taskGroupStatus } from "../lib/taskGroups";
import { CompletionBurst } from "./CompletionBurst";
import { ContextMenu, useContextMenu, type ContextMenuItem } from "./ContextMenu";
import { Icon } from "./Icon";
import { CalendarGlyph, InitialsAvatar, MoreGlyph, PriorityGlyph, StatusGlyph } from "./TaskGlyphs";
import { TaskStatusBadge } from "./TaskStatusBadge";
import { DEFAULT_PROJECT_ICON, WorkspaceIcon } from "./WorkspaceIcon";

/**
 * - `default`: the original two-line row used by Today, projects and waiting.
 * - `compact`: single-line, Linear-like row (all tasks list, matrix).
 * - `card`: compact board card (title, then one meta line).
 */
export type TaskRowVariant = "default" | "compact" | "card";

type Props = {
  readonly task: Task;
  readonly onChange: (task: Task) => Promise<void>;
  readonly onDelete: (task: Task) => Promise<void>;
  readonly onEdit?: (task: Task) => void;
  readonly hideFlags?: boolean;
  readonly hideNextStatus?: boolean;
  readonly project?: Pick<Project, "name" | "icon"> | null;
  readonly variant?: TaskRowVariant;
  /** Compact/card only: clicking the title opens a detail view instead of the editor. */
  readonly onOpen?: (task: Task) => void;
  /** Compact/card only: the row is the one shown in the detail panel. */
  readonly selected?: boolean;
  /** Compact only: lead with the workflow glyph (list) or a plain check (matrix). */
  readonly leading?: "status" | "check";
  /** Compact only: show the priority glyph before the status. */
  readonly showPriority?: boolean;
};
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

/** Accessible priority name, e.g. "Priority 1 · Urgent". */
export function priorityLabel(priority: Task["priority"], t: (key: string, vars?: Record<string, string | number>) => string): string {
  return t("tasks.list.priorityLabel", { value: priority, name: t(`tasks.list.priority${priority}`) });
}

/** Short due label: Today / Tomorrow / 23 Sept, plus the tone used for colour. */
export function dueLabel(task: Pick<Task, "dueDate" | "dueTime">, lang: string, t: (key: string) => string): { label: string; tone: ReturnType<typeof dueTone> } | null {
  if (!task.dueDate) return null;
  const tone = dueTone(task.dueDate);
  const day = tone === "today" ? t("tasks.list.dueToday") : tone === "tomorrow" ? t("tasks.list.dueTomorrow") : formatDueDate(task.dueDate, lang);
  return { label: task.dueTime ? `${day} · ${task.dueTime}` : day, tone };
}

export function CompletionExitProvider({ deadlines, children }: { readonly deadlines: CompletionExitDeadlines; readonly children: ReactNode }) {
  return <CompletionExitContext.Provider value={deadlines}>{children}</CompletionExitContext.Provider>;
}

export function TaskRow({ task, onChange, onDelete, onEdit, hideFlags = false, hideNextStatus = false, project = null, variant = "default", onOpen, selected = false, leading = "status", showPriority = true }: Props) {
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
  const { menu, openMenu, openMenuAt, closeMenu, longPress } = useContextMenu();

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

  const titleControl = editing
    ? <input className="edit-input" value={title} autoFocus aria-label={t("tasks.composer.titleLabel")} onChange={(event) => setTitle(event.target.value)} onBlur={() => void saveTitle()} onKeyDown={handleTitleKeyDown} />
    : <button className="task-title" type="button" onDoubleClick={startEditing} onClick={onOpen && variant !== "default" ? () => onOpen(task) : startEditing} aria-expanded={onOpen && variant !== "default" ? selected : undefined}>{task.title}</button>;

  const flagActions = !hideFlags && <>
    <button type="button" className={`task-action flag-toggle ${task.important ? "active important" : ""}`} aria-label={task.important ? t("tasks.row.removeImportant") : t("tasks.row.markImportant")} aria-pressed={task.important} onClick={() => void onChange({ ...task, important: !task.important })}><Icon name="star" /></button>
    <button type="button" className={`task-action flag-toggle ${task.urgent ? "active urgent" : ""}`} aria-label={task.urgent ? t("tasks.row.removeUrgent") : t("tasks.row.markUrgent")} aria-pressed={task.urgent} onClick={() => void onChange({ ...task, urgent: !task.urgent })}><Icon name="bolt" /></button>
  </>;

  const rowProps = {
    onContextMenu: (event: React.MouseEvent) => openMenu(event, menuItems),
    ...longPress(() => menuItems),
  };
  const menuElement = menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={closeMenu} />;

  if (variant === "compact" || variant === "card") {
    const status = taskGroupStatus(task);
    const due = dueLabel(task, lang, t);
    const showStatusChip = variant === "compact" && leading === "check" && !task.completed && (status === "in_progress" || status === "waiting");
    const initials = task.assigneeName ? initialsFor(task.assigneeName) : "";
    const useStatusGlyph = variant === "card" || leading === "status";
    const completeControl = (
      <span className="complete-control">
        <button className={`complete-button ${task.completed ? "checked" : ""} ${useStatusGlyph ? "status-toggle" : ""}`} type="button" aria-label={completeLabel} title={completeLabel} onClick={() => void toggleCompletion()} disabled={completionPending}>
          {useStatusGlyph && !task.completed && <StatusGlyph status={status} />}
          <Icon name="check" aria-hidden="true" />
        </button>
        <CompletionBurst trigger={completionBurstKey} />
      </span>
    );
    const moreButton = (
      <button
        type="button"
        className="task-action task-more"
        aria-label={t("tasks.list.moreActions", { title: task.title })}
        aria-haspopup="menu"
        onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          openMenuAt(rect.right - 200, rect.bottom + 4, menuItems);
        }}
      ><MoreGlyph /></button>
    );
    const projectChip = task.projectId && project?.name
      ? <span className="task-chip task-project-meta" title={project.name}><WorkspaceIcon icon={project.icon} fallback={DEFAULT_PROJECT_ICON} /><span className="task-project-name">{project.name}</span></span>
      : null;
    const dueChip = due && <span className={`task-chip task-due-chip due-${due.tone}`} title={due.tone === "overdue" ? t("tasks.list.dueOverdue") : undefined}><CalendarGlyph />{due.label}</span>;
    const avatar = initials && task.assigneeName ? <InitialsAvatar initials={initials} name={task.assigneeName} /> : null;
    const className = `task-row task-row-${variant} ${task.completed ? "completed" : ""} ${isExiting ? "completion-exiting" : ""} ${selected ? "selected" : ""}`;

    if (variant === "card") {
      return (
        <div className={className} {...rowProps}>
          <div className="task-card-main">
            {completeControl}
            <div className="task-content">{titleControl}</div>
            <div className="task-actions">{moreButton}</div>
          </div>
          <div className="task-meta" aria-label={t("tasks.row.details")}>
            <PriorityGlyph priority={task.priority ?? 4} label={priorityLabel(task.priority ?? 4, t)} />
            {task.important && <span className="task-flag-mark important" role="img" aria-label={t("tasks.composer.important")} title={t("tasks.composer.important")}><Icon name="star" /></span>}
            {task.urgent && <span className="task-flag-mark urgent" role="img" aria-label={t("tasks.composer.urgent")} title={t("tasks.composer.urgent")}><Icon name="bolt" /></span>}
            {dueChip}
            {projectChip}
            {avatar && <span className="task-meta-end">{avatar}</span>}
          </div>
          {menuElement}
        </div>
      );
    }

    return (
      <div className={className} {...rowProps}>
        {showPriority && <PriorityGlyph priority={task.priority ?? 4} label={priorityLabel(task.priority ?? 4, t)} />}
        {completeControl}
        <div className="task-content">{titleControl}</div>
        <div className="task-actions">
          {flagActions}
          {moreButton}
        </div>
        <div className="task-meta" aria-label={t("tasks.row.details")}>
          {showStatusChip && <TaskStatusBadge status={status} label={statusLabel(status, t)} />}
          {projectChip}
          {dueChip}
          {avatar}
        </div>
        {menuElement}
      </div>
    );
  }

  return (
    <div
      className={`task-row ${task.completed ? "completed" : ""} ${isExiting ? "completion-exiting" : ""}`}
      {...rowProps}
    >
      <span className="complete-control">
        <button className={`complete-button ${task.completed ? "checked" : ""}`} type="button" aria-label={completeLabel} onClick={() => void toggleCompletion()} disabled={completionPending}>
          <Icon name="check" aria-hidden="true" />
        </button>
        <CompletionBurst trigger={completionBurstKey} />
      </span>
      <div className="task-content">
        {titleControl}
        {task.description && <p className="task-description">{task.description}</p>}
        <div className="task-meta" aria-label={t("tasks.row.details")}>
          <span className={`task-priority priority-${task.priority ?? 4}`}><Icon name="flag" /> P{task.priority ?? 4}</span>
          {task.projectId && project?.name ? <span className="task-project-meta" title={project.name}><WorkspaceIcon icon={project.icon} fallback={DEFAULT_PROJECT_ICON} /><span className="task-project-name">{project.name}</span></span> : null}
          {task.dueDate && <span className="task-due-date"><Icon name="calendar-check" /> {formatDueDate(task.dueDate, lang)}{task.dueTime ? ` · ${task.dueTime}` : ""}</span>}
          {!(hideNextStatus && !task.completed && task.status === "next") && <TaskStatusBadge status={task.completed ? "done" : task.status ?? "inbox"} label={statusLabel(task.completed ? "done" : task.status, t)} />}
          {task.assigneeName && <span className="task-assignee-meta"><Icon name="user" /> {task.assigneeName}</span>}
        </div>
      </div>
      <div className="task-actions">
        {flagActions}
        <button type="button" className="task-action danger" aria-label={t("tasks.row.deleteTitle", { title: task.title })} onClick={() => void onDelete(task)}><Icon name="trash" /></button>
      </div>
      {menuElement}
    </div>
  );
}
