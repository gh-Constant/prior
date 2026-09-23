import type { CSSProperties } from "react";
import type { Project, ProjectCycle, ProjectStatus, Task, TaskPriority, TaskStatus } from "../types";
import { useI18n } from "../lib/i18n";
import { PersonAvatar } from "./collaboration/PersonAvatar";
import type { Person } from "./collaboration/types";
import { PriorityGlyph as TaskPriorityGlyph } from "./TaskGlyphs";
import { DEFAULT_PROJECT_ICON, WorkspaceIcon } from "./WorkspaceIcon";
import "./ProjectVisuals.css";

/* Shared, presentation-only building blocks for the Projects overview and
 * the project detail page. Nothing here reads stores or invents data. */

export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  active: "common.workhub.statusActive",
  planned: "common.workhub.statusPlanned",
  paused: "common.workhub.statusPaused",
  completed: "common.workhub.statusCompleted",
};

export const PROJECT_STATUS_COLORS: Record<ProjectStatus, string> = {
  active: "var(--green)",
  planned: "var(--blue)",
  paused: "var(--amber)",
  completed: "var(--violet)",
};

/** Projects have no colour field, so the tile tint is a stable function of
 *  the id: the same project always gets the same quiet hue. */
const PROJECT_TINTS = ["#5f55c4", "#2e67d1", "#1f8a7a", "#b86e0b", "#2f7d52", "#c24f7a", "#d4462b"] as const;

export function projectTint(id: string): string {
  let hash = 0;
  for (let index = 0; index < id.length; index += 1) hash = (hash * 31 + id.charCodeAt(index)) >>> 0;
  return PROJECT_TINTS[hash % PROJECT_TINTS.length];
}

export function projectTintStyle(id: string): CSSProperties {
  return { "--project-tint": projectTint(id) } as CSSProperties;
}

export function ProjectTile({ project, size = "md" }: { project: Pick<Project, "id" | "icon" | "projectType">; size?: "sm" | "md" | "lg" }) {
  return <span className={`project-tile size-${size}`} style={projectTintStyle(project.id)} aria-hidden="true">
    <WorkspaceIcon icon={project.icon} fallback={project.projectType === "software" ? "code" : DEFAULT_PROJECT_ICON} />
  </span>;
}

export function ProjectStatusChip({ status }: { status: ProjectStatus }) {
  const { t } = useI18n();
  return <span className={`project-chip project-status-chip is-${status}`}>
    <span className="project-chip-dot" aria-hidden="true" style={{ background: PROJECT_STATUS_COLORS[status] }} />
    {t(PROJECT_STATUS_LABELS[status])}
  </span>;
}

export type ProjectProgress = { completed: number; total: number; percent: number };

export function projectProgress(tasks: readonly Pick<Task, "completed">[]): ProjectProgress {
  const completed = tasks.filter((task) => task.completed).length;
  return { completed, total: tasks.length, percent: tasks.length ? Math.round((completed / tasks.length) * 100) : 0 };
}

export function ProgressBar({ percent, className = "" }: { percent: number; className?: string }) {
  return <span className={`project-progress-bar ${className}`.trim()} aria-hidden="true">
    <span style={{ width: `${Math.max(0, Math.min(100, percent))}%` }} />
  </span>;
}

export function localDateKey(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function daysBetween(from: string, to: string): number {
  const start = Date.UTC(Number(from.slice(0, 4)), Number(from.slice(5, 7)) - 1, Number(from.slice(8, 10)));
  const end = Date.UTC(Number(to.slice(0, 4)), Number(to.slice(5, 7)) - 1, Number(to.slice(8, 10)));
  return Math.round((end - start) / 86_400_000);
}

export function formatShortDate(value: string, lang: string): string {
  return new Date(`${value.slice(0, 10)}T00:00:00`).toLocaleDateString(lang, { day: "numeric", month: "short" });
}

export function formatRelativeDays(days: number, lang: string): string {
  try {
    return new Intl.RelativeTimeFormat(lang, { numeric: "auto", style: "short" }).format(days, "day");
  } catch {
    return String(days);
  }
}

export function formatPercent(percent: number, lang: string): string {
  try {
    return new Intl.NumberFormat(lang, { style: "percent", maximumFractionDigits: 0 }).format(percent / 100);
  } catch {
    return `${percent}%`;
  }
}

/** The cycle whose window contains today, if the project has one. */
export function currentCycle(cycles: readonly Pick<ProjectCycle, "id" | "name" | "startsOn" | "endsOn">[] | undefined, today = localDateKey()) {
  return cycles?.find((cycle) => cycle.startsOn <= today && today <= cycle.endsOn) ?? null;
}

/** Earliest due date among open tasks, used when the project has no target date. */
export function nextDueDate(tasks: readonly Pick<Task, "completed" | "dueDate">[]): string | null {
  return tasks.filter((task) => !task.completed && task.dueDate).map((task) => task.dueDate!.slice(0, 10)).sort()[0] ?? null;
}

export function AvatarStack({ people, max = 4, size = "sm", label }: { people: readonly Person[]; max?: number; size?: "sm" | "md"; label: string }) {
  const { tp } = useI18n();
  if (!people.length) return null;
  const shown = people.slice(0, max);
  const extra = people.length - shown.length;
  return <span className={`project-avatar-stack size-${size}`} role="group" aria-label={label}>
    {shown.map((person) => <span key={person.id} className="project-avatar-item" role="img" aria-label={person.name}><PersonAvatar person={person} className="project-avatar" showPresence={false} /></span>)}
    {extra > 0 && <span className="project-avatar-item" role="img" aria-label={tp("collab.header.moreMembers", extra)}><span className="project-avatar project-avatar-more">+{extra}</span></span>}
  </span>;
}

/** Maps a task status or a workflow-state category onto the shared status glyph. */
export function glyphStatus(status?: string | null, category?: string): TaskStatus {
  switch (status) {
    case "inbox": case "backlog": case "next": case "in_progress": case "waiting": case "done": return status;
    case "todo": return "next";
  }
  switch (category) {
    case "backlog": return "backlog";
    case "unstarted": return "next";
    case "started": return "in_progress";
    case "completed": return "done";
    default: return "inbox";
  }
}

/** Shared priority glyph with its localized label (Todoist order: 1 is most urgent). */
export function PriorityGlyph({ priority }: { priority: TaskPriority }) {
  const { t } = useI18n();
  return <TaskPriorityGlyph priority={priority} label={t("tasks.composer.priorityOption", { value: priority })} />;
}

export function UsersGlyph() {
  return <svg className="project-inline-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0" /><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18.5 14.2A6.5 6.5 0 0 1 21.5 20" /></svg>;
}
