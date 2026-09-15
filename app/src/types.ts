export type Task = {
  id: string;
  title: string;
  completed: boolean;
  important: boolean;
  urgent: boolean;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  serverRevision?: number;
};

export type Mutation = {
  id: string;
  task: Task;
  kind: "upsert" | "delete";
  createdAt: string;
};

export type SyncState = {
  lastServerRevision: number;
  pendingCount: number;
};

export type QuadrantKey = "focus" | "plan" | "quick" | "later";

export type ProposedTask = {
  id: string;
  title: string;
  important: boolean;
  urgent: boolean;
  reasoning: string;
  selected: boolean;
  added?: boolean;
};

export type AgentMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  proposedTasks?: ProposedTask[];
  createdAt: string;
};

export type AgentSettings = {
  apiKey: string;
  model: string;
};

