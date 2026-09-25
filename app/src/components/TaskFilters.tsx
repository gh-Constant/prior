import { useState } from "react";
import type { TaskFilterState } from "../lib/taskFilters";
import { defaultTaskFilters } from "../lib/taskFilters";
import { useI18n } from "../lib/i18n";
import { Icon } from "./Icon";
import { CustomSelect } from "./CustomSelect";

type Vars = Record<string, string | number>;
type TFn = (key: string, vars?: Vars) => string;

type Props = {
  readonly value: TaskFilterState;
  readonly onChange: (next: TaskFilterState) => void;
  /** Number of tasks being searched, shown in the placeholder when known. */
  readonly taskCount?: number;
};

type Pill = {
  readonly key: string;
  readonly label: string;
  readonly clear: () => void;
};

const DATE_KEYS: Record<TaskFilterState["date"], string> = {
  any: "tasks.filters.dateAny",
  today: "tasks.filters.dateToday",
  week: "tasks.filters.dateWeek",
  older: "tasks.filters.dateOlder",
};

const DUE_KEYS: Record<TaskFilterState["dueDate"], string> = {
  any: "tasks.filters.dueAny",
  overdue: "tasks.filters.dueOverdue",
  today: "tasks.filters.dueToday",
  next7: "tasks.filters.dueNext7",
  none: "tasks.filters.dueNone",
};

function taskPriorityLabel(value: TaskFilterState["taskPriority"], t: TFn): string {
  if (value === "any") return t("tasks.filters.priorityAny");
  return t("tasks.filters.priorityOption", { value: value.slice(1) });
}

const MATRIX_KEYS: Record<TaskFilterState["priority"], string> = {
  any: "tasks.filters.importanceAny",
  important: "tasks.filters.importanceImportant",
  urgent: "tasks.filters.importanceUrgent",
  both: "tasks.filters.importanceBoth",
  none: "tasks.filters.importanceNone",
};

const STATUS_KEYS: Record<TaskFilterState["status"], string> = {
  open: "tasks.filters.statusOpen",
  completed: "tasks.filters.statusCompleted",
  all: "tasks.filters.statusAll",
};

const SORT_KEYS: Record<TaskFilterState["sort"], string> = {
  recent: "tasks.filters.sortRecent",
  oldest: "tasks.filters.sortOldest",
  dueSoonest: "tasks.filters.sortDueSoonest",
  dueLatest: "tasks.filters.sortDueLatest",
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

function collectPills(value: TaskFilterState, onChange: (next: TaskFilterState) => void, t: TFn): Pill[] {
  const pills: Pill[] = [];
  if (value.query.trim()) {
    pills.push({ key: "query", label: `“${value.query.trim()}”`, clear: () => onChange({ ...value, query: "" }) });
  }
  if (value.date !== "any") pills.push({ key: "date", label: t(DATE_KEYS[value.date]), clear: () => onChange({ ...value, date: "any" }) });
  if (value.dueDate !== "any") pills.push({ key: "dueDate", label: t(DUE_KEYS[value.dueDate]), clear: () => onChange({ ...value, dueDate: "any" }) });
  if (value.taskPriority !== "any") pills.push({ key: "taskPriority", label: taskPriorityLabel(value.taskPriority, t), clear: () => onChange({ ...value, taskPriority: "any" }) });
  if (value.priority !== "any") pills.push({ key: "priority", label: t(MATRIX_KEYS[value.priority]), clear: () => onChange({ ...value, priority: "any" }) });
  if (value.status !== "open") pills.push({ key: "status", label: t(STATUS_KEYS[value.status]), clear: () => onChange({ ...value, status: "open" }) });
  if (value.sort !== "recent") pills.push({ key: "sort", label: t(SORT_KEYS[value.sort]), clear: () => onChange({ ...value, sort: "recent" }) });
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
      <CustomSelect
        ariaLabel={ariaLabel}
        value={value}
        onChange={(val) => onSelect(String(val))}
        options={options.map(([optionValue, optionLabel]) => ({
          value: optionValue,
          label: optionLabel,
        }))}
      />
    </label>
  );
}

