import type {
  ProposedArea,
  ProposedEntityUpdate,
  ProposedFolder,
  ProposedHabit,
  ProposedNote,
  ProposedProject,
  ProposedTask,
  ProposedTaskUpdate,
} from "../../types";
import type { ProposalContext } from "./reviewModel";

/** Handlers may be async: "Apply all" waits for one kind before it starts the next. */
type Result = void | Promise<void>;

/** Everything the review cards of an assistant message can do. Apply/confirm logic stays in the sidebar. */
export type AssistantMessageHandlers = {
  readonly addingIds: Readonly<Record<string, boolean>>;
  /** The user's current data, so edit cards can show what they replace. */
  readonly context?: ProposalContext;
  /** Called once after proposals were applied (the mascot celebrates). */
  readonly onApplied?: () => void;
  /** Edit a proposed task before it is created (title, due date, priority). */
  readonly onEditTask?: (messageId: string, taskId: string, patch: Partial<Pick<ProposedTask, "title" | "dueDate" | "priority">>) => void;
  readonly onUpdateArea?: (messageId: string, areaId: string, update: Partial<ProposedArea>) => void;
  readonly onAddSingleArea?: (messageId: string, area: ProposedArea) => Result;
  readonly onAddAllAreas?: (messageId: string, areas: ProposedArea[]) => Result;
  readonly onUpdateProject?: (messageId: string, projectId: string, update: Partial<ProposedProject>) => void;
  readonly onAddSingleProject?: (messageId: string, project: ProposedProject) => Result;
  readonly onAddAllProjects?: (messageId: string, projects: ProposedProject[]) => Result;
  readonly onToggleTaskSelect: (messageId: string, taskId: string) => void;
  readonly onToggleTaskImportant: (messageId: string, taskId: string) => void;
  readonly onToggleTaskUrgent: (messageId: string, taskId: string) => void;
  readonly onAddSingleTask: (messageId: string, task: ProposedTask) => Result;
  readonly onAddAllTasks: (messageId: string, tasks: ProposedTask[]) => Result;
  readonly onUpdateTaskUpdate?: (messageId: string, updateId: string, update: Partial<ProposedTaskUpdate>) => void;
  readonly onApplyTaskUpdate?: (messageId: string, update: ProposedTaskUpdate) => Result;
  readonly onApplyAllTaskUpdates?: (messageId: string, updates: ProposedTaskUpdate[]) => Result;
  readonly onUpdateEntityUpdate?: (messageId: string, updateId: string, update: Partial<ProposedEntityUpdate>) => void;
  readonly onApplyEntityUpdate?: (messageId: string, update: ProposedEntityUpdate) => Result;
  readonly onApplyAllEntityUpdates?: (messageId: string, updates: ProposedEntityUpdate[]) => Result;
  readonly onUpdateHabit: (messageId: string, habitId: string, update: Partial<ProposedHabit>) => void;
  readonly onAddSingleHabit: (messageId: string, habit: ProposedHabit) => Result;
  readonly onAddAllHabits: (messageId: string, habits: ProposedHabit[]) => Result;
  readonly onUpdateNote: (messageId: string, noteId: string, update: Partial<ProposedNote>) => void;
  readonly onAddSingleNote: (messageId: string, note: ProposedNote) => Result;
  readonly onAddAllNotes: (messageId: string, notes: ProposedNote[]) => Result;
  readonly onUpdateFolder: (messageId: string, folderId: string, update: Partial<ProposedFolder>) => void;
  readonly onAddSingleFolder: (messageId: string, folder: ProposedFolder) => Result;
  readonly onAddAllFolders: (messageId: string, folders: ProposedFolder[]) => Result;
};
