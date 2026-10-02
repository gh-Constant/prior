import type { Project, Task } from "../types";
import { collaborationStore } from "./collaborationStore";
import { eventsInRange, loadCalendarState } from "./calendar";
import { MAX_ASSIGNEES, taskAssigneeIds } from "./assignees";

/** A person a shared-project task can be assigned to. */
export type AgentPerson = { id: string; name: string; email: string };

/** Members of a shared project (empty for personal projects). */
export function projectPeople(projectId: string | null | undefined): AgentPerson[] {
  if (!projectId) return [];
  const members = collaborationStore.members(projectId);
  if (members.length < 2) return [];
  return members.map((member) => ({ id: member.userId, name: member.displayName || member.email, email: member.email }));
}

function normalize(value: string): string {
  return value.normalize("NFKD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();
}

/**
 * The project member a name or email refers to ("Léa", "lea@x.fr", "me").
 * Returns undefined when nobody matches, or when the name is ambiguous.
 */
export function resolvePerson(value: unknown, people: readonly AgentPerson[], selfId?: string | null): AgentPerson | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const wanted = normalize(value);
  if (selfId && ["me", "moi", "myself", "yo", "ich", "eu"].includes(wanted)) return people.find((person) => person.id === selfId);
  const exact = people.filter((person) => person.id === value.trim() || normalize(person.email) === wanted || normalize(person.name) === wanted);
  if (exact.length === 1) return exact[0];
  const partial = people.filter((person) => normalize(person.name).split(/\s+/).includes(wanted) || normalize(person.name).startsWith(wanted));
  return partial.length === 1 ? partial[0] : undefined;
}

/**
 * Several people at once: a name or an array of names/ids/emails ("assignee" or "assignees").
 * Names that do not resolve (unknown or ambiguous) are skipped; the result is unique and
 * capped at MAX_ASSIGNEES.
 */
export function resolvePeople(value: unknown, people: readonly AgentPerson[], selfId?: string | null): AgentPerson[] {
  const inputs = Array.isArray(value) ? value : [value];
  const result: AgentPerson[] = [];
  for (const input of inputs) {
    const person = resolvePerson(input, people, selfId);
    if (person && !result.some((item) => item.id === person.id)) result.push(person);
  }
  return result.slice(0, MAX_ASSIGNEES);
}

/** A milestone of the project from its id or (case-insensitive) name. */
export function resolveMilestone(value: unknown, project: Project | undefined): { id: string; name: string } | undefined {
  if (typeof value !== "string" || !value.trim() || !project?.milestones?.length) return undefined;
  const wanted = normalize(value);
  return project.milestones.find((milestone) => milestone.id === value.trim() || normalize(milestone.name) === wanted);
}

/** Names of a task's shared-project fields, for the prompt. */
export function describeTaskPeople(task: Task, projects: readonly Project[]): string {
  const parts: string[] = [];
  const people = projectPeople(task.projectId);
  const assignees = taskAssigneeIds(task);
  if (assignees.length) {
    const names = assignees.map((id) => people.find((candidate) => candidate.id === id)).map((person) => (person ? `"${person.name}"` : "a former member"));
    parts.push(`${assignees.length > 1 ? "assignees" : "assignee"}: ${names.join(", ")}`);
  }
  if (task.parentId) parts.push(`sub-task of [id: ${task.parentId}]`);
  const project = projects.find((item) => item.id === task.projectId);
  const milestone = project?.milestones?.find((item) => item.id === task.milestoneId);
  if (milestone) parts.push(`milestone: "${milestone.name}"`);
  const blockers = (task.relations ?? []).filter((relation) => relation.type === "blocked_by").map((relation) => relation.taskId);
  if (blockers.length) parts.push(`blocked by ${blockers.map((id) => `[id: ${id}]`).join(", ")}`);
  return parts.length ? `, ${parts.join(", ")}` : "";
}

/** The shared-project part of a project line: members and milestones. */
export function describeProjectPeople(project: Project): string {
  const people = projectPeople(project.id);
  const parts: string[] = [];
  if (people.length) parts.push(`shared with ${people.map((person) => `"${person.name}" <${person.email}>`).join(", ")}`);
  if (project.milestones?.length) parts.push(`milestones: ${project.milestones.map((milestone) => `"${milestone.name}"${milestone.targetDate ? ` (${milestone.targetDate})` : ""}`).join(", ")}`);
  return parts.length ? `, ${parts.join(", ")}` : "";
}

/** Recently completed tasks, newest first, for weekly reviews. */
export function recentlyCompleted(tasks: readonly Task[], now = new Date(), days = 14, limit = 20): Task[] {
  const since = now.getTime() - days * 86_400_000;
  return tasks
    .filter((task) => task.completed && !task.deletedAt && Date.parse(task.updatedAt) >= since)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, limit);
}

/** Calendar events of the next days (read-only), one line each. */
export function upcomingEventsForPrompt(now = new Date(), days = 7, limit = 25): string[] {
  try {
    const from = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const to = new Date(from);
    to.setDate(from.getDate() + days);
    return eventsInRange({ ...loadCalendarState(), showHabits: false }, [], from, to)
      .filter((event) => event.kind === "event")
      .sort((left, right) => `${left.date} ${left.startTime ?? ""}`.localeCompare(`${right.date} ${right.startTime ?? ""}`))
      .slice(0, limit)
      .map((event) => `- ${event.date}${event.startTime ? ` ${event.startTime}${event.endTime ? `–${event.endTime}` : ""}` : " (all day)"}: "${event.title.slice(0, 120)}"`);
  } catch {
    return [];
  }
}
