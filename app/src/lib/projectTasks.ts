import type { Task, TaskPriority, TaskStatus } from "../types";
import type { ProjectIssue, WorkflowState } from "../components/collaboration/types";

export type CollaborationIssuesSource = Readonly<
  Record<string, { readonly issues: readonly ProjectIssue[]; readonly states?: readonly WorkflowState[] }>
>;

const TASK_STATUSES: ReadonlySet<string> = new Set(["inbox", "backlog", "next", "in_progress", "waiting", "done"]);

function isCompletedState(stateId: string | null, states?: readonly WorkflowState[]): boolean {
  if (stateId === "done") return true;
  if (!stateId || !states) return false;
  return states.some((state) => state.id === stateId && state.category === "completed");
}

function toTaskStatus(stateId: string | null): TaskStatus {
  return stateId && TASK_STATUSES.has(stateId) ? (stateId as TaskStatus) : "next";
}

/**
 * Project issues carry assignment in `people` (role owner/assignee/collaborator).
 * `assigneeName` only exists on personal Task rows as display text, so it is
 * not a reliable identity signal for issues. Any people entry matching the
 * current user counts as assigned; unassigned issues (empty people) stay
 * visible to everyone so team work is never hidden from All/Today.
 */
export function isIssueVisibleToUser(
  issue: Pick<ProjectIssue, "people">,
  userId: string | null | undefined,
): boolean {
  if (!userId) return true;
  const people = issue.people ?? [];
  if (people.length === 0) return true;
  return people.some((person) => person.id === userId);
}

/** Task-level counterpart: a project task is mine when my id is in peopleIds. */
export function isProjectTaskAssigned(task: Task, userId: string | null | undefined): boolean {
  if (!task.projectId) return false;
  if (!userId) return true;
  const peopleIds = task.peopleIds ?? [];
  if (peopleIds.length === 0) return true;
  return peopleIds.includes(userId);
}

function issueToTask(issue: ProjectIssue, projectId: string, states?: readonly WorkflowState[], now = new Date().toISOString()): Task {
  const completed = isCompletedState(issue.stateId, states);
  const status = completed && issue.stateId !== "done" ? toTaskStatus(issue.stateId) : toTaskStatus(issue.stateId);
  return {
    id: issue.id,
    title: issue.title,
    description: "",
    dueDate: null,
    priority: (issue.priority ?? 4) as TaskPriority,
    projectId,
    areaId: null,
    status: completed ? "done" : status,
    scheduledDate: null,
    peopleIds: (issue.people ?? []).map((person) => person.id),
    completed,
    important: false,
    urgent: false,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };
}

/**
 * Merge project issues assigned to the current user into the task pool used by
 * the All and Today views. Existing tasks win on id conflicts (dedupe); only
 * missing assigned issues are synthesized as Tasks. Completed filtering is
 * left to the downstream views (filterTasks status / Today ranking) so Inbox,
 * Next and Waiting logic stays untouched.
 */
export function mergeAssignedProjectTasks(
  tasks: Task[],
  collaborationByProject: CollaborationIssuesSource | undefined,
  userId: string | null | undefined,
): Task[] {
  if (!collaborationByProject) return tasks;
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const missing: Task[] = [];
  const now = new Date().toISOString();
  for (const [projectId, entry] of Object.entries(collaborationByProject)) {
    if (!entry?.issues) continue;
    for (const issue of entry.issues) {
      if (byId.has(issue.id)) continue;
      if (!isIssueVisibleToUser(issue, userId)) continue;
      const synthesized = issueToTask(issue, projectId, entry.states, now);
      byId.set(synthesized.id, synthesized);
      missing.push(synthesized);
    }
  }
  return missing.length ? [...tasks, ...missing] : tasks;
}
