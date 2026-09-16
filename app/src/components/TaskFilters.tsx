import { useState } from "react";
import type { TaskFilterState } from "../lib/taskFilters";
import { defaultTaskFilters } from "../lib/taskFilters";
import { Icon } from "./Icon";

type Props = {
  value: TaskFilterState;
  onChange: (next: TaskFilterState) => void;
};

const DATE_LABELS: Record<TaskFilterState["date"], string> = {
  any: "Any date",
  today: "Added today",
  week: "Last 7 days",
  older: "Added earlier",
};

const DUE_LABELS: Record<TaskFilterState["dueDate"], string> = {
  any: "Any due date",
  overdue: "Overdue",
  today: "Due today",
  next7: "Next 7 days",
  none: "No due date",
};

const TASK_PRIORITY_LABELS: Record<TaskFilterState["taskPriority"], string> = {
  any: "Any priority",
  p1: "Priority 1",
  p2: "Priority 2",
  p3: "Priority 3",
  p4: "Priority 4",
};

const MATRIX_LABELS: Record<TaskFilterState["priority"], string> = {
  any: "Any importance",
  important: "Important",
  urgent: "Urgent",
  both: "Important + urgent",
  none: "Neither",
};

const STATUS_LABELS: Record<TaskFilterState["status"], string> = {
  open: "Open",
  completed: "Completed",
  all: "All",
};

const SORT_LABELS: Record<TaskFilterState["sort"], string> = {
  recent: "Recently updated",
  oldest: "Oldest first",
  dueSoonest: "Due soonest",
  dueLatest: "Due latest",
};

