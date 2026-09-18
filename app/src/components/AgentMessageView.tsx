import type {
  AgentMessage,
  HabitDraft,
  NoteDraft,
  NoteFolderDraft,
  ProjectStatus,
  ProposedArea,
  ProposedFolder,
  ProposedHabit,
  ProposedNote,
  ProposedProject,
  ProposedTask,
  QuadrantKey,
  Task,
  TaskDraft,
} from "../types";
import { quadrantFor } from "../lib/priority";
import { renderChatMarkdown } from "../lib/chatMarkdown";
import { habitScheduleLabel } from "../lib/habits";
import { useI18n } from "../lib/i18n";
import { AgentIdentity } from "./AgentIdentity";
import { Icon } from "./Icon";
import "katex/dist/katex.min.css";

export function getQuadrantBadge(task: Pick<Task, "important" | "urgent">): { key: QuadrantKey; label: string } {
  // NOTE: UI labels come from agent.quadrant.* via quadrantLabel() below.
  // The English label here is kept for backward compatibility only.
  const key = quadrantFor(task);
  switch (key) {
    case "focus":
      return { key, label: "Focus (Do First)" };
    case "plan":
      return { key, label: "Plan (Schedule)" };
    case "quick":
      return { key, label: "Quick (Delegate)" };
    case "later":
      return { key, label: "Later (Eliminate)" };
  }
}

