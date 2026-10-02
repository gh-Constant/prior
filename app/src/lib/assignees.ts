// Several assignees per task (specs/AGILE_COLLABORATION.md, "Several assignees").
//
// `Task.assigneeIds` is the ordered list of people responsible for a task.
// `Task.assigneeId` stays the FIRST of them: older clients and servers only
// know one assignee, so both fields are always written together. Pure helpers,
// shared by the stores, the UI and the assistant.

/** Same bound as the API (server/internal/tasks/assignees.go): keep the two in sync. */
export const MAX_ASSIGNEES = 10;

type AssigneeFields = { assigneeId?: string | null; assigneeIds?: readonly string[] | null };

function cleanId(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * A list of user ids from an array or JSON text (SQLite): trimmed, unique in
 * first-seen order, at most MAX_ASSIGNEES. Anything else is an empty list.
 */
export function normalizeAssigneeIds(value: unknown): string[] {
  let parsed = value;
  if (typeof parsed === "string") {
    try { parsed = JSON.parse(parsed); } catch { parsed = []; }
  }
  if (!Array.isArray(parsed)) return [];
  const result: string[] = [];
  for (const item of parsed) {
    const id = cleanId(item);
    if (id && !result.includes(id)) result.push(id);
    if (result.length >= MAX_ASSIGNEES) break;
  }
  return result;
}

/**
 * The assignees of a task. Data that predates several assignees (or comes
 * from an older server) only carries `assigneeId`, which then is the list.
 */
export function taskAssigneeIds(task: AssigneeFields): string[] {
  const ids = normalizeAssigneeIds(task.assigneeIds);
  if (ids.length > 0) return ids;
  const legacy = cleanId(task.assigneeId);
  return legacy ? [legacy] : [];
}

/** The two assignee fields of a task for a list of people (first = assigneeId). */
export function assigneeFields(ids: readonly string[]): { assigneeId: string | null; assigneeIds: string[] } {
  const assigneeIds = normalizeAssigneeIds(ids);
  return { assigneeId: assigneeIds[0] ?? null, assigneeIds };
}

/**
 * The assignees a saved task ends up with. A new client sends `assigneeIds`;
 * a caller that only knows `assigneeId` (an old draft, the assistant) keeps
 * the other assignees when it re-sends the current first one, like the server.
 */
export function resolveAssigneeIds(input: AssigneeFields, previous?: AssigneeFields): string[] {
  if (input.assigneeIds !== undefined) return normalizeAssigneeIds(input.assigneeIds);
  const before = previous ? taskAssigneeIds(previous) : [];
  if (input.assigneeId === undefined) return before;
  const legacy = cleanId(input.assigneeId);
  if (!legacy) return [];
  return before[0] === legacy ? before : [legacy];
}

/** Adds the person when absent (at the end), removes them when present. */
export function toggleAssignee(ids: readonly string[], personId: string): string[] {
  if (ids.includes(personId)) return ids.filter((id) => id !== personId);
  return ids.length >= MAX_ASSIGNEES ? [...ids] : [...ids, personId];
}

export function isAssignedTo(task: AssigneeFields, userId: string | null | undefined): boolean {
  return Boolean(userId) && taskAssigneeIds(task).includes(userId as string);
}

/** Ids that are in the second list but not in the first (the people newly assigned). */
export function addedAssignees(before: readonly string[], after: readonly string[]): string[] {
  return after.filter((id) => !before.includes(id));
}