function FiltersPanel({ value, onChange }: Props) {
  const { t } = useI18n();
  return (
    <div id="task-filter-panel" className="filters-panel">
      <FilterField label={t("tasks.filters.dateAdded")} ariaLabel={t("tasks.filters.dateAdded")} value={value.date} onSelect={(next) => onChange({ ...value, date: next as TaskFilterState["date"] })}
        options={[["any", t("tasks.filters.dateAny")], ["today", t("tasks.filters.dateToday")], ["week", t("tasks.filters.dateWeek")], ["older", t("tasks.filters.dateOlder")]]} />
      <FilterField label={t("tasks.filters.dueDate")} ariaLabel={t("tasks.filters.dueDate")} value={value.dueDate} onSelect={(next) => onChange({ ...value, dueDate: next as TaskFilterState["dueDate"] })}
        options={[["any", t("tasks.filters.dueAny")], ["overdue", t("tasks.filters.dueOverdue")], ["today", t("tasks.filters.dueToday")], ["next7", t("tasks.filters.dueNext7")], ["none", t("tasks.filters.dueNone")]]} />
      <FilterField label={t("tasks.filters.priority")} ariaLabel={t("tasks.filters.priorityAria")} value={value.taskPriority} onSelect={(next) => onChange({ ...value, taskPriority: next as TaskFilterState["taskPriority"] })}
        options={[["any", t("tasks.filters.priorityAny")], ["p1", t("tasks.filters.priorityOption", { value: "1" })], ["p2", t("tasks.filters.priorityOption", { value: "2" })], ["p3", t("tasks.filters.priorityOption", { value: "3" })], ["p4", t("tasks.filters.priorityOption", { value: "4" })]]} />
      <FilterField label={t("tasks.filters.importance")} ariaLabel={t("tasks.filters.importanceAria")} value={value.priority} onSelect={(next) => onChange({ ...value, priority: next as TaskFilterState["priority"] })}
        options={[["any", t("tasks.filters.importanceAny")], ["important", t("tasks.filters.importanceImportant")], ["urgent", t("tasks.filters.importanceUrgent")], ["both", t("tasks.filters.importanceBoth")], ["none", t("tasks.filters.importanceNone")]]} />
      <FilterField label={t("tasks.filters.status")} ariaLabel={t("tasks.filters.status")} value={value.status} onSelect={(next) => onChange({ ...value, status: next as TaskFilterState["status"] })}
        options={[["open", t("tasks.filters.statusOpen")], ["completed", t("tasks.filters.statusCompleted")], ["all", t("tasks.filters.statusAll")]]} />
    </div>
  );
}

function ActivePills({ pills, onClearAll }: { readonly pills: readonly Pill[]; readonly onClearAll: () => void }) {
  const { t } = useI18n();
  if (pills.length === 0) return null;
  return (
    <div className="active-pills" aria-label={t("tasks.filters.activeLabel")}>
      {pills.map((pill) => (
        <span key={pill.key} className="active-pill">
          <span>{pill.label}</span>
          <button type="button" aria-label={t("tasks.filters.remove", { label: pill.label })} onClick={pill.clear}>
            <Icon name="close" />
          </button>
        </span>
      ))}
      <button type="button" className="pills-clear" onClick={onClearAll}>
        {t("tasks.filters.clearAll")}
      </button>
    </div>
  );
}

export function TaskFilters({ value, onChange, taskCount }: Props) {
  const { t, tp } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const activeCount = activeFilterCount(value);
  const pills = collectPills(value, onChange, t);

  return (
    <div className="task-filters" aria-label={t("tasks.filters.label")}>
      <div className="filters-toolbar">
        <label className="filter-search">
          <Icon name="search" />
          <input
            type="search"
            value={value.query}
            aria-label={t("tasks.filters.searchLabel")}
            placeholder={taskCount ? tp("tasks.list.searchIn", taskCount) : t("tasks.filters.searchPlaceholder")}
            onChange={(event) => onChange({ ...value, query: event.target.value })}
          />
          {value.query.trim() && (
            <button
              type="button"
              className="filter-search-clear"
              aria-label={t("tasks.filters.clearSearch")}
              onClick={() => onChange({ ...value, query: "" })}
            >
              <Icon name="close" />
            </button>
          )}
        </label>
        <ActivePills pills={pills} onClearAll={() => { onChange(defaultTaskFilters); setExpanded(false); }} />
        <div className="filters-toolbar-actions">
          <button
            type="button"
            className={`filter-toggle ${expanded ? "active" : ""} ${activeCount > 0 ? "has-active" : ""}`}
            aria-expanded={expanded}
            aria-controls="task-filter-panel"
            onClick={() => setExpanded((prev) => !prev)}
          >
            <Icon name="sliders" />
            <span>{t("tasks.filters.toggle")}</span>
            {activeCount > 0 && <span className="filter-count" aria-label={tp("tasks.filters.active", activeCount)}>{activeCount}</span>}
          </button>
          <div className="filter-sort">
            <span className="filter-sort-label">{t("tasks.filters.sortLabel")}</span>
            <CustomSelect
              className="filter-sort-custom-select"
              ariaLabel={t("tasks.filters.sortAria")}
              value={value.sort}
              onChange={(next) => onChange({ ...value, sort: next as TaskFilterState["sort"] })}
              options={[
                { value: "recent", label: t("tasks.filters.sortRecent") },
                { value: "oldest", label: t("tasks.filters.sortOldest") },
                { value: "dueSoonest", label: t("tasks.filters.sortDueSoonest") },
                { value: "dueLatest", label: t("tasks.filters.sortDueLatest") },
              ]}
            />
          </div>
        </div>
      </div>

      {expanded && <FiltersPanel value={value} onChange={onChange} />}
    </div>
  );
}