function formatDueDate(value: string): string {
  return new Date(`${value}T00:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

function quadrantLabel(t: (key: string) => string, key: QuadrantKey): string {
  switch (key) {
    case "focus":
      return t("agent.quadrant.focus");
    case "plan":
      return t("agent.quadrant.plan");
    case "quick":
      return t("agent.quadrant.quick");
    case "later":
      return t("agent.quadrant.later");
  }
}

export function updateAreaProposal(
  messages: AgentMessage[],
  messageId: string,
  areaId: string,
  update: Partial<ProposedArea>,
): AgentMessage[] {
  return messages.map((msg) => {
    if (msg.id !== messageId || !msg.proposedAreas) return msg;
    return { ...msg, proposedAreas: msg.proposedAreas.map((area) => (area.id === areaId ? { ...area, ...update } : area)) };
  });
}

export function markAreasAdded(
  messages: AgentMessage[],
  messageId: string,
  ids: ReadonlySet<string>,
): AgentMessage[] {
  return messages.map((msg) => {
    if (msg.id !== messageId || !msg.proposedAreas) return msg;
    return { ...msg, proposedAreas: msg.proposedAreas.map((area) => (ids.has(area.id) ? { ...area, added: true } : area)) };
  });
}

export function areaDraftOf(area: ProposedArea): { name: string } {
  return { name: area.name };
}

export function updateProjectProposal(
  messages: AgentMessage[],
  messageId: string,
  projectId: string,
  update: Partial<ProposedProject>,
): AgentMessage[] {
  return messages.map((msg) => {
    if (msg.id !== messageId || !msg.proposedProjects) return msg;
    return { ...msg, proposedProjects: msg.proposedProjects.map((project) => (project.id === projectId ? { ...project, ...update } : project)) };
  });
}

export function markProjectsAdded(
  messages: AgentMessage[],
  messageId: string,
  ids: ReadonlySet<string>,
): AgentMessage[] {
  return messages.map((msg) => {
    if (msg.id !== messageId || !msg.proposedProjects) return msg;
    return { ...msg, proposedProjects: msg.proposedProjects.map((project) => (ids.has(project.id) ? { ...project, added: true } : project)) };
  });
}

export function projectDraftOf(project: ProposedProject): { name: string; areaName?: string | null; description?: string; status?: ProjectStatus } {
  return {
    name: project.name,
    areaName: project.areaName,
    description: project.description,
    status: project.status,
  };
}

export function updateTaskProposal(messages: AgentMessage[], messageId: string, taskId: string, update: (task: ProposedTask) => ProposedTask): AgentMessage[] {
  return messages.map((msg) => {
    if (msg.id !== messageId || !msg.proposedTasks) return msg;
    return { ...msg, proposedTasks: msg.proposedTasks.map((task) => task.id === taskId ? update(task) : task) };
  });
}

export function markTasksAdded(messages: AgentMessage[], messageId: string, ids: ReadonlySet<string>): AgentMessage[] {
  return messages.map((msg) => {
    if (msg.id !== messageId || !msg.proposedTasks) return msg;
    return { ...msg, proposedTasks: msg.proposedTasks.map((task) => ids.has(task.id) ? { ...task, added: true } : task) };
  });
}

export function updateHabitProposal(messages: AgentMessage[], messageId: string, habitId: string, update: Partial<ProposedHabit>): AgentMessage[] {
  return messages.map((message) => {
    if (message.id !== messageId || !message.proposedHabits) return message;
    return { ...message, proposedHabits: message.proposedHabits.map((habit) => habit.id === habitId ? { ...habit, ...update } : habit) };
  });
}

export function markHabitsAdded(messages: AgentMessage[], messageId: string, ids: ReadonlySet<string>): AgentMessage[] {
  return messages.map((message) => {
    if (message.id !== messageId || !message.proposedHabits) return message;
    return { ...message, proposedHabits: message.proposedHabits.map((habit) => ids.has(habit.id) ? { ...habit, added: true } : habit) };
  });
}

export function updateNoteProposal(messages: AgentMessage[], messageId: string, noteId: string, update: Partial<ProposedNote>): AgentMessage[] {
  return messages.map((message) => {
    if (message.id !== messageId || !message.proposedNotes) return message;
    return { ...message, proposedNotes: message.proposedNotes.map((note) => note.id === noteId ? { ...note, ...update } : note) };
  });
}

export function markNotesAdded(messages: AgentMessage[], messageId: string, ids: ReadonlySet<string>): AgentMessage[] {
  return messages.map((message) => {
    if (message.id !== messageId || !message.proposedNotes) return message;
    return { ...message, proposedNotes: message.proposedNotes.map((note) => ids.has(note.id) ? { ...note, added: true } : note) };
  });
}

export function updateFolderProposal(messages: AgentMessage[], messageId: string, folderId: string, update: Partial<ProposedFolder>): AgentMessage[] {
  return messages.map((message) => {
    if (message.id !== messageId || !message.proposedFolders) return message;
    return { ...message, proposedFolders: message.proposedFolders.map((folder) => folder.id === folderId ? { ...folder, ...update } : folder) };
  });
}

export function markFoldersAdded(messages: AgentMessage[], messageId: string, ids: ReadonlySet<string>): AgentMessage[] {
  return messages.map((message) => {
    if (message.id !== messageId || !message.proposedFolders) return message;
    return { ...message, proposedFolders: message.proposedFolders.map((folder) => ids.has(folder.id) ? { ...folder, added: true } : folder) };
  });
}

export function taskDraftOf(task: ProposedTask): TaskDraft & { areaName?: string | null; projectName?: string | null } {
  return {
    title: task.title,
    description: task.description,
    dueDate: task.dueDate,
    priority: task.priority,
    important: task.important,
    urgent: task.urgent,
    areaName: task.areaName,
    projectName: task.projectName,
    status: task.status,
    scheduledDate: task.scheduledDate,
    assigneeName: task.assigneeName,
    followUpDate: task.followUpDate,
  };
}

export function habitDraftOf(habit: ProposedHabit): HabitDraft {
  return { title: habit.title, important: habit.important, urgent: habit.urgent, interval: habit.interval, unit: habit.unit, endDate: habit.endDate ?? null, daysOfWeek: habit.daysOfWeek ?? [] };
}

export function noteDraftOf(note: ProposedNote): NoteDraft {
  return {
    title: note.title,
    folderName: note.folderName,
    projectName: note.projectName,
    bodyMarkdown: note.bodyMarkdown,
    favorite: note.favorite,
  };
}

export function folderDraftOf(folder: ProposedFolder): NoteFolderDraft {
  return { name: folder.name, parentName: folder.parentName };
}

function detectNoteFeatures(body: string): string[] {
  const features: string[] = [];
  if (/(^|\n)\s*[-*+]\s+\[[ xX]\]/.test(body)) features.push("taskList");
  if (/(^|\n)\s*\|[^|\n]+\|/.test(body)) features.push("table");
  if (/\$\$[^$]+\$\$|\$[^$\n]+\$/.test(body)) features.push("math");
  if (/\[\[[^\]]+\]\]/.test(body)) features.push("links");
  if (/(^|\s)#[A-Za-z][\w-]*/.test(body)) features.push("tags");
  if (/^> \[!(note|tip|warning|info)\]/im.test(body)) features.push("callout");
  if (/^```/m.test(body)) features.push("code");
  return features.slice(0, 4);
}

function featureLabel(t: (key: string) => string, feature: string): string {
  switch (feature) {
    case "taskList":
      return t("agent.features.taskList");
    case "table":
      return t("agent.features.table");
    case "math":
      return t("agent.features.math");
    case "links":
      return t("agent.features.links");
    case "tags":
      return t("agent.features.tags");
    case "callout":
      return t("agent.features.callout");
    case "code":
      return t("agent.features.code");
    default:
      return feature;
  }
}

type FlagTogglesProps = {
  readonly important: boolean | undefined;
  readonly urgent: boolean | undefined;
  readonly disabled: boolean | undefined;
  readonly importantLabel: readonly [string, string];
  readonly urgentLabel: readonly [string, string];
  readonly onToggleImportant: () => void;
  readonly onToggleUrgent: () => void;
};

