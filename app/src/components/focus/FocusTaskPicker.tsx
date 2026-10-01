import { useMemo, useState } from "react";
import type { Project, Task } from "../../types";
import { useI18n } from "../../lib/i18n";
import { formatEstimate } from "../../lib/taskEstimate";
import { Icon } from "../Icon";
import { Modal } from "../Modal";
import { dueLabel } from "../TaskRow";

type Props = {
  readonly recommended: readonly Task[];
  readonly others: readonly Task[];
  readonly projects: readonly Project[];
  readonly selectedId: string | null;
  readonly onSelect: (taskId: string | null) => void;
  readonly onClose: () => void;
};

function matches(task: Task, query: string): boolean {
  return task.title.toLocaleLowerCase().includes(query) || (task.description ?? "").toLocaleLowerCase().includes(query);
}

/** One task in the picker and in the Focus page's suggestions. */
export function FocusTaskOption({ task, project, selected, onSelect }: { readonly task: Task; readonly project?: Project; readonly selected?: boolean; readonly onSelect: () => void }) {
  const { t, lang } = useI18n();
  const due = dueLabel(task, lang, t);
  const estimate = formatEstimate(task.estimatedMinutes);
  return (
    <button type="button" className={`focus-task-option ${selected ? "is-selected" : ""}`} aria-pressed={selected} onClick={onSelect}>
      <span className={`focus-task-flag priority-${task.priority}`} aria-hidden="true" />
      <span className="focus-task-option-text">
        <strong>{task.title}</strong>
        {(project || due || estimate) && (
          <span className="focus-task-option-meta">
            {project && <span>{project.name}</span>}
            {due && <span className={`is-${due.tone}`}>{due.label}</span>}
            {estimate && <span>{estimate}</span>}
          </span>
        )}
      </span>
      {selected && <Icon name="check" className="focus-task-option-check" />}
    </button>
  );
}

/** Searchable list of open tasks, recommended ones first. A bottom sheet on phones. */
export function FocusTaskPicker({ recommended, others, projects, selectedId, onSelect, onClose }: Props) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const projectById = useMemo(() => new Map(projects.map((project) => [project.id, project])), [projects]);
  const needle = query.trim().toLocaleLowerCase();
  const shownRecommended = needle ? recommended.filter((task) => matches(task, needle)) : recommended;
  const shownOthers = (needle ? others.filter((task) => matches(task, needle)) : others).slice(0, 80);
  const pick = (id: string | null) => { onSelect(id); onClose(); };
  const option = (task: Task) => (
    <li key={task.id}>
      <FocusTaskOption task={task} project={task.projectId ? projectById.get(task.projectId) : undefined} selected={task.id === selectedId} onSelect={() => pick(task.id)} />
    </li>
  );

  return (
    <Modal title={t("focus.picker.title")} onClose={onClose} className="focus-picker-modal" maxWidth={560}>
      <div className="prior-modal-body focus-picker">
        <label className="focus-picker-search">
          <Icon name="search" aria-hidden="true" />
          <input
            type="search"
            value={query}
            autoFocus
            placeholder={t("focus.picker.search")}
            aria-label={t("focus.picker.search")}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <div className="focus-picker-scroll">
          {!needle && (
            <button type="button" className={`focus-task-option focus-task-none ${selectedId === null ? "is-selected" : ""}`} aria-pressed={selectedId === null} onClick={() => pick(null)}>
              <span className="focus-task-flag" aria-hidden="true" />
              <span className="focus-task-option-text"><strong>{t("focus.picker.none")}</strong><span className="focus-task-option-meta"><span>{t("focus.picker.noneHint")}</span></span></span>
              {selectedId === null && <Icon name="check" className="focus-task-option-check" />}
            </button>
          )}
          {shownRecommended.length > 0 && (
            <section aria-label={t("focus.picker.recommended")}>
              <h3 className="focus-picker-heading"><Icon name="sparkles" aria-hidden="true" />{t("focus.picker.recommended")}</h3>
              <ul>{shownRecommended.map(option)}</ul>
            </section>
          )}
          {shownOthers.length > 0 && (
            <section aria-label={t("focus.picker.all")}>
              <h3 className="focus-picker-heading">{t("focus.picker.all")}</h3>
              <ul>{shownOthers.map(option)}</ul>
            </section>
          )}
          {shownRecommended.length === 0 && shownOthers.length === 0 && <p className="focus-picker-empty">{needle ? t("focus.picker.noMatch") : t("focus.picker.empty")}</p>}
        </div>
      </div>
    </Modal>
  );
}
