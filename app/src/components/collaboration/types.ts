import type { Project, TaskPriority } from "../../types";

// Presentation contracts only. These are not persisted Task/Project fields.
export type ProjectRole = "owner" | "editor" | "viewer";
export type PersonPresence = "online" | "away" | "offline" | "inactive";
export type Person = { id: string; name: string; email?: string; avatarUrl?: string | null; presence?: PersonPresence; status?: string };
export type ProjectMember = Person & { role: ProjectRole };
export type ProjectInvite = { id: string; email: string; role: Exclude<ProjectRole, "owner"> };
export type TaskPerson = Person & { role: "owner" | "assignee" | "collaborator" };
export type PlanningKey = "team" | "project" | "state" | "cycle" | "milestone" | "labels" | "parent";
export type PlanningOption = { id: string; name: string };
export type PlanningField = {
  key: PlanningKey;
  label: string;
  options: readonly PlanningOption[];
  selectedIds: readonly string[];
};
export type WorkflowState = PlanningOption & { category: "backlog" | "unstarted" | "started" | "completed" | "canceled" };
export type ProjectIssue = {
  id: string;
  title: string;
  identifier?: string;
  stateId: string | null;
  priority?: TaskPriority;
  people: readonly TaskPerson[];
  properties?: readonly { key: PlanningKey; label: string }[];
};
export type ProjectCycle = {
  id: string;
  name: string;
  phase: "current" | "upcoming" | "past";
  dateLabel: string;
  issueCount: number;
  completedCount: number;
  capacity?: number;
  startsOn?: string | null;
  endsOn?: string | null;
  issueIds?: string[];
};
export type EditableProject = Project & {
  health?: "On track" | "At risk" | "Off track" | null;
  startDate?: string | null;
  targetDate?: string | null;
};
export type ProjectEditorProps = {
  project: EditableProject;
  avatarUrl?: string | null;
  onSave: (project: EditableProject) => Promise<void>;
  onClose: () => void;
};
export type ProjectCycleDraft = { name: string; startsOn: string; endsOn: string; issueIds: string[] };
export type ProjectCycleEditorProps = {
  cycle?: { id?: string; name: string; startsOn?: string | null; endsOn?: string | null; issueIds?: string[] };
  issues: readonly ProjectIssue[];
  onSave: (draft: ProjectCycleDraft) => Promise<void>;
  onClose: () => void;
};
export type ProjectOverview = {
  lead?: Person;
  health?: "On track" | "At risk" | "Off track";
  startDate?: string;
  targetDate?: string;
  milestones?: readonly { id: string; name: string; completed: boolean }[];
  latestUpdate?: string;
  resources?: readonly { id: string; label: string; href: string }[];
};
export type ProjectSharingProps = {
  members: readonly ProjectMember[];
  invites: readonly ProjectInvite[];
  canManage?: boolean;
  loading?: boolean;
  busy?: boolean;
  error?: string;
  notice?: string;
  onInvite?: (email: string, role: ProjectInvite["role"]) => void;
  onRoleChange?: (personId: string, role: ProjectInvite["role"]) => void;
  onRemoveMember?: (personId: string) => void;
  onRevokeInvite?: (inviteId: string) => void;
  onCopyLink?: () => void;
};
export type ProjectCollaborationProps = {
  project: Pick<Project, "id" | "name" | "description" | "status" | "icon"> & Partial<Pick<Project, "projectType" | "targetDate" | "health">>;
  issues: readonly ProjectIssue[];
  states: readonly WorkflowState[];
  cycles: readonly ProjectCycle[];
  sharing: ProjectSharingProps;
  overview?: ProjectOverview;
  loading?: boolean;
  readOnly?: boolean;
  /** Creates an issue, optionally directly in a workflow state (board column). */
  onCreateIssue?: (stateId?: string) => void;
  onEditProject?: () => void;
  onMoveIssue?: (issueId: string, stateId: string) => Promise<void>;
  onCreateCycle?: () => void;
  onEditCycle?: (cycleId: string) => void;
  /** Opens a detail surface; the caller must honor readOnly there too. */
  onOpenIssue?: (issueId: string) => void;
  /** Deletes the backing task; omitted for read-only projects. */
  onDeleteIssue?: (issueId: string) => void;
  onOpenNotes?: () => void;
};
export type TaskPlanningProps = {
  people: readonly TaskPerson[];
  availablePeople: readonly Person[];
  fields: readonly PlanningField[];
  readOnly?: boolean;
  loading?: boolean;
  onPeopleChange?: (people: TaskPerson[]) => void;
  onFieldChange?: (key: PlanningKey, selectedIds: string[]) => void;
};
