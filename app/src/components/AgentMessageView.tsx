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
  ProposedTaskUpdate,
  ProposedEntityUpdate,
  ProjectType,
  TaskDraft,
} from "../types";
import { renderChatMarkdown } from "../lib/chatMarkdown";
import { useI18n } from "../lib/i18n";
import { AgentIdentity } from "./AgentIdentity";
import { ReviewPanel } from "./agent/ReviewPanel";
import { generateUuid } from "../lib/uuid";
import "katex/dist/katex.min.css";

export { getQuadrantBadge } from "./agent/reviewModel";
export type { AssistantMessageHandlers } from "./agent/handlers";
import type { AssistantMessageHandlers } from "./agent/handlers";

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

export function areaDraftOf(area: ProposedArea): { name: string; color?: string; icon?: string | null } {
  return { name: area.name, color: area.color, icon: area.icon };
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

export function projectDraftOf(project: ProposedProject): { name: string; areaName?: string | null; description?: string; status?: ProjectStatus; targetDate?: string | null; icon?: string | null; projectType?: ProjectType } {
  return {
    name: project.name,
    areaName: project.areaName,
    description: project.description,
    status: project.status,
    targetDate: project.targetDate,
    icon: project.icon,
    ...(project.projectType ? { projectType: project.projectType } : {}),
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

export function updateTaskUpdateProposal(messages: AgentMessage[], messageId: string, updateId: string, update: Partial<ProposedTaskUpdate>): AgentMessage[] {
  return messages.map((message) => {
    if (message.id !== messageId || !message.proposedTaskUpdates) return message;
    return { ...message, proposedTaskUpdates: message.proposedTaskUpdates.map((item) => item.id === updateId ? { ...item, ...update } : item) };
  });
}

export function markTaskUpdatesApplied(messages: AgentMessage[], messageId: string, ids: ReadonlySet<string>): AgentMessage[] {
  return messages.map((message) => {
    if (message.id !== messageId || !message.proposedTaskUpdates) return message;
    return { ...message, proposedTaskUpdates: message.proposedTaskUpdates.map((item) => ids.has(item.id) ? { ...item, added: true } : item) };
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

export function updateEntityUpdateProposal(messages: AgentMessage[], messageId: string, updateId: string, update: Partial<ProposedEntityUpdate>): AgentMessage[] {
  return messages.map((message) => {
    if (message.id !== messageId || !message.proposedUpdates) return message;
    return { ...message, proposedUpdates: message.proposedUpdates.map((item) => item.id === updateId ? { ...item, ...update } : item) };
  });
}

export function markEntityUpdatesApplied(messages: AgentMessage[], messageId: string, ids: ReadonlySet<string>): AgentMessage[] {
  return messages.map((message) => {
    if (message.id !== messageId || !message.proposedUpdates) return message;
    return { ...message, proposedUpdates: message.proposedUpdates.map((item) => ids.has(item.id) ? { ...item, added: true } : item) };
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
    ...(task.assigneeId ? { assigneeId: task.assigneeId } : {}),
    ...(task.milestoneId ? { milestoneId: task.milestoneId } : {}),
    ...(task.parentId ? { parentId: task.parentId } : {}),
    ...(task.parentTitle ? { parentTitle: task.parentTitle } : {}),
    ...(task.blockedByTaskIds?.length ? { relations: task.blockedByTaskIds.map((taskId) => ({ type: "blocked_by" as const, taskId })) } : {}),
    ...(task.reminderAt ? { reminderAt: task.reminderAt } : {}),
    ...(task.checklist?.length ? { checklist: task.checklist.map((title, position) => ({ id: generateUuid(), title, done: false, position })) } : {}),
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

type AssistantMessageProps = {
  readonly message: AgentMessage;
  readonly handlers: AssistantMessageHandlers;
  /** Written during this session (not loaded from history): its text and cards ease in. */
  readonly fresh?: boolean;
};

export function AssistantMessage({ message: msg, handlers, fresh = false }: AssistantMessageProps) {
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
    <div className={`agent-message-row assistant${fresh ? " is-fresh" : ""}`} data-message-id={msg.id}>
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
        <ReviewPanel message={msg} handlers={handlers} />
      </div>
    </div>
  );
}
