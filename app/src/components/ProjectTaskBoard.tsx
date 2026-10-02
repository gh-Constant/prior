import { useMemo } from "react";
import type { Project, ProjectType, Task, TaskStatus } from "../types";
import { useI18n } from "../lib/i18n";
import { isTaskBlocked } from "../lib/kanban";
import type { ContextMenuItem } from "./ContextMenu";
import type { ProjectGroup } from "./ProjectDetailParts";
import type { Person } from "./collaboration/types";
import { KanbanBoard, type KanbanColumn } from "./kanban/KanbanBoard";
import { KanbanTaskCard } from "./kanban/TaskCard";
import { glyphStatus, localDateKey } from "./ProjectVisuals";
import { StatusGlyph } from "./TaskGlyphs";

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

function boardStatusesFor(projectType: ProjectType | undefined): readonly TaskStatus[] {
  return projectType === "software" ? SOFTWARE_BOARD_STATUSES : STANDARD_BOARD_STATUSES;
}

function boardStatusOf(task: Task, projectType: ProjectType | undefined): TaskStatus {
  return projectType === "software" ? softwareBoardStatus(task) : standardBoardStatus(task);
}

/** The board's columns as list sections (phone list), finished work folded. */
export function projectStatusGroups(projectType: ProjectType | undefined, tasks: readonly Task[], t: (key: string) => string): ProjectGroup<Task>[] {
  return boardStatusesFor(projectType).map((status) => {
    const items = tasks.filter((task) => boardStatusOf(task, projectType) === status);
    return {
      id: status,
      label: boardStatusLabel(status, t),
      glyph: <StatusGlyph status={glyphStatus(status)} />,
      items: status === "done" ? [...items].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)) : items,
      folded: status === "done",
    };
  });
}

/** Status board of one project, rendered by the shared KanbanBoard. */
export function ProjectTaskBoard({ project, tasks, onChange, onDelete, onEdit, people = [], onAddTask }: {
  readonly project: Pick<Project, "name" | "icon" | "projectType" | "methodology">;
  readonly tasks: Task[];
  readonly onChange: (task: Task) => Promise<void>;
  readonly onDelete: (task: Task) => Promise<void>;
  readonly onEdit: (task: Task) => void;
  /** Project members, used to show assignees. */
  readonly people?: readonly Person[];
  /** Creates a task directly in a column. */
  readonly onAddTask?: (status: TaskStatus) => void;
}) {
  const { t } = useI18n();
  const today = localDateKey();
  const projectType: ProjectType = project.projectType ?? "standard";
  const isStandard = projectType !== "software";
  const boardStatuses = boardStatusesFor(projectType);
  const taskBoardStatus = (task: Task): TaskStatus => boardStatusOf(task, projectType);
  const byId = useMemo(() => new Map(tasks.map((task) => [task.id, task])), [tasks]);

  async function moveTask(taskId: string, status: string): Promise<void> {
    const task = byId.get(taskId);
    if (!task || taskBoardStatus(task) === status) return;
    await onChange({ ...task, status: status as TaskStatus, completed: status === "done" });
  }

  const columns: KanbanColumn<Task>[] = boardStatuses.map((status) => {
    const columnTasks = tasks.filter((task) => taskBoardStatus(task) === status);
    return {
      id: status,
      label: boardStatusLabel(status, t),
      glyph: <StatusGlyph status={glyphStatus(status)} />,
      items: status === "done" ? [...columnTasks].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)) : columnTasks,
      canAdd: Boolean(onAddTask),
      previewCount: status === "done" ? DONE_PREVIEW_COUNT : undefined,
    };
  });

  const menuItems = (task: Task): ContextMenuItem[] => [
    { icon: "pencil", label: t("tasks.row.edit"), run: () => onEdit(task) },
    { icon: "trash", label: t("tasks.row.deleteTitle", { title: task.title }), danger: true, run: () => { void onDelete(task); } },
  ];

  return <KanbanBoard
    columns={columns}
    label={t("common.workhub.boardTab")}
    emptyLabel={t("common.workhub.boardEmpty")}
    className={isStandard ? "is-standard" : ""}
    onMove={moveTask}
    onAdd={(status) => onAddTask?.(status as TaskStatus)}
    menuItems={menuItems}
    itemClassName={(task) => task.completed ? "is-done" : ""}
    renderCard={(task) => <KanbanTaskCard task={task} today={today} people={people} sizeProject={project} blocked={isTaskBlocked(task, byId)} onOpen={onEdit} onChange={onChange} />}
  />;
}
