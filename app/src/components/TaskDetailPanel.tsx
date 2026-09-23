import { useEffect, useRef } from "react";
import type { Project, Task, TaskPriority, TaskStatus } from "../types";
import { useI18n } from "../lib/i18n";
import { quadrantFor } from "../lib/priority";
import { dueTone, initialsFor, taskGroupStatus, TASK_GROUP_ORDER } from "../lib/taskGroups";
import { CustomSelect } from "./CustomSelect";
import { Icon } from "./Icon";
import { CalendarGlyph, InitialsAvatar, PriorityGlyph, StatusGlyph } from "./TaskGlyphs";
import { priorityLabel } from "./TaskRow";
import { DEFAULT_PROJECT_ICON, WorkspaceIcon } from "./WorkspaceIcon";
import "./TaskDetailPanel.css";

type Props = {
  readonly task: Task;
  readonly project: Pick<Project, "name" | "icon"> | null;
  readonly onChange: (task: Task) => Promise<void>;
  readonly onEdit: (task: Task) => void;
  readonly onClose: () => void;
};

const PRIORITIES: readonly TaskPriority[] = [1, 2, 3, 4];

function relativeTime(iso: string, lang: string, now = Date.now()): string | null {
  const time = new Date(iso).getTime();
  if (!Number.isFinite(time)) return null;
  const seconds = Math.round((time - now) / 1000);
  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [["year", 31_536_000], ["month", 2_592_000], ["week", 604_800], ["day", 86_400], ["hour", 3_600], ["minute", 60]];
  const format = new Intl.RelativeTimeFormat(lang, { numeric: "auto" });
  for (const [unit, size] of units) {
    if (Math.abs(seconds) >= size) return format.format(Math.round(seconds / size), unit);
  }
  return format.format(0, "minute");
}

function absoluteTime(iso: string, lang: string): string {
  const date = new Date(iso);
  return Number.isFinite(date.getTime()) ? date.toLocaleString(lang, { dateStyle: "medium", timeStyle: "short" }) : "";
}