function FlagToggles({ important, urgent, disabled, importantLabel, urgentLabel, onToggleImportant, onToggleUrgent }: FlagTogglesProps) {
  return (
    <div className="proposed-toggles">
      <button
        type="button"
        className={`task-action flag-toggle ${important ? "active important" : ""}`}
        aria-label={important ? importantLabel[0] : importantLabel[1]}
        aria-pressed={important}
        title={important ? importantLabel[0] : importantLabel[1]}
        disabled={disabled}
        onClick={onToggleImportant}
      >
        <Icon name="star" />
      </button>
      <button
        type="button"
        className={`task-action flag-toggle ${urgent ? "active urgent" : ""}`}
        aria-label={urgent ? urgentLabel[0] : urgentLabel[1]}
        aria-pressed={urgent}
        title={urgent ? urgentLabel[0] : urgentLabel[1]}
        disabled={disabled}
        onClick={onToggleUrgent}
      >
        <Icon name="bolt" />
      </button>
    </div>
  );
}

function statusLabel(t: (key: string) => string, status: string | undefined): string | null {
  switch (status) {
    case "inbox": return t("agent.status.inbox");
    case "backlog": return t("agent.status.backlog");
    case "next": return t("agent.status.next");
    case "in_progress": return t("agent.status.in_progress");
    case "waiting": return t("agent.status.waiting");
    case "done": return t("agent.status.done");
    default: return null;
  }
}

type ProposedAreaCardProps = {
  readonly messageId: string;
  readonly area: ProposedArea;
  readonly adding: boolean;
  readonly onUpdate?: (messageId: string, areaId: string, update: Partial<ProposedArea>) => void;
  readonly onAdd?: (messageId: string, area: ProposedArea) => void;
};

export function ProposedAreaCard({ messageId, area, adding, onUpdate, onAdd }: ProposedAreaCardProps) {
  const { t } = useI18n();
  return (
    <div className={`proposed-task-item proposed-area-item ${area.added ? "is-added" : ""}`}>
      <div className="proposed-task-top">
        <label className="proposed-checkbox-label">
          <input
            type="checkbox"
            checked={area.selected}
            disabled={area.added}
            onChange={() => onUpdate?.(messageId, area.id, { selected: !area.selected })}
          />
          <span className="proposed-task-title">{area.name}</span>
        </label>
        {area.added ? (
          <span className="task-added-badge">
            <Icon name="check" /> {t("agent.cards.added")}
          </span>
        ) : (
          <button
            type="button"
            className="add-single-btn"
            disabled={adding}
            onClick={() => onAdd?.(messageId, area)}
            title={t("agent.cards.addArea")}
          >
            <Icon name="plus" />
          </button>
        )}
      </div>
      <div className="proposed-task-meta">
        <span className="proposed-priority proposed-priority-2">{t("agent.cards.areaKind")}</span>
      </div>
      {area.reasoning && <p className="proposed-reasoning">{area.reasoning}</p>}
    </div>
  );
}

type AreaProposalBoxProps = {
  readonly messageId: string;
  readonly areas: readonly ProposedArea[];
  readonly addingIds: Readonly<Record<string, boolean>>;
  readonly onUpdate?: (messageId: string, areaId: string, update: Partial<ProposedArea>) => void;
  readonly onAddSingle?: (messageId: string, area: ProposedArea) => void;
  readonly onAddAll?: (messageId: string, areas: ProposedArea[]) => void;
};

export function AreaProposalBox({ messageId, areas, addingIds, onUpdate, onAddSingle, onAddAll }: AreaProposalBoxProps) {
  const { t, tp } = useI18n();
  if (areas.length === 0) return null;
  const addedCount = areas.filter((a) => a.added).length;
  return (
    <div className="proposed-tasks-box proposed-areas-box">
      <div className="proposed-tasks-header">
        <span className="proposed-count">{tp("agent.cards.areasAdded", areas.length, { added: addedCount, total: areas.length })}</span>
        {areas.some((a) => !a.added) && (
          <button type="button" className="primary-button add-all-btn" onClick={() => onAddAll?.(messageId, [...areas])}>
            <Icon name="plus" />
            <span>{t("agent.cards.addAreas")}</span>
          </button>
        )}
      </div>
      <div className="proposed-task-list">
        {areas.map((area) => (
          <ProposedAreaCard
            key={area.id}
            messageId={messageId}
            area={area}
            adding={addingIds[area.id] ?? false}
            onUpdate={onUpdate}
            onAdd={onAddSingle}
          />
        ))}
      </div>
    </div>
  );
}

type ProposedProjectCardProps = {
  readonly messageId: string;
  readonly project: ProposedProject;
  readonly adding: boolean;
  readonly onUpdate?: (messageId: string, projectId: string, update: Partial<ProposedProject>) => void;
  readonly onAdd?: (messageId: string, project: ProposedProject) => void;
};

