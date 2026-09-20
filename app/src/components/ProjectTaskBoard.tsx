import { useState } from "react";
import type { Project, ProjectType, Task, TaskStatus } from "../types";
import { useI18n } from "../lib/i18n";
import { taskStatusVariables } from "../lib/taskStatusAppearance";
import { Icon } from "./Icon";
import { TaskRow } from "./TaskRow";
import { TaskStatusBadge } from "./TaskStatusBadge";

import "./WorkHubView.css";

/** Software projects keep the full workflow; standard projects show a
 *  simpler board without the backlog/inbox triage columns. */
const SOFTWARE_BOARD_STATUSES: readonly TaskStatus[] = ["inbox", "backlog", "next", "in_progress", "waiting", "done"];
const STANDARD_BOARD_STATUSES: readonly TaskStatus[] = ["next", "in_progress", "waiting", "done"];

function statusLabel(status: TaskStatus, t: (key: string) => string): string {
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

export function ProjectTaskBoard({ project, tasks, onChange, onDelete, onEdit }: {
  readonly project: Pick<Project, "name" | "icon" | "projectType">;
  readonly tasks: Task[];
  readonly onChange: (task: Task) => Promise<void>;
  readonly onDelete: (task: Task) => Promise<void>;
  readonly onEdit: (task: Task) => void;
}) {
  const { t } = useI18n();
  const [draggedTaskId, setDraggedTaskId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<TaskStatus | null>(null);
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

  return <section className={`project-task-board${isStandard ? " standard-board" : ""}`} aria-label={t("common.workhub.boardTab")}>
    {boardStatuses.map((status) => {
      const columnTasks = tasks.filter((task) => taskBoardStatus(task) === status);
      const label = statusLabel(status, t);
      return <section key={status} className={`project-task-board-column${dropTarget === status ? " is-drop-target" : ""}`} aria-label={label} style={taskStatusVariables(status)}
        onDragOver={(event) => { if (draggedTaskId) { event.preventDefault(); setDropTarget(status); } }}
        onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropTarget(null); }}
        onDrop={(event) => { event.preventDefault(); const taskId = draggedTaskId; endDrag(); if (taskId) void moveTask(taskId, status); }}>
        <header className="project-task-board-column-heading"><h3><TaskStatusBadge status={status} label={label} /></h3><span>{columnTasks.length}</span></header>
        <div className="project-task-board-cards">
          {columnTasks.map((task) => <article key={task.id} className="project-task-board-card" draggable onDragStart={(event) => { setDraggedTaskId(task.id); event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", task.id); }} onDragEnd={endDrag}>
            <TaskRow task={task} project={project} onChange={onChange} onDelete={onDelete} onEdit={onEdit} />
          </article>)}
          {!columnTasks.length && <div className="project-task-board-empty"><Icon name="arrow" /><span>{t("common.workhub.boardEmpty")}</span></div>}
        </div>
      </section>;
    })}
  </section>;
}
