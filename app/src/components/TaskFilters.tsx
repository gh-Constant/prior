import { useState } from "react";
import type { TaskFilterState } from "../lib/taskFilters";
import { defaultTaskFilters } from "../lib/taskFilters";
import { Icon } from "./Icon";

type Props = {
  readonly value: TaskFilterState;
  readonly onChange: (next: TaskFilterState) => void;
};

type Pill = {
  readonly key: string;
  readonly label: string;
  readonly clear: () => void;
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

function activeFilterCount(value: TaskFilterState): number {
  const flags = [
    value.query.trim() !== "",
    value.date !== defaultTaskFilters.date,
    value.dueDate !== defaultTaskFilters.dueDate,
    value.taskPriority !== defaultTaskFilters.taskPriority,
    value.priority !== defaultTaskFilters.priority,
    value.status !== defaultTaskFilters.status,
    value.sort !== defaultTaskFilters.sort,
  ];
  return flags.filter(Boolean).length;
}

function collectPills(value: TaskFilterState, onChange: (next: TaskFilterState) => void): Pill[] {
  const pills: Pill[] = [];
  if (value.query.trim()) {
    pills.push({ key: "query", label: `“${value.query.trim()}”`, clear: () => onChange({ ...value, query: "" }) });
  }
  if (value.date !== "any") pills.push({ key: "date", label: DATE_LABELS[value.date], clear: () => onChange({ ...value, date: "any" }) });
  if (value.dueDate !== "any") pills.push({ key: "dueDate", label: DUE_LABELS[value.dueDate], clear: () => onChange({ ...value, dueDate: "any" }) });
  if (value.taskPriority !== "any") pills.push({ key: "taskPriority", label: TASK_PRIORITY_LABELS[value.taskPriority], clear: () => onChange({ ...value, taskPriority: "any" }) });
  if (value.priority !== "any") pills.push({ key: "priority", label: MATRIX_LABELS[value.priority], clear: () => onChange({ ...value, priority: "any" }) });
  if (value.status !== "open") pills.push({ key: "status", label: STATUS_LABELS[value.status], clear: () => onChange({ ...value, status: "open" }) });
  if (value.sort !== "recent") pills.push({ key: "sort", label: SORT_LABELS[value.sort], clear: () => onChange({ ...value, sort: "recent" }) });
  return pills;
}

function FilterField({ label, ariaLabel, value, options, onSelect }: {
  readonly label: string;
  readonly ariaLabel: string;
  readonly value: string;
  readonly options: ReadonlyArray<readonly [string, string]>;
  readonly onSelect: (next: string) => void;
}) {
  return (
    <label className="filter-field">
      <span>{label}</span>
      <select aria-label={ariaLabel} value={value} onChange={(event) => onSelect(event.target.value)}>
        {options.map(([optionValue, optionLabel]) => (
          <option key={optionValue} value={optionValue}>{optionLabel}</option>
        ))}
      </select>
    </label>
  );
}

function FiltersPanel({ value, onChange }: Props) {
  return (
    <div id="task-filter-panel" className="filters-panel">
      <FilterField label="Date added" ariaLabel="Date added" value={value.date} onSelect={(next) => onChange({ ...value, date: next as TaskFilterState["date"] })}
        options={[["any", "Any date"], ["today", "Added today"], ["week", "Last 7 days"], ["older", "Added earlier"]]} />
      <FilterField label="Due date" ariaLabel="Due date" value={value.dueDate} onSelect={(next) => onChange({ ...value, dueDate: next as TaskFilterState["dueDate"] })}
        options={[["any", "Any due date"], ["overdue", "Overdue"], ["today", "Due today"], ["next7", "Next 7 days"], ["none", "No due date"]]} />
      <FilterField label="Priority" ariaLabel="Task priority" value={value.taskPriority} onSelect={(next) => onChange({ ...value, taskPriority: next as TaskFilterState["taskPriority"] })}
        options={[["any", "Any priority"], ["p1", "Priority 1"], ["p2", "Priority 2"], ["p3", "Priority 3"], ["p4", "Priority 4"]]} />
      <FilterField label="Importance" ariaLabel="Importance and urgency" value={value.priority} onSelect={(next) => onChange({ ...value, priority: next as TaskFilterState["priority"] })}
        options={[["any", "Any importance"], ["important", "Important"], ["urgent", "Urgent"], ["both", "Important + urgent"], ["none", "Neither"]]} />
      <FilterField label="Status" ariaLabel="Status" value={value.status} onSelect={(next) => onChange({ ...value, status: next as TaskFilterState["status"] })}
        options={[["open", "Open"], ["completed", "Completed"], ["all", "All"]]} />
    </div>
  );
}

function ActivePills({ pills, onClearAll }: { readonly pills: readonly Pill[]; readonly onClearAll: () => void }) {
  if (pills.length === 0) return null;
  return (
    <div className="active-pills" aria-label="Active filters">
      {pills.map((pill) => (
        <span key={pill.key} className="active-pill">
          <span>{pill.label}</span>
          <button type="button" aria-label={`Remove ${pill.label} filter`} onClick={pill.clear}>
            <Icon name="close" />
          </button>
        </span>
      ))}
      <button type="button" className="pills-clear" onClick={onClearAll}>
        Clear all
      </button>
    </div>
  );
}

export function TaskFilters({ value, onChange }: Props) {
  const [expanded, setExpanded] = useState(false);
  const activeCount = activeFilterCount(value);
  const pills = collectPills(value, onChange);

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

      {expanded && <FiltersPanel value={value} onChange={onChange} />}
      <ActivePills pills={pills} onClearAll={() => { onChange(defaultTaskFilters); setExpanded(false); }} />
    </div>
  );
}