export function TaskFilters({ value, onChange }: Props) {
  const [expanded, setExpanded] = useState(false);

  const activeCount =
    (value.query.trim() ? 1 : 0) +
    (value.date !== defaultTaskFilters.date ? 1 : 0) +
    (value.dueDate !== defaultTaskFilters.dueDate ? 1 : 0) +
    (value.taskPriority !== defaultTaskFilters.taskPriority ? 1 : 0) +
    (value.priority !== defaultTaskFilters.priority ? 1 : 0) +
    (value.status !== defaultTaskFilters.status ? 1 : 0) +
    (value.sort !== defaultTaskFilters.sort ? 1 : 0);

  const pills: Array<{ key: string; label: string; clear: () => void }> = [];
  if (value.query.trim()) {
    pills.push({
      key: "query",
      label: `“${value.query.trim()}”`,
      clear: () => onChange({ ...value, query: "" }),
    });
  }
  if (value.date !== "any") pills.push({ key: "date", label: DATE_LABELS[value.date], clear: () => onChange({ ...value, date: "any" }) });
  if (value.dueDate !== "any") pills.push({ key: "dueDate", label: DUE_LABELS[value.dueDate], clear: () => onChange({ ...value, dueDate: "any" }) });
  if (value.taskPriority !== "any") pills.push({ key: "taskPriority", label: TASK_PRIORITY_LABELS[value.taskPriority], clear: () => onChange({ ...value, taskPriority: "any" }) });
  if (value.priority !== "any") pills.push({ key: "priority", label: MATRIX_LABELS[value.priority], clear: () => onChange({ ...value, priority: "any" }) });
  if (value.status !== "open") pills.push({ key: "status", label: STATUS_LABELS[value.status], clear: () => onChange({ ...value, status: "open" }) });
  if (value.sort !== "recent") pills.push({ key: "sort", label: SORT_LABELS[value.sort], clear: () => onChange({ ...value, sort: "recent" }) });

  return (
    <div className="task-filters" aria-label="Task filters">
      <div className="filters-toolbar">
        <label className="filter-search">
          <Icon name="search" />
          <input
            type="search"
            value={value.query}
            aria-label="Search tasks"
            placeholder="Search tasks…"
            onChange={(event) => onChange({ ...value, query: event.target.value })}
          />
          {value.query.trim() && (
            <button
              type="button"
              className="filter-search-clear"
              aria-label="Clear search"
              onClick={() => onChange({ ...value, query: "" })}
            >
              <Icon name="close" />
            </button>
          )}
        </label>
        <div className="filters-toolbar-actions">
          <button
            type="button"
            className={`filter-toggle ${expanded ? "active" : ""} ${activeCount > 0 ? "has-active" : ""}`}
            aria-expanded={expanded}
            aria-controls="task-filter-panel"
            onClick={() => setExpanded((prev) => !prev)}
          >
            <Icon name="list" />
            <span>Filters</span>
            {activeCount > 0 && <span className="filter-count" aria-label={`${activeCount} active filters`}>{activeCount}</span>}
            <Icon name="chevron-down" />
          </button>
          <label className="filter-sort">
            <span className="filter-sort-label">Sort</span>
            <select aria-label="Sort tasks" value={value.sort} onChange={(event) => onChange({ ...value, sort: event.target.value as TaskFilterState["sort"] })}>
              <option value="recent">Recently updated</option>
              <option value="oldest">Oldest first</option>
              <option value="dueSoonest">Due soonest</option>
              <option value="dueLatest">Due latest</option>
            </select>
          </label>
        </div>
      </div>

      {expanded && (
        <div id="task-filter-panel" className="filters-panel">
          <label className="filter-field">
            <span>Date added</span>
            <select aria-label="Date added" value={value.date} onChange={(event) => onChange({ ...value, date: event.target.value as TaskFilterState["date"] })}>
              <option value="any">Any date</option>
              <option value="today">Added today</option>
              <option value="week">Last 7 days</option>
              <option value="older">Added earlier</option>
            </select>
          </label>
          <label className="filter-field">
            <span>Due date</span>
            <select aria-label="Due date" value={value.dueDate} onChange={(event) => onChange({ ...value, dueDate: event.target.value as TaskFilterState["dueDate"] })}>
              <option value="any">Any due date</option>
              <option value="overdue">Overdue</option>
              <option value="today">Due today</option>
              <option value="next7">Next 7 days</option>
              <option value="none">No due date</option>
            </select>
          </label>
          <label className="filter-field">
            <span>Priority</span>
            <select aria-label="Task priority" value={value.taskPriority} onChange={(event) => onChange({ ...value, taskPriority: event.target.value as TaskFilterState["taskPriority"] })}>
              <option value="any">Any priority</option>
              <option value="p1">Priority 1</option>
              <option value="p2">Priority 2</option>
              <option value="p3">Priority 3</option>
              <option value="p4">Priority 4</option>
            </select>
          </label>
          <label className="filter-field">
            <span>Importance</span>
            <select aria-label="Importance and urgency" value={value.priority} onChange={(event) => onChange({ ...value, priority: event.target.value as TaskFilterState["priority"] })}>
              <option value="any">Any importance</option>
              <option value="important">Important</option>
              <option value="urgent">Urgent</option>
              <option value="both">Important + urgent</option>
              <option value="none">Neither</option>
            </select>
          </label>
          <label className="filter-field">
            <span>Status</span>
            <select aria-label="Status" value={value.status} onChange={(event) => onChange({ ...value, status: event.target.value as TaskFilterState["status"] })}>
              <option value="open">Open</option>
              <option value="completed">Completed</option>
              <option value="all">All</option>
            </select>
          </label>
        </div>
      )}

      {pills.length > 0 && (
        <div className="active-pills" aria-label="Active filters">
          {pills.map((pill) => (
            <span key={pill.key} className="active-pill">
              <span>{pill.label}</span>
              <button type="button" aria-label={`Remove ${pill.label} filter`} onClick={pill.clear}>
                <Icon name="close" />
              </button>
            </span>
          ))}
          <button type="button" className="pills-clear" onClick={() => { onChange(defaultTaskFilters); setExpanded(false); }}>
            Clear all
          </button>
        </div>
      )}
    </div>
  );
}
