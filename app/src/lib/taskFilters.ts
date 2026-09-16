import type { Task } from "../types";

export type TaskDateFilter = "any" | "today" | "week" | "older";
export type TaskDueDateFilter = "any" | "overdue" | "today" | "next7" | "none";
export type TaskPriorityFilter = "any" | "p1" | "p2" | "p3" | "p4";
export type TaskMatrixFilter = "any" | "important" | "urgent" | "both" | "none";
export type TaskStatusFilter = "open" | "completed" | "all";
export type TaskSort = "recent" | "oldest" | "dueSoonest" | "dueLatest";

export type TaskFilterState = {
  query: string;
  date: TaskDateFilter;
  dueDate: TaskDueDateFilter;
  priority: TaskMatrixFilter;
  taskPriority: TaskPriorityFilter;
  status: TaskStatusFilter;
  sort: TaskSort;
};

export const defaultTaskFilters: TaskFilterState = {
  query: "",
  date: "any",
  dueDate: "any",
  priority: "any",
  taskPriority: "any",
  status: "open",
  sort: "recent",
};

const DAY_MS = 24 * 60 * 60 * 1000;

function startOfDay(value: Date): number {
  const day = new Date(value);
  day.setHours(0, 0, 0, 0);
  return day.getTime();
}

function dateOnly(value: string | null): number | null {
  if (!value) return null;
  const parsed = new Date(`${value.slice(0, 10)}T00:00:00`);
  return Number.isFinite(parsed.getTime()) ? parsed.getTime() : null;
}

function matchesQuery(task: Task, query: string): boolean {
  if (!query) return true;
  return `${task.title} ${task.description ?? ""}`.toLocaleLowerCase().includes(query);
}

function matchesStatus(task: Task, status: TaskStatusFilter): boolean {
  if (status === "open") return !task.completed;
  if (status === "completed") return task.completed;
  return true;
}

function matchesTaskPriority(task: Task, taskPriority: TaskPriorityFilter): boolean {
  return taskPriority === "any" || `p${task.priority ?? 4}` === taskPriority;
}

function matchesMatrix(task: Task, priority: TaskMatrixFilter): boolean {
  switch (priority) {
    case "important": return task.important;
    case "urgent": return task.urgent;
    case "both": return task.important && task.urgent;
    case "none": return !task.important && !task.urgent;
    default: return true;
  }
}

function matchesDateAdded(task: Task, date: TaskDateFilter, today: number): boolean {
  if (date === "any") return true;
  const createdAt = new Date(task.createdAt).getTime();
  if (!Number.isFinite(createdAt)) return false;
  if (date === "today") return createdAt >= today;
  const lastSevenDays = today - 6 * DAY_MS;
  if (date === "week") return createdAt >= lastSevenDays;
  return createdAt < lastSevenDays;
}

function matchesDueDate(task: Task, dueDate: TaskDueDateFilter, today: number): boolean {
  if (dueDate === "any") return true;
  const due = dateOnly(task.dueDate);
  if (dueDate === "none") return due === null;
  if (due === null) return false;
  if (dueDate === "overdue") return due < today;
  if (dueDate === "today") return due === today;
  return due >= today && due <= today + 6 * DAY_MS;
}

function matchesAll(task: Task, filters: TaskFilterState, query: string, today: number): boolean {
  return matchesQuery(task, query)
    && matchesStatus(task, filters.status)
    && matchesTaskPriority(task, filters.taskPriority)
    && matchesMatrix(task, filters.priority)
    && matchesDateAdded(task, filters.date, today)
    && matchesDueDate(task, filters.dueDate, today);
}

function compareByDueDate(left: Task, right: Task, sort: TaskSort): number | null {
  const leftDue = dateOnly(left.dueDate);
  const rightDue = dateOnly(right.dueDate);
  if (leftDue === null && rightDue === null) return null;
  if (leftDue === null) return 1;
  if (rightDue === null) return -1;
  if (leftDue === rightDue) return null;
  return sort === "dueSoonest" ? leftDue - rightDue : rightDue - leftDue;
}

function compareByTimestamp(left: Task, right: Task, sort: TaskSort): number | null {
  const recent = sort === "recent";
  const leftDate = new Date(recent ? left.updatedAt : left.createdAt).getTime();
  const rightDate = new Date(recent ? right.updatedAt : right.createdAt).getTime();
  if (leftDate === rightDate) return null;
  return recent ? rightDate - leftDate : leftDate - rightDate;
}

function compareTasks(left: Task, right: Task, sort: TaskSort): number {
  if (sort === "dueSoonest" || sort === "dueLatest") {
    const byDue = compareByDueDate(left, right, sort);
    if (byDue !== null) return byDue;
  } else {
    const byTimestamp = compareByTimestamp(left, right, sort);
    if (byTimestamp !== null) return byTimestamp;
  }
  const updatedDifference = new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
  if (updatedDifference !== 0) return updatedDifference;
  return left.id.localeCompare(right.id);
}

export function filterTasks(tasks: Task[], filters: TaskFilterState, reference = new Date()): Task[] {
  const today = startOfDay(reference);
  const query = filters.query.trim().toLocaleLowerCase();

  return tasks
    .filter((task) => matchesAll(task, filters, query, today))
    .sort((left, right) => compareTasks(left, right, filters.sort));
}
