export type TaskPriority = 1 | 2 | 3 | 4;

export type TaskStatus = "inbox" | "next" | "in_progress" | "waiting" | "done";

export type Area = {
  id: string;
  name: string;
  color: string;
  icon?: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};

export type ProjectStatus = "planned" | "active" | "paused" | "completed";

export type Project = {
  id: string;
  areaId: string | null;
  name: string;
  description: string;
  icon?: string | null;
  status: ProjectStatus;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};

export type Task = {
  id: string;
  title: string;
  description: string;
  dueDate: string | null;
  priority: TaskPriority;
  areaId?: string | null;
  projectId?: string | null;
  status?: TaskStatus;
  scheduledDate?: string | null;
  assigneeName?: string;
  peopleIds?: string[];
  followUpDate?: string | null;
  completed: boolean;
  important: boolean;
  urgent: boolean;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  serverRevision?: number;
};

export type TaskDraft = Pick<Task, "title" | "important" | "urgent"> & Partial<Pick<Task, "description" | "dueDate" | "priority" | "areaId" | "projectId" | "status" | "scheduledDate" | "assigneeName" | "peopleIds" | "followUpDate">>;

export type HabitUnit = "day" | "week" | "month" | "year";

export type Habit = {
  id: string;
  title: string;
  important: boolean;
  urgent: boolean;
  interval: number;
  unit: HabitUnit;
  startDate: string;
  /** Optional for backwards compatibility with habits created before schedules were expanded. */
  endDate?: string | null;
  /** JavaScript weekday values (0 = Sunday, 6 = Saturday), used for weekly habits. */
  daysOfWeek?: number[];
  completedDates: string[];
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  serverRevision?: number;
};

export type HabitDraft = Pick<Habit, "title" | "important" | "urgent" | "interval" | "unit"> & Partial<Pick<Habit, "id" | "startDate" | "endDate" | "daysOfWeek" | "completedDates" | "createdAt" | "updatedAt" | "deletedAt" | "serverRevision">>;

export type TaskMutation = {
  id: string;
  task: Task;
  kind: "upsert" | "delete";
  createdAt: string;
  entity?: "task";
};

export type HabitMutation = {
  id: string;
  habit: Habit;
  kind: "upsert" | "delete";
  createdAt: string;
  entity: "habit";
};

export type Mutation = TaskMutation | HabitMutation;

export type SyncState = {
  lastServerRevision: number;
  pendingCount: number;
};

export type QuadrantKey = "focus" | "plan" | "quick" | "later";

export type ProposedArea = {
  id: string;
  name: string;
  reasoning: string;
  selected: boolean;
  added?: boolean;
};

export type ProposedProject = {
  id: string;
  name: string;
  areaName?: string | null;
  description?: string;
  status?: ProjectStatus;
  reasoning: string;
  selected: boolean;
  added?: boolean;
};

export type ProposedTask = {
  id: string;
  title: string;
  description: string;
  dueDate: string | null;
  priority: TaskPriority;
  important: boolean;
  urgent: boolean;
  areaName?: string | null;
  projectName?: string | null;
  status?: TaskStatus;
  scheduledDate?: string | null;
  assigneeName?: string;
  followUpDate?: string | null;
  reasoning: string;
  selected: boolean;
  added?: boolean;
};

export type ProposedHabit = {
  id: string;
  title: string;
  important: boolean;
  urgent: boolean;
  interval: number;
  unit: HabitUnit;
  endDate?: string | null;
  daysOfWeek?: number[];
  reasoning: string;
  selected: boolean;
  added?: boolean;
};

export type ProposedNote = {
  id: string;
  title: string;
  folderName: string | null;
  projectName?: string | null;
  bodyMarkdown: string;
  favorite: boolean;
  reasoning: string;
  selected: boolean;
  added?: boolean;
};

export type ProposedFolder = {
  id: string;
  name: string;
  parentName: string | null;
  reasoning: string;
  selected: boolean;
  added?: boolean;
};

export type NoteDraft = {
  title: string;
  folderName: string | null;
  projectName?: string | null;
  bodyMarkdown: string;
  favorite: boolean;
};

export type NoteFolderDraft = {
  name: string;
  parentName: string | null;
};

export type AgentMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  proposedAreas?: ProposedArea[];
  proposedProjects?: ProposedProject[];
  proposedTasks?: ProposedTask[];
  proposedHabits?: ProposedHabit[];
  proposedNotes?: ProposedNote[];
  proposedFolders?: ProposedFolder[];
  actualModel?: string;
  createdAt: string;
};

export type AgentProvider = "openrouter" | "codex";

// Reasoning effort for models that expose a reasoning control (OpenRouter
// `reasoning.effort`, Codex `modelReasoningEffort`). "auto" means the field
// is omitted and the provider default applies.
export type ReasoningEffort = "auto" | "low" | "medium" | "high";

export type AgentChatSummary = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
};

export type AgentChat = AgentChatSummary & {
  messages: AgentMessage[];
};

export type AgentSettings = {
  apiKey: string;
  transcriptionApiKey: string;
  model: string;
  codexModel?: string;
  webSearch: boolean;
  provider?: AgentProvider;
  reasoningEffort?: ReasoningEffort;
};