export function ProposedProjectCard({ messageId, project, adding, onUpdate, onAdd }: ProposedProjectCardProps) {
  const { t } = useI18n();
  return (
    <div className={`proposed-task-item proposed-project-item ${project.added ? "is-added" : ""}`}>
      <div className="proposed-task-top">
        <label className="proposed-checkbox-label">
          <input
            type="checkbox"
            checked={project.selected}
            disabled={project.added}
            onChange={() => onUpdate?.(messageId, project.id, { selected: !project.selected })}
          />
          <span className="proposed-task-title">{project.name}</span>
        </label>
        {project.added ? (
          <span className="task-added-badge">
            <Icon name="check" /> {t("agent.cards.added")}
          </span>
        ) : (
          <button
            type="button"
            className="add-single-btn"
            disabled={adding}
            onClick={() => onAdd?.(messageId, project)}
            title={t("agent.cards.addProject")}
          >
            <Icon name="plus" />
          </button>
        )}
      </div>
      {project.description && <p className="proposed-description">{project.description}</p>}
      <div className="proposed-task-meta">
        {project.areaName && <span className="proposed-area-badge">{t("agent.cards.areaBadge", { name: project.areaName })}</span>}
        {project.status && <span className="proposed-priority proposed-priority-3">{project.status}</span>}
      </div>
      {project.reasoning && <p className="proposed-reasoning">{project.reasoning}</p>}
    </div>
  );
}

type ProjectProposalBoxProps = {
  readonly messageId: string;
  readonly projects: readonly ProposedProject[];
  readonly addingIds: Readonly<Record<string, boolean>>;
  readonly onUpdate?: (messageId: string, projectId: string, update: Partial<ProposedProject>) => void;
  readonly onAddSingle?: (messageId: string, project: ProposedProject) => void;
  readonly onAddAll?: (messageId: string, projects: ProposedProject[]) => void;
};

export function ProjectProposalBox({ messageId, projects, addingIds, onUpdate, onAddSingle, onAddAll }: ProjectProposalBoxProps) {
  const { t, tp } = useI18n();
  if (projects.length === 0) return null;
  const addedCount = projects.filter((p) => p.added).length;
  return (
    <div className="proposed-tasks-box proposed-projects-box">
      <div className="proposed-tasks-header">
        <span className="proposed-count">{tp("agent.cards.projectsAdded", projects.length, { added: addedCount, total: projects.length })}</span>
        {projects.some((p) => !p.added) && (
          <button type="button" className="primary-button add-all-btn" onClick={() => onAddAll?.(messageId, [...projects])}>
            <Icon name="plus" />
            <span>{t("agent.cards.addProjects")}</span>
          </button>
        )}
      </div>
      <div className="proposed-task-list">
        {projects.map((project) => (
          <ProposedProjectCard
            key={project.id}
            messageId={messageId}
            project={project}
            adding={addingIds[project.id] ?? false}
            onUpdate={onUpdate}
            onAdd={onAddSingle}
          />
        ))}
      </div>
    </div>
  );
}

type ProposedTaskCardProps = {
  readonly messageId: string;
  readonly task: ProposedTask;
  readonly adding: boolean;
  readonly onToggleSelect: (messageId: string, taskId: string) => void;
  readonly onToggleImportant: (messageId: string, taskId: string) => void;
  readonly onToggleUrgent: (messageId: string, taskId: string) => void;
  readonly onAdd: (messageId: string, task: ProposedTask) => void;
};

export function ProposedTaskCard({ messageId, task, adding, onToggleSelect, onToggleImportant, onToggleUrgent, onAdd }: ProposedTaskCardProps) {
  const { t } = useI18n();
  const badge = getQuadrantBadge(task);
  const priority = task.priority ?? 4;
  const taskStatus = statusLabel(t, task.status);
  return (
    <div className={`proposed-task-item ${task.added ? "is-added" : ""}`}>
      <div className="proposed-task-top">
        <label className="proposed-checkbox-label">
          <input
            type="checkbox"
            checked={task.selected}
            disabled={task.added}
            onChange={() => onToggleSelect(messageId, task.id)}
          />
          <span className="proposed-task-title">{task.title}</span>
        </label>
        {task.added ? (
          <span className="task-added-badge">
            <Icon name="check" /> {t("agent.cards.added")}
          </span>
        ) : (
          <button
            type="button"
            className="add-single-btn"
            disabled={adding}
            onClick={() => onAdd(messageId, task)}
            title={t("agent.cards.addTask")}
          >
            <Icon name="plus" />
          </button>
        )}
      </div>
      {task.description && <p className="proposed-description">{task.description}</p>}
      <div className="proposed-task-meta">
        <span className={`quadrant-chip quadrant-chip-${badge.key}`}>
          {quadrantLabel(t, badge.key)}
        </span>
        <span className={`proposed-priority proposed-priority-${priority}`}>P{priority}</span>
        {taskStatus && <span className={`proposed-status-badge proposed-status-${task.status}`}>{taskStatus}</span>}
        {task.projectName && <span className="proposed-project-badge">{task.projectName}</span>}
        {task.areaName && !task.projectName && <span className="proposed-area-badge">{task.areaName}</span>}
        {task.dueDate && <span className="proposed-due-date">{t("agent.cards.due", { date: formatDueDate(task.dueDate) })}</span>}
        {task.scheduledDate && <span className="proposed-scheduled-date">{t("agent.cards.scheduled", { date: formatDueDate(task.scheduledDate) })}</span>}
        {task.assigneeName && <span className="proposed-assignee-badge">{t("agent.cards.waitingOn", { name: task.assigneeName })}</span>}
        {task.followUpDate && <span className="proposed-followup-date">{t("agent.cards.followUp", { date: formatDueDate(task.followUpDate) })}</span>}
        <FlagToggles
          important={task.important}
          urgent={task.urgent}
          disabled={task.added}
          importantLabel={[t("agent.cards.unmarkImportant"), t("agent.cards.markImportant")]}
          urgentLabel={[t("agent.cards.unmarkUrgent"), t("agent.cards.markUrgent")]}
          onToggleImportant={() => onToggleImportant(messageId, task.id)}
          onToggleUrgent={() => onToggleUrgent(messageId, task.id)}
        />
      </div>
      {task.reasoning && <p className="proposed-reasoning">{task.reasoning}</p>}
    </div>
  );
}

