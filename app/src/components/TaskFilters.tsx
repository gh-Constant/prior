import type { TaskFilterState } from "../lib/taskFilters";
import { defaultTaskFilters } from "../lib/taskFilters";
import { Icon } from "./Icon";

type Props = {
  value: TaskFilterState;
  onChange: (next: TaskFilterState) => void;
};

export function TaskFilters({ value, onChange }: Props) {
  const hasActiveFilters = JSON.stringify(value) !== JSON.stringify(defaultTaskFilters);

  return (
    <div className="task-filters" aria-label="Task filters">
      <label className="filter-search">
        <Icon name="search" />
        <input
          type="search"
          value={value.query}
          aria-label="Search tasks"
          placeholder="Search tasks"
          onChange={(event) => onChange({ ...value, query: event.target.value })}
        />
      </label>
      <label className="filter-control">
        <select aria-label="Date added" value={value.date} onChange={(event) => onChange({ ...value, date: event.target.value as TaskFilterState["date"] })}>
          <option value="any">Any date</option>
          <option value="today">Added today</option>
          <option value="week">Last 7 days</option>
          <option value="older">Added earlier</option>
        </select>
      </label>
      <label className="filter-control">
        <select aria-label="Due date" value={value.dueDate} onChange={(event) => onChange({ ...value, dueDate: event.target.value as TaskFilterState["dueDate"] })}>
          <option value="any">Any due date</option>
          <option value="overdue">Overdue</option>
          <option value="today">Due today</option>
          <option value="next7">Next 7 days</option>
          <option value="none">No due date</option>
        </select>
      </label>
      <label className="filter-control">
        <select aria-label="Task priority" value={value.taskPriority} onChange={(event) => onChange({ ...value, taskPriority: event.target.value as TaskFilterState["taskPriority"] })}>
          <option value="any">Any task priority</option>
          <option value="p1">Priority 1</option>
          <option value="p2">Priority 2</option>
          <option value="p3">Priority 3</option>
          <option value="p4">Priority 4</option>
        </select>
      </label>
      <label className="filter-control">
        <select aria-label="Importance and urgency" value={value.priority} onChange={(event) => onChange({ ...value, priority: event.target.value as TaskFilterState["priority"] })}>
          <option value="any">Any importance</option>
          <option value="important">Important</option>
          <option value="urgent">Urgent</option>
          <option value="both">Important + urgent</option>
          <option value="none">Not important or urgent</option>
        </select>
      </label>
      <label className="filter-control">
        <select aria-label="Status" value={value.status} onChange={(event) => onChange({ ...value, status: event.target.value as TaskFilterState["status"] })}>
          <option value="open">Open</option>
          <option value="completed">Completed</option>
          <option value="all">All</option>
        </select>
      </label>
      <label className="filter-control filter-sort">
        <select aria-label="Sort tasks" value={value.sort} onChange={(event) => onChange({ ...value, sort: event.target.value as TaskFilterState["sort"] })}>
          <option value="recent">Recently updated</option>
          <option value="oldest">Oldest first</option>
          <option value="dueSoonest">Due soonest</option>
          <option value="dueLatest">Due latest</option>
        </select>
      </label>
      {hasActiveFilters && <button className="filter-reset" type="button" title="Reset filters" aria-label="Reset filters" onClick={() => onChange(defaultTaskFilters)}><Icon name="close" /></button>}
    </div>
  );
}
