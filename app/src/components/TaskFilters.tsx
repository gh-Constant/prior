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
        <select aria-label="Priority" value={value.priority} onChange={(event) => onChange({ ...value, priority: event.target.value as TaskFilterState["priority"] })}>
          <option value="any">Any priority</option>
          <option value="important">Important</option>
          <option value="urgent">Urgent</option>
          <option value="both">Important + urgent</option>
          <option value="none">No priority</option>
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
        </select>
      </label>
      {hasActiveFilters && <button className="filter-reset" type="button" title="Reset filters" aria-label="Reset filters" onClick={() => onChange(defaultTaskFilters)}><Icon name="close" /></button>}
    </div>
  );
}