type TaskProposalBoxProps = {
  readonly messageId: string;
  readonly tasks: readonly ProposedTask[];
  readonly addingIds: Readonly<Record<string, boolean>>;
  readonly onToggleSelect: (messageId: string, taskId: string) => void;
  readonly onToggleImportant: (messageId: string, taskId: string) => void;
  readonly onToggleUrgent: (messageId: string, taskId: string) => void;
  readonly onAddSingle: (messageId: string, task: ProposedTask) => void;
  readonly onAddAll: (messageId: string, tasks: ProposedTask[]) => void;
};

export function TaskProposalBox({ messageId, tasks, addingIds, onToggleSelect, onToggleImportant, onToggleUrgent, onAddSingle, onAddAll }: TaskProposalBoxProps) {
  const { t, tp } = useI18n();
  if (tasks.length === 0) return null;
  const addedCount = tasks.filter((task) => task.added).length;
  return (
    <div className="proposed-tasks-box">
      <div className="proposed-tasks-header">
        <span className="proposed-count">{tp("agent.cards.tasksAdded", tasks.length, { added: addedCount, total: tasks.length })}</span>
        {tasks.some((task) => !task.added) && (
          <button type="button" className="primary-button add-all-btn" onClick={() => onAddAll(messageId, [...tasks])}>
            <Icon name="plus" />
            <span>{t("agent.cards.addAllTasks")}</span>
          </button>
        )}
      </div>
      <div className="proposed-task-list">
        {tasks.map((task) => (
          <ProposedTaskCard
            key={task.id}
            messageId={messageId}
            task={task}
            adding={addingIds[task.id] ?? false}
            onToggleSelect={onToggleSelect}
            onToggleImportant={onToggleImportant}
            onToggleUrgent={onToggleUrgent}
            onAdd={onAddSingle}
          />
        ))}
      </div>
    </div>
  );
}

type ProposedHabitCardProps = {
  readonly messageId: string;
  readonly habit: ProposedHabit;
  readonly adding: boolean;
  readonly onUpdate: (messageId: string, habitId: string, update: Partial<ProposedHabit>) => void;
  readonly onAdd: (messageId: string, habit: ProposedHabit) => void;
};

export function ProposedHabitCard({ messageId, habit, adding, onUpdate, onAdd }: ProposedHabitCardProps) {
  const { t } = useI18n();
  const badge = getQuadrantBadge(habit);
  return (
    <div className={`proposed-task-item ${habit.added ? "is-added" : ""}`}>
      <div className="proposed-task-top">
        <label className="proposed-checkbox-label">
          <input
            type="checkbox"
            checked={habit.selected}
            disabled={habit.added}
            onChange={() => onUpdate(messageId, habit.id, { selected: !habit.selected })}
          />
          <span className="proposed-task-title">{habit.title}</span>
        </label>
        {habit.added ? (
          <span className="task-added-badge">
            <Icon name="check" /> {t("agent.cards.added")}
          </span>
        ) : (
          <button
            type="button"
            className="add-single-btn"
            disabled={adding}
            onClick={() => onAdd(messageId, habit)}
            title={t("agent.cards.addHabit")}
          >
            <Icon name="plus" />
          </button>
        )}
      </div>
      <div className="proposed-task-meta">
        <span className={`quadrant-chip quadrant-chip-${badge.key}`}>
          {habitScheduleLabel(habit)}{habit.endDate ? ` · ${t("agent.cards.endsOn", { date: habit.endDate })}` : ""} · {quadrantLabel(t, badge.key)}
        </span>
        <FlagToggles
          important={habit.important}
          urgent={habit.urgent}
          disabled={habit.added}
          importantLabel={[t("agent.cards.unmarkImportant"), t("agent.cards.markImportant")]}
          urgentLabel={[t("agent.cards.unmarkUrgent"), t("agent.cards.markUrgent")]}
          onToggleImportant={() => onUpdate(messageId, habit.id, { important: !habit.important })}
          onToggleUrgent={() => onUpdate(messageId, habit.id, { urgent: !habit.urgent })}
        />
      </div>
      {habit.reasoning && <p className="proposed-reasoning">{habit.reasoning}</p>}
    </div>
  );
}

