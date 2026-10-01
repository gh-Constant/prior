import { useMemo, useState } from "react";
import { useI18n } from "../../lib/i18n";
import type { AnalyzedFile } from "../../lib/import/analyze";
import { MAPPING_FIELDS, type ColumnMapping, type MappingField } from "../../lib/import/generic";
import type { AreaChoice, ImportPlan } from "../../lib/import/planImport";
import type { ImportBatch, ImportedTask } from "../../lib/import/types";
import type { Area } from "../../types";
import { CustomSelect } from "../CustomSelect";
import { Icon } from "../Icon";
import { PriorityGlyph } from "../TaskGlyphs";
import { warningText } from "./warnings";

type Props = {
  readonly batch: ImportBatch;
  /** Files whose columns can be remapped (tables); empty when the AI read them. */
  readonly analyzed: readonly AnalyzedFile[];
  readonly onAnalyzed: (items: AnalyzedFile[]) => void;
  readonly selected: ReadonlySet<string>;
  readonly onSelectedChange: (next: ReadonlySet<string>) => void;
  readonly includeCompleted: boolean;
  readonly onIncludeCompletedChange: (value: boolean) => void;
  readonly skipDuplicates: boolean;
  readonly onSkipDuplicatesChange: (value: boolean) => void;
  readonly area: AreaChoice;
  readonly onAreaChange: (value: AreaChoice) => void;
  readonly areas: readonly Area[];
  readonly duplicates: number;
  readonly plan: ImportPlan;
  readonly aiNotice: "plan" | "quota" | "failed" | null;
  readonly aiUsed: boolean;
  /** "Todoist", "Linear"… or "" for other sources; names the default new area. */
  readonly sourceName: string;
  readonly onBack: () => void;
  readonly onImport: () => void;
  readonly onUpgrade?: () => void;
};

type Row = { task: ImportedTask; depth: number };
type Group = { id: string; name: string | null; rows: Row[]; software: boolean };

const ROWS_SHOWN = 150;

/** Tasks grouped by project, each parent followed by its sub-tasks. */
function buildGroups(batch: ImportBatch): Group[] {
  const groups = new Map<string, Group>();
  const order: string[] = [];
  const idOf = (name: string | null) => (name ? `p:${name.trim().toLowerCase()}` : "none");
  const open = (name: string | null) => {
    const id = idOf(name);
    if (!groups.has(id)) {
      const project = name ? batch.projects.find((candidate) => candidate.name.trim().toLowerCase() === name.trim().toLowerCase()) : undefined;
      groups.set(id, { id, name, rows: [], software: project?.projectType === "software" });
      order.push(id);
    }
    return groups.get(id) as Group;
  };
  for (const project of batch.projects) open(project.name);
  const children = new Map<string, ImportedTask[]>();
  const byKey = new Map(batch.tasks.map((task) => [task.key, task]));
  for (const task of batch.tasks) {
    if (task.parentKey && byKey.has(task.parentKey)) children.set(task.parentKey, [...(children.get(task.parentKey) ?? []), task]);
  }
  const place = (task: ImportedTask, depth: number, seen: Set<string>) => {
    if (seen.has(task.key)) return;
    seen.add(task.key);
    open(task.projectName).rows.push({ task, depth });
    for (const child of children.get(task.key) ?? []) place(child, depth + 1, seen);
  };
  const seen = new Set<string>();
  for (const task of batch.tasks) {
    if (!task.parentKey || !byKey.has(task.parentKey)) place(task, 0, seen);
  }
  // Anything left is part of a parent cycle: show it at the top level.
  for (const task of batch.tasks) place(task, 0, seen);
  return order.map((id) => groups.get(id) as Group).filter((group) => group.rows.length > 0);
}

function shortDate(iso: string, lang: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString(lang, { day: "numeric", month: "short" });
}