/** Right-hand task inspector for wide desktop layouts. Every value shown is read from the task itself. */
export function TaskDetailPanel({ task, project, onChange, onEdit, onClose }: Props) {
  const { t, lang } = useI18n();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const status = taskGroupStatus(task);
  const priority = task.priority ?? 4;
  const quadrant = quadrantFor(task);
  const due = task.dueDate ? dueTone(task.dueDate) : null;
  const dueText = task.dueDate
    ? due === "today" ? t("tasks.list.dueToday") : due === "tomorrow" ? t("tasks.list.dueTomorrow") : new Date(`${task.dueDate}T00:00:00`).toLocaleDateString(lang, { weekday: "short", day: "numeric", month: "long" })
    : null;
  const updatedDiffers = Boolean(task.updatedAt && task.updatedAt !== task.createdAt);
  const completeLabel = task.completed ? t("tasks.row.markTitleIncomplete", { title: task.title }) : t("tasks.row.markTitleComplete", { title: task.title });

  // Move focus into the panel when a different task is opened, so keyboard
  // users land on the content they just asked for.
  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
  }, [task.id]);

  function changeStatus(next: TaskStatus) {
    if (next === status) return;
    void onChange({ ...task, status: next, completed: next === "done" });
  }

  return (
    <aside
      id="task-detail-panel"
      className="task-detail-panel"
      aria-label={t("tasks.detail.label")}
      onKeyDown={(event) => {
        if (event.key === "Escape" && !event.defaultPrevented) {
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <header className="task-detail-header">
        <div className="task-detail-crumbs">
          {project
            ? <span className="task-detail-crumb"><WorkspaceIcon icon={project.icon} fallback={DEFAULT_PROJECT_ICON} /><span>{project.name}</span></span>
            : <span className="task-detail-crumb"><Icon name="list" /><span>{t("common.views.allTasks")}</span></span>}
          <Icon name="chevron-right" className="task-detail-crumb-sep" aria-hidden="true" />
          <span className="task-detail-crumb current">{t("tasks.detail.task")}</span>
        </div>
        <div className="task-detail-header-actions">
          <button type="button" className="task-detail-edit" onClick={() => onEdit(task)}><Icon name="pencil" />{t("tasks.detail.edit")}</button>
          <button type="button" className="task-detail-icon-button" aria-label={t("tasks.detail.close")} title={t("tasks.detail.close")} onClick={onClose}><Icon name="close" /></button>
        </div>
      </header>

      <div className="task-detail-body">
        <div className="task-detail-title-row">
          <button type="button" className={`task-detail-check ${task.completed ? "checked" : ""}`} aria-label={completeLabel} aria-pressed={task.completed} onClick={() => void onChange({ ...task, completed: !task.completed })}>
            <Icon name="check" aria-hidden="true" />
          </button>
          <h2 ref={headingRef} tabIndex={-1} className={task.completed ? "completed" : ""}>{task.title}</h2>
        </div>
        {task.description
          ? <p className="task-detail-description">{task.description}</p>
          : <p className="task-detail-description empty">{t("tasks.detail.noDescription")}</p>}
      </div>

      <dl className="task-detail-properties">
        <div className="task-detail-property">
          <dt>{t("tasks.detail.status")}</dt>
          <dd>
            <CustomSelect<TaskStatus>
              className="task-detail-select"
              ariaLabel={t("tasks.detail.status")}
              value={status}
              onChange={changeStatus}
              options={TASK_GROUP_ORDER.map((value) => ({ value, label: t(`tasks.list.groups.${value}`) }))}
              renderTriggerLabel={(selected) => <><StatusGlyph status={status} /><span className="custom-select-text">{selected?.label}</span></>}
            />
          </dd>
        </div>
        <div className="task-detail-property">
          <dt>{t("tasks.detail.priority")}</dt>
          <dd>
            <CustomSelect<TaskPriority>
              className="task-detail-select"
              ariaLabel={t("tasks.detail.priority")}
              value={priority}
              onChange={(next) => { if (next !== priority) void onChange({ ...task, priority: next }); }}
              options={PRIORITIES.map((value) => ({ value, label: `P${value} · ${t(`tasks.list.priority${value}`)}` }))}
              renderTriggerLabel={(selected) => <><PriorityGlyph priority={priority} label={priorityLabel(priority, t)} /><span className="custom-select-text">{selected?.label}</span></>}
            />
          </dd>
        </div>
        <div className="task-detail-property">
          <dt>{t("tasks.detail.project")}</dt>
          <dd className={project ? "task-detail-value" : "task-detail-value muted"}>
            {project ? <><WorkspaceIcon icon={project.icon} fallback={DEFAULT_PROJECT_ICON} /><span>{project.name}</span></> : t("tasks.detail.noProject")}
          </dd>
        </div>
        <div className="task-detail-property">
          <dt>{t("tasks.detail.due")}</dt>
          <dd className={`task-detail-value ${dueText ? `due-${due}` : "muted"}`}>
            {dueText ? <><CalendarGlyph /><span>{dueText}{task.dueTime ? ` · ${task.dueTime}` : ""}</span>{due === "overdue" && <span className="task-detail-overdue">{t("tasks.list.dueOverdue")}</span>}</> : t("tasks.detail.noDue")}
          </dd>
        </div>
        <div className="task-detail-property">
          <dt>{t("tasks.detail.assignee")}</dt>
          <dd className={task.assigneeName ? "task-detail-value" : "task-detail-value muted"}>
            {task.assigneeName ? <><InitialsAvatar initials={initialsFor(task.assigneeName)} name={task.assigneeName} /><span>{task.assigneeName}</span></> : t("tasks.detail.unassigned")}
          </dd>
        </div>
        <div className="task-detail-property">
          <dt>{t("tasks.detail.matrix")}</dt>
          <dd className="task-detail-value task-detail-matrix">
            <span className={`task-detail-quadrant quadrant-tone-${quadrant}`}><span className="task-detail-quadrant-dot" aria-hidden="true" />{t(`tasks.matrix.${quadrant}`)}</span>
            <span className="task-detail-flags">
              <button type="button" className={`task-detail-flag important ${task.important ? "active" : ""}`} aria-pressed={task.important} aria-label={task.important ? t("tasks.row.removeImportant") : t("tasks.row.markImportant")} title={t("tasks.matrix.important")} onClick={() => void onChange({ ...task, important: !task.important })}><Icon name="star" /></button>
              <button type="button" className={`task-detail-flag urgent ${task.urgent ? "active" : ""}`} aria-pressed={task.urgent} aria-label={task.urgent ? t("tasks.row.removeUrgent") : t("tasks.row.markUrgent")} title={t("tasks.matrix.urgent")} onClick={() => void onChange({ ...task, urgent: !task.urgent })}><Icon name="bolt" /></button>
            </span>
          </dd>
        </div>
      </dl>

      <section className="task-detail-activity" aria-labelledby="task-detail-activity-heading">
        <h3 id="task-detail-activity-heading">{t("tasks.detail.activity")}</h3>
        <ol>
          {updatedDiffers && <li><span className="task-detail-activity-icon" aria-hidden="true"><Icon name="pencil" /></span><span><strong>{t("tasks.detail.updated")}</strong> <time dateTime={task.updatedAt} title={absoluteTime(task.updatedAt, lang)}>{relativeTime(task.updatedAt, lang)}</time></span></li>}
          {task.createdAt && <li><span className="task-detail-activity-icon" aria-hidden="true"><Icon name="plus" /></span><span><strong>{t("tasks.detail.created")}</strong> <time dateTime={task.createdAt} title={absoluteTime(task.createdAt, lang)}>{relativeTime(task.createdAt, lang)}</time></span></li>}
        </ol>
      </section>
    </aside>
  );
}