type HabitProposalBoxProps = {
  readonly messageId: string;
  readonly habits: readonly ProposedHabit[];
  readonly addingIds: Readonly<Record<string, boolean>>;
  readonly onUpdate: (messageId: string, habitId: string, update: Partial<ProposedHabit>) => void;
  readonly onAddSingle: (messageId: string, habit: ProposedHabit) => void;
  readonly onAddAll: (messageId: string, habits: ProposedHabit[]) => void;
};

export function HabitProposalBox({ messageId, habits, addingIds, onUpdate, onAddSingle, onAddAll }: HabitProposalBoxProps) {
  const { t, tp } = useI18n();
  if (habits.length === 0) return null;
  const addedCount = habits.filter((habit) => habit.added).length;
  return (
    <div className="proposed-tasks-box proposed-habits-box">
      <div className="proposed-tasks-header">
        <span className="proposed-count">{tp("agent.cards.habitsAdded", habits.length, { added: addedCount, total: habits.length })}</span>
        {habits.some((habit) => !habit.added) && (
          <button type="button" className="primary-button add-all-btn" onClick={() => onAddAll(messageId, [...habits])}>
            <Icon name="plus" />
            <span>{t("agent.cards.addHabits")}</span>
          </button>
        )}
      </div>
      <div className="proposed-task-list">
        {habits.map((habit) => (
          <ProposedHabitCard
            key={habit.id}
            messageId={messageId}
            habit={habit}
            adding={addingIds[habit.id] ?? false}
            onUpdate={onUpdate}
            onAdd={onAddSingle}
          />
        ))}
      </div>
    </div>
  );
}

export type AssistantMessageHandlers = {
  readonly addingIds: Readonly<Record<string, boolean>>;
  readonly onUpdateArea?: (messageId: string, areaId: string, update: Partial<ProposedArea>) => void;
  readonly onAddSingleArea?: (messageId: string, area: ProposedArea) => void;
  readonly onAddAllAreas?: (messageId: string, areas: ProposedArea[]) => void;
  readonly onUpdateProject?: (messageId: string, projectId: string, update: Partial<ProposedProject>) => void;
  readonly onAddSingleProject?: (messageId: string, project: ProposedProject) => void;
  readonly onAddAllProjects?: (messageId: string, projects: ProposedProject[]) => void;
  readonly onToggleTaskSelect: (messageId: string, taskId: string) => void;
  readonly onToggleTaskImportant: (messageId: string, taskId: string) => void;
  readonly onToggleTaskUrgent: (messageId: string, taskId: string) => void;
  readonly onAddSingleTask: (messageId: string, task: ProposedTask) => void;
  readonly onAddAllTasks: (messageId: string, tasks: ProposedTask[]) => void;
  readonly onUpdateHabit: (messageId: string, habitId: string, update: Partial<ProposedHabit>) => void;
  readonly onAddSingleHabit: (messageId: string, habit: ProposedHabit) => void;
  readonly onAddAllHabits: (messageId: string, habits: ProposedHabit[]) => void;
  readonly onUpdateNote: (messageId: string, noteId: string, update: Partial<ProposedNote>) => void;
  readonly onAddSingleNote: (messageId: string, note: ProposedNote) => void;
  readonly onAddAllNotes: (messageId: string, notes: ProposedNote[]) => void;
  readonly onUpdateFolder: (messageId: string, folderId: string, update: Partial<ProposedFolder>) => void;
  readonly onAddSingleFolder: (messageId: string, folder: ProposedFolder) => void;
  readonly onAddAllFolders: (messageId: string, folders: ProposedFolder[]) => void;
};

type ProposedNoteCardProps = {
  readonly messageId: string;
  readonly note: ProposedNote;
  readonly adding: boolean;
  readonly onUpdate: (messageId: string, noteId: string, update: Partial<ProposedNote>) => void;
  readonly onAdd: (messageId: string, note: ProposedNote) => void;
};

