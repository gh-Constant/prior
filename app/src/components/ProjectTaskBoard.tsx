import { useState, type CSSProperties } from "react";
import type { Project, ProjectType, Task, TaskStatus } from "../types";
import { useI18n } from "../lib/i18n";
import { ContextMenu, useContextMenu, type ContextMenuItem } from "./ContextMenu";
import { Icon } from "./Icon";
import { PersonAvatar } from "./collaboration/PersonAvatar";
import type { Person } from "./collaboration/types";
import { PriorityGlyph, daysBetween, formatShortDate, glyphStatus, localDateKey } from "./ProjectVisuals";
import { CalendarGlyph, StatusGlyph } from "./TaskGlyphs";

import "./ProjectDetail.css";

/** Software projects keep the full workflow; standard projects show a
 *  simpler board without the backlog/inbox triage columns. */
const SOFTWARE_BOARD_STATUSES: readonly TaskStatus[] = ["inbox", "backlog", "next", "in_progress", "waiting", "done"];
const STANDARD_BOARD_STATUSES: readonly TaskStatus[] = ["next", "in_progress", "waiting", "done"];
/** Finished work stays visible but does not take over the board. */
const DONE_PREVIEW_COUNT = 3;

export function boardStatusLabel(status: TaskStatus, t: (key: string) => string): string {
  switch (status) {
    case "inbox": return t("tasks.composer.statusInbox");
    case "backlog": return t("tasks.composer.statusBacklog");
    case "next": return t("tasks.composer.statusTodo");
    case "in_progress": return t("tasks.composer.statusInProgress");
    case "waiting": return t("tasks.composer.statusWaiting");
    case "done": return t("tasks.composer.statusDone");
  }
}

function standardBoardStatus(task: Task): TaskStatus {
  if (task.completed) return "done";
  switch (task.status as TaskStatus) {
    case "in_progress": return "in_progress";
    case "waiting": return "waiting";
    case "done": return "done";
    default: return "next";
  }
}

function softwareBoardStatus(task: Task): TaskStatus {
  if (task.completed) return "done";
  return SOFTWARE_BOARD_STATUSES.includes(task.status as TaskStatus) ? task.status as TaskStatus : "inbox";
}

/** Resolves the person shown on a card: the first assigned member, else the
 *  free-text assignee (someone the task is waiting on). */
function taskAssignee(task: Task, people: readonly Person[]): Person | null {
  const member = task.peopleIds?.map((id) => people.find((person) => person.id === id)).find(Boolean);
  if (member) return member;
  const name = task.assigneeName?.trim();
  return name ? { id: `assignee:${name}`, name } : null;
}

export function TaskDueChip({ task, today }: { task: Pick<Task, "dueDate" | "completed">; today: string }) {
  const { t, lang } = useI18n();
  if (!task.dueDate) return null;
  const due = task.dueDate.slice(0, 10);
  const delta = daysBetween(today, due);
  const tone = task.completed ? " is-done" : delta < 0 ? " is-overdue" : delta === 0 ? " is-today" : "";
  const label = delta === 0 && !task.completed ? t("common.projectHub.dueToday") : formatShortDate(due, lang);
  return <span className={`project-chip${tone}`} title={t("common.projectHub.dueOn", { date: formatShortDate(due, lang) })}><CalendarGlyph />{label}</span>;
}

