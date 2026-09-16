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

export function filterTasks(tasks: Task[], filters: TaskFilterState, reference = new Date()): Task[] {
  const today = startOfDay(reference);
  const lastSevenDays = today - (6 * 24 * 60 * 60 * 1000);
  const query = filters.query.trim().toLocaleLowerCase();

  return tasks
    .filter((task) => {
      if (query && !`${task.title} ${task.description ?? ""}`.toLocaleLowerCase().includes(query)) return false;
      if (filters.status === "open" && task.completed) return false;
      if (filters.status === "completed" && !task.completed) return false;

      if (filters.taskPriority !== "any" && `p${task.priority ?? 4}` !== filters.taskPriority) return false;
      if (filters.priority === "important" && !task.important) return false;
      if (filters.priority === "urgent" && !task.urgent) return false;
      if (filters.priority === "both" && (!task.important || !task.urgent)) return false;
      if (filters.priority === "none" && (task.important || task.urgent)) return false;

      if (filters.date !== "any") {
        const createdAt = new Date(task.createdAt).getTime();
        if (!Number.isFinite(createdAt)) return false;
        if (filters.date === "today" && createdAt < today) return false;
        if (filters.date === "week" && createdAt < lastSevenDays) return false;
        if (filters.date === "older" && createdAt >= lastSevenDays) return false;
      }

      if (filters.dueDate !== "any") {
        const due = dateOnly(task.dueDate);
        if (filters.dueDate === "none" && due !== null) return false;
        if (filters.dueDate !== "none" && due === null) return false;
        if (filters.dueDate === "overdue" && due !== null && due >= today) return false;
        if (filters.dueDate === "today" && due !== today) return false;
        if (filters.dueDate === "next7" && due !== null && (due < today || due > today + (6 * 24 * 60 * 60 * 1000))) return false;
      }

      return true;
    })
    .sort((left, right) => {
      if (filters.sort === "dueSoonest" || filters.sort === "dueLatest") {
        const leftDue = dateOnly(left.dueDate);
        const rightDue = dateOnly(right.dueDate);
        if (leftDue === null && rightDue !== null) return 1;
        if (leftDue !== null && rightDue === null) return -1;
        if (leftDue !== null && rightDue !== null && leftDue !== rightDue) {
          return filters.sort === "dueSoonest" ? leftDue - rightDue : rightDue - leftDue;
        }
      } else {
        const leftDate = new Date(filters.sort === "recent" ? left.updatedAt : left.createdAt).getTime();
        const rightDate = new Date(filters.sort === "recent" ? right.updatedAt : right.createdAt).getTime();
        if (leftDate !== rightDate) return filters.sort === "recent" ? rightDate - leftDate : leftDate - rightDate;
      }

      const updatedDifference = new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
      if (updatedDifference !== 0) return updatedDifference;
      return left.id.localeCompare(right.id);
    });
}
