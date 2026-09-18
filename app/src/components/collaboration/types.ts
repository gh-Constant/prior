import type { Project, TaskPriority } from "../../types";

// Presentation contracts only. These are not persisted Task/Project fields.
export type ProjectRole = "owner" | "editor" | "viewer";
export type Person = { id: string; name: string; email?: string };
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
export type WorkflowState = PlanningOption & { category: "triage" | "backlog" | "unstarted" | "started" | "completed" | "canceled" };
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
  project: Pick<Project, "id" | "name" | "description" | "status">;
  issues: readonly ProjectIssue[];
  states: readonly WorkflowState[];
  cycles: readonly ProjectCycle[];
  sharing: ProjectSharingProps;
  overview?: ProjectOverview;
  loading?: boolean;
  readOnly?: boolean;
  onCreateIssue?: () => void;
  /** Opens a detail surface; the caller must honor readOnly there too. */
  onOpenIssue?: (issueId: string) => void;
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