export function ProposedNoteCard({ messageId, note, adding, onUpdate, onAdd }: ProposedNoteCardProps) {
  const { t, tp } = useI18n();
  const features = detectNoteFeatures(note.bodyMarkdown);
  const preview = note.bodyMarkdown.length > 420 ? `${note.bodyMarkdown.slice(0, 417).trimEnd()}…` : note.bodyMarkdown;
  const wordCount = note.bodyMarkdown.trim() ? note.bodyMarkdown.trim().split(/\s+/).length : 0;
  const favoriteLabel = note.favorite ? t("agent.cards.unmarkFavorite") : t("agent.cards.markFavorite");
  return (
    <div className={`proposed-task-item proposed-note-item ${note.added ? "is-added" : ""}`}>
      <div className="proposed-task-top">
        <label className="proposed-checkbox-label">
          <input
            type="checkbox"
            checked={note.selected}
            disabled={note.added}
            onChange={() => onUpdate(messageId, note.id, { selected: !note.selected })}
          />
          <span className="proposed-task-title">{note.title}</span>
        </label>
        {note.added ? (
          <span className="task-added-badge">
            <Icon name="check" /> {t("agent.cards.added")}
          </span>
        ) : (
          <button
            type="button"
            className="add-single-btn"
            disabled={adding}
            onClick={() => onAdd(messageId, note)}
            title={t("agent.cards.addNote")}
          >
            <Icon name="plus" />
          </button>
        )}
      </div>
      <div className="proposed-task-meta">
        <span className="proposed-due-date">{note.folderName ?? t("agent.cards.folderLibrary")}</span>
        {note.projectName && <span className="proposed-project-badge">{t("agent.cards.projectFor", { name: note.projectName })}</span>}
        {note.favorite && <span className="proposed-priority proposed-priority-2">{t("agent.cards.favorite")}</span>}
        <span className="proposed-count">{tp("agent.cards.words", wordCount)}</span>
        {!note.added && (
          <button
            type="button"
            className={`task-action flag-toggle ${note.favorite ? "active important" : ""}`}
            aria-label={favoriteLabel}
            aria-pressed={note.favorite}
            title={favoriteLabel}
            onClick={() => onUpdate(messageId, note.id, { favorite: !note.favorite })}
          >
            <Icon name="star" />
          </button>
        )}
      </div>
      {features.length > 0 && (
        <div className="proposed-task-meta">
          {features.map((feature) => (
            <span key={feature} className="quadrant-chip quadrant-chip-plan">{featureLabel(t, feature)}</span>
          ))}
        </div>
      )}
      {preview && <pre className="proposed-description proposed-note-preview">{preview}</pre>}
      {note.reasoning && <p className="proposed-reasoning">{note.reasoning}</p>}
    </div>
  );
}

type NoteProposalBoxProps = {
  readonly messageId: string;
  readonly notes: readonly ProposedNote[];
  readonly addingIds: Readonly<Record<string, boolean>>;
  readonly onUpdate: (messageId: string, noteId: string, update: Partial<ProposedNote>) => void;
  readonly onAddSingle: (messageId: string, note: ProposedNote) => void;
  readonly onAddAll: (messageId: string, notes: ProposedNote[]) => void;
};

export function NoteProposalBox({ messageId, notes, addingIds, onUpdate, onAddSingle, onAddAll }: NoteProposalBoxProps) {
  const { t, tp } = useI18n();
  if (notes.length === 0) return null;
  const addedCount = notes.filter((note) => note.added).length;
  return (
    <div className="proposed-tasks-box proposed-notes-box">
      <div className="proposed-tasks-header">
        <span className="proposed-count">{tp("agent.cards.notesAdded", notes.length, { added: addedCount, total: notes.length })}</span>
        {notes.some((note) => !note.added) && (
          <button type="button" className="primary-button add-all-btn" onClick={() => onAddAll(messageId, [...notes])}>
            <Icon name="plus" />
            <span>{t("agent.cards.addNotes")}</span>
          </button>
        )}
      </div>
      <div className="proposed-task-list">
        {notes.map((note) => (
          <ProposedNoteCard
            key={note.id}
            messageId={messageId}
            note={note}
            adding={addingIds[note.id] ?? false}
            onUpdate={onUpdate}
            onAdd={onAddSingle}
          />
        ))}
      </div>
    </div>
  );
}

type ProposedFolderCardProps = {
  readonly messageId: string;
  readonly folder: ProposedFolder;
  readonly adding: boolean;
  readonly onUpdate: (messageId: string, folderId: string, update: Partial<ProposedFolder>) => void;
  readonly onAdd: (messageId: string, folder: ProposedFolder) => void;
};

export function ProposedFolderCard({ messageId, folder, adding, onUpdate, onAdd }: ProposedFolderCardProps) {
  const { t } = useI18n();
  return (
    <div className={`proposed-task-item ${folder.added ? "is-added" : ""}`}>
      <div className="proposed-task-top">
        <label className="proposed-checkbox-label">
          <input
            type="checkbox"
            checked={folder.selected}
            disabled={folder.added}
            onChange={() => onUpdate(messageId, folder.id, { selected: !folder.selected })}
          />
          <span className="proposed-task-title">{folder.name}</span>
        </label>
        {folder.added ? (
          <span className="task-added-badge">
            <Icon name="check" /> {t("agent.cards.added")}
          </span>
        ) : (
          <button
            type="button"
            className="add-single-btn"
            disabled={adding}
            onClick={() => onAdd(messageId, folder)}
            title={t("agent.cards.addFolder")}
          >
            <Icon name="plus" />
          </button>
        )}
      </div>
      <div className="proposed-task-meta">
        <span className="proposed-due-date">{folder.parentName ? t("agent.cards.insideFolder", { name: folder.parentName }) : t("agent.cards.topLevel")}</span>
      </div>
      {folder.reasoning && <p className="proposed-reasoning">{folder.reasoning}</p>}
    </div>
  );
}