function BoardCard({ task, people, today, onEdit, onDragStart, onDragEnd, onMenu, menuItems }: {
  task: Task; people: readonly Person[]; today: string; onEdit: (task: Task) => void;
  onDragStart: () => void; onDragEnd: () => void;
  onMenu: ReturnType<typeof useContextMenu>; menuItems: () => ContextMenuItem[];
}) {
  const assignee = taskAssignee(task, people);
  return <article className={`board-card${task.completed ? " is-done" : ""}`} draggable
    onDragStart={(event) => { onDragStart(); event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", task.id); }}
    onDragEnd={onDragEnd}
    onContextMenu={(event) => onMenu.openMenu(event, menuItems())}
    {...onMenu.longPress(menuItems)}>
    <button type="button" className="board-card-open" onClick={() => onEdit(task)}>
      <span className="board-card-title">{task.title}</span>
      <span className="board-card-meta">
        <PriorityGlyph priority={task.priority} />
        <TaskDueChip task={task} today={today} />
        {assignee && <PersonAvatar person={assignee} className="project-avatar board-card-avatar" showPresence={false} />}
      </span>
    </button>
  </article>;
}

export function ProjectTaskBoard({ project, tasks, onChange, onDelete, onEdit, people = [], onAddTask }: {
  readonly project: Pick<Project, "name" | "icon" | "projectType">;
  readonly tasks: Task[];
  readonly onChange: (task: Task) => Promise<void>;
  readonly onDelete: (task: Task) => Promise<void>;
  readonly onEdit: (task: Task) => void;
  /** Project members, used to show assignees. */
  readonly people?: readonly Person[];
  /** Creates a task directly in a column. */
  readonly onAddTask?: (status: TaskStatus) => void;
}) {
  const { t, tp } = useI18n();
  const contextMenu = useContextMenu();
  const [draggedTaskId, setDraggedTaskId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<TaskStatus | null>(null);
  const [showAllDone, setShowAllDone] = useState(false);
  const today = localDateKey();
  const projectType: ProjectType = project.projectType ?? "standard";
  const isStandard = projectType !== "software";
  const boardStatuses = isStandard ? STANDARD_BOARD_STATUSES : SOFTWARE_BOARD_STATUSES;
  const taskBoardStatus = (task: Task): TaskStatus => isStandard ? standardBoardStatus(task) : softwareBoardStatus(task);

  async function moveTask(taskId: string, status: TaskStatus): Promise<void> {
    const task = tasks.find((item) => item.id === taskId);
    if (!task || taskBoardStatus(task) === status) return;
    await onChange({ ...task, status, completed: status === "done" });
  }

  function endDrag(): void {
    setDraggedTaskId(null);
    setDropTarget(null);
  }

  const cardMenu = (task: Task) => (): ContextMenuItem[] => {
    const current = taskBoardStatus(task);
    return [
      { icon: "pencil", label: t("tasks.row.edit"), run: () => onEdit(task) },
      ...boardStatuses.filter((status) => status !== current).map((status): ContextMenuItem => ({
        icon: status === "done" ? "check-circle" : "arrow",
        label: t("common.projectHub.moveTo", { status: boardStatusLabel(status, t) }),
        run: () => { void moveTask(task.id, status); },
      })),
      { icon: "trash", label: t("tasks.row.deleteTitle", { title: task.title }), danger: true, run: () => { void onDelete(task); } },
    ];
  };

  return <section className={`project-board${isStandard ? " is-standard" : ""}`} aria-label={t("common.workhub.boardTab")} style={{ "--board-columns": boardStatuses.length } as CSSProperties}>
    {boardStatuses.map((status) => {
      const columnTasks = tasks.filter((task) => taskBoardStatus(task) === status);
      const sorted = status === "done" ? [...columnTasks].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)) : columnTasks;
      const collapsed = status === "done" && !showAllDone && sorted.length > DONE_PREVIEW_COUNT;
      const visible = collapsed ? sorted.slice(0, DONE_PREVIEW_COUNT) : sorted;
      const label = boardStatusLabel(status, t);
      return <section key={status} className={`project-board-column${dropTarget === status ? " is-drop-target" : ""}`} aria-label={label}
        onDragOver={(event) => { if (draggedTaskId) { event.preventDefault(); event.dataTransfer.dropEffect = "move"; setDropTarget(status); } }}
        onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropTarget(null); }}
        onDrop={(event) => { event.preventDefault(); const taskId = draggedTaskId; endDrag(); if (taskId) void moveTask(taskId, status); }}>
        <header className="project-board-column-heading">
          <StatusGlyph status={glyphStatus(status)} />
          <h3>{label}</h3>
          <span className="project-board-count">{columnTasks.length}</span>
          {onAddTask && <button type="button" className="project-board-add" aria-label={t("common.projectHub.addTaskIn", { status: label })} title={t("common.projectHub.addTaskIn", { status: label })} onClick={() => onAddTask(status)}><Icon name="plus" /></button>}
        </header>
        <div className="project-board-cards">
          {visible.map((task) => <BoardCard key={task.id} task={task} people={people} today={today} onEdit={onEdit}
            onDragStart={() => setDraggedTaskId(task.id)} onDragEnd={endDrag} onMenu={contextMenu} menuItems={cardMenu(task)} />)}
          {!columnTasks.length && <div className="project-board-empty">{t("common.workhub.boardEmpty")}</div>}
          {status === "done" && sorted.length > DONE_PREVIEW_COUNT && <button type="button" className="project-board-more" aria-expanded={!collapsed} onClick={() => setShowAllDone((value) => !value)}>
            {collapsed ? tp("common.projectHub.showMore", sorted.length - DONE_PREVIEW_COUNT) : t("common.projectHub.showLess")}
          </button>}
        </div>
      </section>;
    })}
    {contextMenu.menu && <ContextMenu x={contextMenu.menu.x} y={contextMenu.menu.y} items={contextMenu.menu.items} onClose={contextMenu.closeMenu} />}
  </section>;
}
