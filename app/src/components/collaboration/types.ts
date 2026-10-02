import type { ReactNode } from "react";
import type { Project, TaskPriority } from "../../types";

// Presentation contracts only. These are not persisted Task/Project fields.
export type ProjectRole = "owner" | "editor" | "viewer";
export type { PersonPresence } from "../../lib/presence";
import type { PersonPresence } from "../../lib/presence";
export type Person = { id: string; name: string; email?: string; avatarUrl?: string | null; presence?: PersonPresence; /** ISO time an offline person was last seen, when known. */ lastSeenAt?: string | null };
export type ProjectMember = Person & { role: ProjectRole };
export type ProjectInvite = { id: string; email: string; role: Exclude<ProjectRole, "owner">; expiresAt?: string };
/** What happened to one invited address, shown in the share dialog. */
export type InviteOutcome =
  | { kind: "invited"; email: string; link: string; emailSent: boolean }
  | { kind: "member"; email: string; role: ProjectInvite["role"] }
  | { kind: "error"; email: string; message: string };
/** A reusable invitation link of a role, as the share dialog shows it. */
export type ShareLinkItem = { id: string; role: ProjectInvite["role"]; expiresAt?: string; useCount: number };
/** Reusable editor/viewer links (specs/AGILE_COLLABORATION.md, "Share links"). */
export type ShareLinkActions = {
  list: () => Promise<ShareLinkItem[]>;
  /** Creates the link of a role, replacing the previous one; `url` is shown once. */
  create: (role: ProjectInvite["role"], expiresInDays?: number) => Promise<{ link: ShareLinkItem; url: string }>;
  revoke: (linkId: string) => Promise<void>;
};
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
  /** Size of the issue in story points; null or absent when not estimated. */
  storyPoints?: number | null;
  people: readonly TaskPerson[];
  /** The one person responsible (Linear's assignee). */
  assigneeId?: string | null;
  /** Waits on a task that is not done yet. */
  blocked?: boolean;
  /** Progress of its sub-tasks, when it has some. */
  subtasks?: { done: number; total: number };
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
  /** Scrum: the dialog speaks of sprints. */
  sprint?: boolean;
  /** Shows the story points of the issues and the total committed to the sprint. */
  points?: boolean;
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
  milestones?: readonly { id: string; name: string; completed: boolean; targetDate?: string | null; done?: number; total?: number }[];
  latestUpdate?: string;
  resources?: readonly { id: string; label: string; href: string }[];
};
/**
 * Sharing actions return promises: the dialog shows progress and the real
 * outcome (sent, emailed or not, failed) instead of assuming success.
 */
export type ProjectSharingProps = {
  members: readonly ProjectMember[];
  invites: readonly ProjectInvite[];
  canManage?: boolean;
  loading?: boolean;
  /** The signed-in account, marked "you" and offered "Leave project". */
  currentUserId?: string | null;
  /** People the user already works with, suggested as invitees. */
  suggestions?: readonly Person[];
  onInvite?: (email: string, role: ProjectInvite["role"]) => Promise<InviteOutcome | void> | void;
  onRoleChange?: (personId: string, role: ProjectInvite["role"]) => Promise<void> | void;
  onRemoveMember?: (personId: string) => Promise<void> | void;
  onLeave?: () => Promise<void> | void;
  onRevokeInvite?: (inviteId: string) => Promise<void> | void;
  /** Gives a pending invite a fresh link; `sendEmail` also emails it again. */
  onResendInvite?: (inviteId: string, sendEmail: boolean) => Promise<{ link: string; emailSent: boolean }>;
  /** Reusable invitation links; without it the dialog only offers email invitations. */
  shareLinks?: ShareLinkActions;
  /** The project's own address (only works for members). */
  projectLink?: string;
  onCopyLink?: () => Promise<void> | void;
};
export type ProjectCollaborationProps = {
  project: Pick<Project, "id" | "name" | "description" | "status" | "icon"> & Partial<Pick<Project, "projectType" | "methodology" | "targetDate" | "health">>;
  issues: readonly ProjectIssue[];
  states: readonly WorkflowState[];
  cycles: readonly ProjectCycle[];
  sharing: ProjectSharingProps;
  overview?: ProjectOverview;
  loading?: boolean;
  readOnly?: boolean;
  /** A shared project while Prior cannot reach the server: shown read-only. */
  offline?: boolean;
  /** Creates an issue, optionally directly in a workflow state (board column). */
  onCreateIssue?: (stateId?: string) => void;
  onEditProject?: () => void;
  onMoveIssue?: (issueId: string, stateId: string) => Promise<void>;
  onCreateCycle?: () => void;
  onEditCycle?: (cycleId: string) => void;
  onCreateMilestone?: () => void;
  onEditMilestone?: (milestoneId: string) => void;
  /** Opens a detail surface; the caller must honor readOnly there too. */
  onOpenIssue?: (issueId: string) => void;
  /** Deletes the backing task; omitted for read-only projects. */
  onDeleteIssue?: (issueId: string) => void;
  onOpenNotes?: () => void;
  /** Area name and back action, shown by the phone navigation bar. */
  areaName?: string | null;
  onBack?: () => void;
  /** Controlled tab ("board", "issues", "overview", "cycles"), mirrored in the URL. */
  tab?: string | null;
  onTabChange?: (tab: string) => void;
  /** Members a task can be assigned to, and the signed-in account. */
  assignablePeople?: readonly Person[];
  currentUserId?: string | null;
  /** Assigns (or unassigns with null) an issue; omitted when read-only. */
  onAssignIssue?: (issueId: string, personId: string | null) => Promise<void>;
  /** Loads the activity grid (tasks completed per day and person). */
  loadActivity?: () => Promise<ProjectActivityEntry[]>;
  /** Content of the Planning Poker tab (Scrum and Scrumban projects); without it the tab is not shown. */
  renderPoker?: () => ReactNode;
};
export type ProjectActivityEntry = { date: string; userId: string | null; completed: number; created: number };
export type TaskPlanningProps = {
  people: readonly TaskPerson[];
  availablePeople: readonly Person[];
  /** Shared projects: who the task can be assigned to, and its assignee. */
  assignablePeople?: readonly Person[];
  assigneeId?: string | null;
  currentUserId?: string | null;
  fields: readonly PlanningField[];
  readOnly?: boolean;
  loading?: boolean;
  onPeopleChange?: (people: TaskPerson[]) => void;
  onFieldChange?: (key: PlanningKey, selectedIds: string[]) => void;
};
