import { useState } from "react";
import type { Project, Task } from "../../types";
import { useI18n } from "../../lib/i18n";
import { PersonAvatar } from "../collaboration/PersonAvatar";
import type { Person } from "../collaboration/types";
import { Icon } from "../Icon";
import { PriorityGlyph, daysBetween, formatShortDate } from "../ProjectVisuals";
import { CalendarGlyph } from "../TaskGlyphs";
import { DEFAULT_PROJECT_ICON, WorkspaceIcon } from "../WorkspaceIcon";
import { checklistProgress } from "../tasks/ChecklistEditor";
import { RecurrenceChip } from "../tasks/RecurrenceChip";
import { TaskSizeBadge } from "../tasks/StoryPoints";

/** Resolves the person shown on a card: the assignee, else the free-text
 *  assignee (someone the task is waiting on). */
export function taskAssignee(task: Task, people: readonly Person[]): Person | null {
  const member = task.assigneeId ? people.find((person) => person.id === task.assigneeId) : undefined;
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

type Props = {
  readonly task: Task;
  /** Local date key of today, for the due chip. */
  readonly today: string;
  readonly people?: readonly Person[];
  /** The task's project, shown as a chip (omit when columns already are projects). */
  readonly project?: Pick<Project, "name" | "icon"> | null;
  /** The project the card belongs to when it decides the size badge (story points or priority), even if the chip above is hidden. */
  readonly sizeProject?: Pick<Project, "projectType" | "methodology"> | null;
  readonly blocked?: boolean;
  readonly onOpen: (task: Task) => void;
  /** Saves the task after the completion circle was toggled. */
  readonly onChange?: (task: Task) => Promise<void>;
};

/**
 * Content of a task card (the draggable article is rendered by KanbanBoard):
 * completion circle, title, priority, due date, project, checklist progress,
 * blocked badge and assignee.
 */
export function KanbanTaskCard({ task, today, people = [], project = null, sizeProject = null, blocked = false, onOpen, onChange }: Props) {
  const { t } = useI18n();
  const [pending, setPending] = useState(false);
  const assignee = taskAssignee(task, people);
  const progress = checklistProgress(task.checklist);
  const completeLabel = task.completed ? t("tasks.row.markTitleIncomplete", { title: task.title }) : t("tasks.row.markTitleComplete", { title: task.title });

  async function toggle(): Promise<void> {
    if (!onChange || pending) return;
    setPending(true);
    try {
      await onChange({ ...task, completed: !task.completed });
    } catch (error) {
      console.warn("Unable to update task completion", error);
    } finally {
      setPending(false);
    }
  }

  return <>
    {onChange && <button type="button" className={`complete-button kanban-check${task.completed ? " checked" : ""}`} data-kanban-nodrag aria-label={completeLabel} title={completeLabel} disabled={pending} onClick={() => void toggle()}><Icon name="check" aria-hidden="true" /></button>}
    <button type="button" className={`board-card-open${onChange ? " has-check" : ""}`} onClick={() => onOpen(task)}>
      <span className="board-card-title">{task.title}</span>
      <span className="board-card-meta">
        <TaskSizeBadge task={task} project={task.projectId ? sizeProject : null} variant="project"><PriorityGlyph priority={task.priority ?? 4} /></TaskSizeBadge>
        <TaskDueChip task={task} today={today} />
        <RecurrenceChip task={task} variant="project" />
        {project && <span className="project-chip kanban-project-chip" title={project.name}><WorkspaceIcon icon={project.icon} fallback={DEFAULT_PROJECT_ICON} /><span className="project-chip-label">{project.name}</span></span>}
        {progress && <span className="project-chip" title={t("checklist.progress", { done: progress.done, total: progress.total })}><Icon name="check-circle" />{progress.done}/{progress.total}</span>}
        {blocked && <span className="project-chip is-blocked" title={t("collab.issue.blocked")}><Icon name="lock" />{t("collab.issue.blocked")}</span>}
        {assignee && <PersonAvatar person={assignee} className="project-avatar board-card-avatar" showPresence={false} />}
      </span>
    </button>
  </>;
}