type FolderProposalBoxProps = {
  readonly messageId: string;
  readonly folders: readonly ProposedFolder[];
  readonly addingIds: Readonly<Record<string, boolean>>;
  readonly onUpdate: (messageId: string, folderId: string, update: Partial<ProposedFolder>) => void;
  readonly onAddSingle: (messageId: string, folder: ProposedFolder) => void;
  readonly onAddAll: (messageId: string, folders: ProposedFolder[]) => void;
};

export function FolderProposalBox({ messageId, folders, addingIds, onUpdate, onAddSingle, onAddAll }: FolderProposalBoxProps) {
  const { t, tp } = useI18n();
  if (folders.length === 0) return null;
  const addedCount = folders.filter((folder) => folder.added).length;
  return (
    <div className="proposed-tasks-box proposed-folders-box">
      <div className="proposed-tasks-header">
        <span className="proposed-count">{tp("agent.cards.foldersAdded", folders.length, { added: addedCount, total: folders.length })}</span>
        {folders.some((folder) => !folder.added) && (
          <button type="button" className="primary-button add-all-btn" onClick={() => onAddAll(messageId, [...folders])}>
            <Icon name="plus" />
            <span>{t("agent.cards.addFolders")}</span>
          </button>
        )}
      </div>
      <div className="proposed-task-list">
        {folders.map((folder) => (
          <ProposedFolderCard
            key={folder.id}
            messageId={messageId}
            folder={folder}
            adding={addingIds[folder.id] ?? false}
            onUpdate={onUpdate}
            onAdd={onAddSingle}
          />
        ))}
      </div>
    </div>
  );
}

type AssistantMessageProps = {
  readonly message: AgentMessage;
  readonly handlers: AssistantMessageHandlers;
};

export function AssistantMessage({ message: msg, handlers }: AssistantMessageProps) {
  const { t } = useI18n();
  if (msg.role === "user") {
    return (
      <div className="agent-message-row user">
        <div className="agent-message-bubble">
          <p className="agent-message-text">{msg.content}</p>
        </div>
      </div>
    );
  }
  return (
    <div className="agent-message-row assistant">
      <div className="agent-message-avatar">
        <AgentIdentity size="tiny" />
      </div>
      <div className="agent-message-bubble">
        <div className="agent-message-text chat-markdown" dangerouslySetInnerHTML={{ __html: renderChatMarkdown(msg.content) }} />
        {msg.actualModel && (
          <div className="agent-model-info" title={t("agent.cards.resolvedVia", { model: msg.actualModel })}>
            <span className="routed-dot" />
            <span>{t("agent.cards.modelLabel")} <strong>{msg.actualModel}</strong></span>
          </div>
        )}
        {msg.proposedAreas && (
          <AreaProposalBox
            messageId={msg.id}
            areas={msg.proposedAreas}
            addingIds={handlers.addingIds}
            onUpdate={handlers.onUpdateArea}
            onAddSingle={handlers.onAddSingleArea}
            onAddAll={handlers.onAddAllAreas}
          />
        )}
        {msg.proposedProjects && (
          <ProjectProposalBox
            messageId={msg.id}
            projects={msg.proposedProjects}
            addingIds={handlers.addingIds}
            onUpdate={handlers.onUpdateProject}
            onAddSingle={handlers.onAddSingleProject}
            onAddAll={handlers.onAddAllProjects}
          />
        )}
        {msg.proposedTasks && (
          <TaskProposalBox
            messageId={msg.id}
            tasks={msg.proposedTasks}
            addingIds={handlers.addingIds}
            onToggleSelect={handlers.onToggleTaskSelect}
            onToggleImportant={handlers.onToggleTaskImportant}
            onToggleUrgent={handlers.onToggleTaskUrgent}
            onAddSingle={handlers.onAddSingleTask}
            onAddAll={handlers.onAddAllTasks}
          />
        )}
        {msg.proposedHabits && (
          <HabitProposalBox
            messageId={msg.id}
            habits={msg.proposedHabits}
            addingIds={handlers.addingIds}
            onUpdate={handlers.onUpdateHabit}
            onAddSingle={handlers.onAddSingleHabit}
            onAddAll={handlers.onAddAllHabits}
          />
        )}
        {msg.proposedFolders && (
          <FolderProposalBox
            messageId={msg.id}
            folders={msg.proposedFolders}
            addingIds={handlers.addingIds}
            onUpdate={handlers.onUpdateFolder}
            onAddSingle={handlers.onAddSingleFolder}
            onAddAll={handlers.onAddAllFolders}
          />
        )}
        {msg.proposedNotes && (
          <NoteProposalBox
            messageId={msg.id}
            notes={msg.proposedNotes}
            addingIds={handlers.addingIds}
            onUpdate={handlers.onUpdateNote}
            onAddSingle={handlers.onAddSingleNote}
            onAddAll={handlers.onAddAllNotes}
          />
        )}
      </div>
    </div>
  );
}
