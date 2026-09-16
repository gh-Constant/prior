export type TaskPriority = 1 | 2 | 3 | 4;

export type Task = {
  id: string;
  title: string;
  description: string;
  dueDate: string | null;
  priority: TaskPriority;
  completed: boolean;
  important: boolean;
  urgent: boolean;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  serverRevision?: number;
};

export type TaskDraft = Pick<Task, "title" | "important" | "urgent"> & Partial<Pick<Task, "description" | "dueDate" | "priority">>;

export type HabitUnit = "day" | "week" | "month" | "year";

export type Habit = {
  id: string;
  title: string;
  important: boolean;
  urgent: boolean;
  interval: number;
  unit: HabitUnit;
  startDate: string;
  completedDates: string[];
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  serverRevision?: number;
};

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

export type ProposedTask = {
  id: string;
  title: string;
  description: string;
  dueDate: string | null;
  priority: TaskPriority;
  important: boolean;
  urgent: boolean;
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
  reasoning: string;
  selected: boolean;
  added?: boolean;
};

export type AgentMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  proposedTasks?: ProposedTask[];
  proposedHabits?: ProposedHabit[];
  actualModel?: string;
  createdAt: string;
};

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
  model: string;
  webSearch: boolean;
};