export function PreviewStep(props: Props) {
  const { batch, selected, onSelectedChange, plan } = props;
  const { t, tp, lang } = useI18n();
  const groups = useMemo(() => buildGroups(batch), [batch]);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set(groups.length > 6 ? groups.map((group) => group.id) : []));
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const finished = batch.tasks.filter((task) => task.state !== "open").length;
  const tables = props.analyzed.filter((item) => item.mapping && item.table);

  function toggleTask(key: string) {
    const next = new Set(selected);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    onSelectedChange(next);
  }

  function setGroup(group: Group, on: boolean) {
    const next = new Set(selected);
    for (const row of group.rows) {
      if (on) next.add(row.task.key);
      else next.delete(row.task.key);
    }
    onSelectedChange(next);
  }

  const allOn = batch.tasks.length > 0 && batch.tasks.every((task) => selected.has(task.key));
  const toggleSet = (set: ReadonlySet<string>, id: string): ReadonlySet<string> => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  };

  const areaOptions = [
    ...(batch.projects.some((project) => project.areaName) ? [{ value: "source", label: t("import.preview.areaSource") }] : []),
    { value: "none", label: t("import.preview.areaNone") },
    ...props.areas.map((area) => ({ value: `existing:${area.name}`, label: area.name })),
    { value: "new", label: t("import.preview.areaNew") },
  ];
  const areaValue = props.area.mode === "existing" ? `existing:${props.area.name}` : props.area.mode;

  function changeArea(value: string) {
    if (value.startsWith("existing:")) props.onAreaChange({ mode: "existing", name: value.slice("existing:".length) });
    else if (value === "new") props.onAreaChange({ mode: "new", name: props.sourceName || t("import.preview.areaDefaultName") });
    else props.onAreaChange({ mode: value === "source" ? "source" : "none" });
  }

  function setMapping(index: number, field: MappingField, column: number) {
    const items = props.analyzed.map((item, position) => (position === index && item.mapping ? { ...item, mapping: { ...item.mapping, [field]: column } as ColumnMapping } : item));
    props.onAnalyzed([...items]);
  }

  return (
    <section className="imp-card" aria-labelledby="imp-preview-title">
      <h3 id="imp-preview-title" className="imp-card-title">
        {t("import.preview.summary", { tasks: tp("import.preview.tasks", batch.tasks.length), projects: tp("import.preview.projects", groups.filter((group) => group.name).length) })}
      </h3>

      {props.aiUsed && <p className="imp-banner is-ai"><Icon name="sparkles" />{t("import.preview.aiDone")}</p>}
      {props.aiNotice && (
        <p className="imp-banner is-warn" role="status">
          {props.aiNotice === "plan" ? t("import.preview.aiPlan") : props.aiNotice === "quota" ? t("import.preview.aiQuota") : t("import.preview.aiFailed")}
          {props.aiNotice === "plan" && props.onUpgrade && <button type="button" className="imp-link" onClick={props.onUpgrade}>{t("import.ai.upgrade")}</button>}
        </p>
      )}
      {batch.warnings.length > 0 && (
        <div className="imp-banner is-warn" role="status">
          <strong>{t("import.preview.warnings")}</strong>
          <ul className="imp-notes">{batch.warnings.map((warning, index) => <li key={index}>{warningText(warning, t)}</li>)}</ul>
        </div>
      )}

      {tables.length > 0 && (
        <details className="imp-mapping" open={tables.some((item) => item.unrecognised)}>
          <summary>{t("import.preview.mapping")}</summary>
          <p className="imp-hint">{t("import.preview.mappingHint")}</p>
          {props.analyzed.map((item, index) => item.mapping && item.table ? (
            <div key={`${item.file.name}-${index}`} className="imp-mapping-file">
              {tables.length > 1 && <strong>{item.file.name || t("import.pasted")}</strong>}
              <div className="imp-mapping-grid">
                {MAPPING_FIELDS.map((field) => {
                  const headers = (item.table as { headers: string[] }).headers;
                  return (
                    <label key={field} className="imp-mapping-field">
                      <span>{t(`import.preview.fields.${field}`)}</span>
                      <CustomSelect
                        value={item.mapping ? item.mapping[field] : -1}
                        ariaLabel={t(`import.preview.fields.${field}`)}
                        onChange={(value) => setMapping(index, field, Number(value))}
                        options={[{ value: -1, label: t("import.preview.fieldNone") }, ...headers.map((header, position) => ({ value: position, label: header || `#${position + 1}` }))]}
                        className="settings-select"
                      />
                    </label>
                  );
                })}
              </div>
            </div>
          ) : null)}
        </details>
      )}

      <div className="imp-options">
        {finished > 0 && (
          <label className="imp-option">
            <span><strong>{t("import.preview.includeCompleted")}</strong><span className="imp-hint">{t("import.preview.includeCompletedHint", { count: finished })}</span></span>
            <button type="button" role="switch" className="settings-switch" aria-checked={props.includeCompleted} aria-label={t("import.preview.includeCompleted")} onClick={() => props.onIncludeCompletedChange(!props.includeCompleted)} />
          </label>
        )}
        <label className="imp-option">
          <span><strong>{t("import.preview.skipDuplicates")}</strong><span className="imp-hint">{props.duplicates > 0 ? tp("import.preview.duplicatesFound", props.duplicates) : t("import.preview.skipDuplicatesHint")}</span></span>
          <button type="button" role="switch" className="settings-switch" aria-checked={props.skipDuplicates} aria-label={t("import.preview.skipDuplicates")} onClick={() => props.onSkipDuplicatesChange(!props.skipDuplicates)} />
        </label>
        <div className="imp-option">
          <span><strong id="imp-area-label">{t("import.preview.area")}</strong><span className="imp-hint">{t("import.preview.areaHint")}</span></span>
          <div className="imp-area-controls">
            <CustomSelect value={areaValue} options={areaOptions} onChange={(value) => changeArea(String(value))} ariaLabel={t("import.preview.area")} className="settings-select" />
            {props.area.mode === "new" && (
              <input className="imp-input" value={props.area.name} aria-label={t("import.preview.areaName")} onChange={(event) => props.onAreaChange({ mode: "new", name: event.target.value })} maxLength={60} />
            )}
          </div>
        </div>
      </div>

      <div className="imp-listbar">
        <span className="imp-hint">{tp("import.preview.selected", selected.size, { total: batch.tasks.length })}</span>
        <button type="button" className="imp-link" onClick={() => onSelectedChange(allOn ? new Set() : new Set(batch.tasks.map((task) => task.key)))}>{allOn ? t("import.preview.selectNone") : t("import.preview.selectAll")}</button>
      </div>

      <div className="imp-groups">
        {groups.map((group) => {
          const on = group.rows.filter((row) => selected.has(row.task.key)).length;
          const open = !collapsed.has(group.id);
          const shown = expanded.has(group.id) ? group.rows : group.rows.slice(0, ROWS_SHOWN);
          return (
            <div key={group.id} className="imp-group">
              <div className="imp-group-head">
                <input
                  type="checkbox"
                  checked={on === group.rows.length}
                  ref={(node) => { if (node) node.indeterminate = on > 0 && on < group.rows.length; }}
                  onChange={(event) => setGroup(group, event.target.checked)}
                  aria-label={t("import.preview.toggleGroup", { name: group.name ?? t("import.preview.noProject") })}
                />
                <button type="button" className="imp-group-toggle" aria-expanded={open} onClick={() => setCollapsed(toggleSet(collapsed, group.id))}>
                  <Icon name={open ? "chevron-down" : "chevron-right"} />
                  <Icon name={group.name ? "folder" : "inbox"} />
                  <span className="imp-group-name">{group.name ?? t("import.preview.noProject")}</span>
                  {group.software && <span className="imp-tag">{t("import.preview.software")}</span>}
                  <span className="imp-count">{on}/{group.rows.length}</span>
                </button>
              </div>
              {open && (
                <ul className="imp-tasks">
                  {shown.map(({ task, depth }) => (
                    <li key={task.key} className={`imp-task ${selected.has(task.key) ? "" : "is-off"}`} style={{ paddingInlineStart: `${10 + depth * 20}px` }}>
                      <input type="checkbox" checked={selected.has(task.key)} onChange={() => toggleTask(task.key)} aria-label={task.title} />
                      <span className="imp-task-title">{task.title}</span>
                      <span className="imp-task-meta">
                        {task.state === "completed" && <span className="imp-tag is-done">{t("import.preview.completed")}</span>}
                        {task.state === "canceled" && <span className="imp-tag is-canceled">{t("import.preview.canceled")}</span>}
                        {task.recurrence && <span className="imp-tag">{t("import.preview.repeats")}</span>}
                        {task.dueDate && <span className="imp-due">{shortDate(task.dueDate, lang)}</span>}
                        {task.priority < 4 && <PriorityGlyph priority={task.priority} label={t("import.preview.priority", { level: task.priority })} />}
                      </span>
                    </li>
                  ))}
                  {shown.length < group.rows.length && (
                    <li className="imp-more"><button type="button" className="imp-link" onClick={() => setExpanded(toggleSet(expanded, group.id))}>{t("import.preview.showMore", { count: group.rows.length - shown.length })}</button></li>
                  )}
                </ul>
              )}
            </div>
          );
        })}
      </div>

      <div className="imp-actions is-sticky">
        <button type="button" className="secondary-button" onClick={props.onBack}>{t("import.actions.back")}</button>
        <button type="button" className="primary-button" disabled={plan.tasks.length === 0} onClick={props.onImport}>{tp("import.preview.importButton", plan.tasks.length)}</button>
      </div>
      {plan.tasks.length === 0 && <p className="imp-hint imp-empty">{t("import.preview.nothingSelected")}</p>}
    </section>
  );
}
