import { useEffect, useRef, useState, type ReactNode } from "react";
import type {
  ProposedArea,
  ProposedEntityUpdate,
  ProposedFolder,
  ProposedHabit,
  ProposedNote,
  ProposedProject,
  ProposedTask,
  ProposedTaskUpdate,
  QuadrantKey,
  TaskPriority,
  TaskStatus,
} from "../../types";
import { habitScheduleLabel } from "../../lib/habits";
import { useI18n } from "../../lib/i18n";
import { describeRecurrence } from "../../lib/recurrence";
import { Icon, type IconName } from "../Icon";
import { PriorityGlyph, formatShortDate, localDateKey, daysBetween } from "../ProjectVisuals";
import { CalendarGlyph, StatusGlyph } from "../TaskGlyphs";
import { formatReminder } from "../tasks/ReminderPicker";
import type { AssistantMessageHandlers } from "./handlers";
import { entityDiffRows, getQuadrantBadge, taskDiffRows, type DiffRow, type DiffValue, type ProposalContext } from "./reviewModel";
import "./review.css";

type Translate = (key: string, vars?: Record<string, string | number>) => string;

/* ── Shared shell ──────────────────────────────────────────────────────── */

/** True for a moment after `added` flips on: drives the one-shot success animation. */
function useJustApplied(added: boolean): boolean {
  const previous = useRef(added);
  const [just, setJust] = useState(false);
  useEffect(() => {
    if (!previous.current && added) {
      setJust(true);
      const timer = window.setTimeout(() => setJust(false), 1400);
      previous.current = added;
      return () => window.clearTimeout(timer);
    }
    previous.current = added;
    return undefined;
  }, [added]);
  return just;
}

type ShellProps = {
  readonly kind: string;
  readonly added: boolean;
  readonly selected: boolean;
  readonly adding: boolean;
  readonly lead: ReactNode;
  readonly title: ReactNode;
  readonly titleText: string;
  readonly onToggle: (() => void) | undefined;
  readonly onApply: (() => void) | undefined;
  readonly applyTitle: string;
  readonly applyIcon?: IconName;
  readonly addedLabel: string;
  readonly actions?: ReactNode;
  readonly children?: ReactNode;
};

function ReviewCard({ kind, added, selected, adding, lead, title, titleText, onToggle, onApply, applyTitle, applyIcon = "plus", addedLabel, actions, children }: ShellProps) {
  const { t } = useI18n();
  const just = useJustApplied(added);
  return (
    <article className={`review-card review-kind-${kind}${added ? " is-added" : ""}${just ? " just-applied" : ""}${!selected && !added ? " is-off" : ""}`} data-added={added || undefined}>
      <div className="review-card-head">
        <label className="review-check">
          <input type="checkbox" checked={selected || added} disabled={added || !onToggle} onChange={() => onToggle?.()} aria-label={t("agentui.review.include", { title: titleText })} />
          <span className="review-check-box"><Icon name="check" /></span>
        </label>
        <div className="review-card-titles">
          {lead}
          <span className="review-title">{title}</span>
        </div>
        <div className="review-card-actions">
          {added ? (
            <span className="review-added"><Icon name="check" /> {addedLabel}</span>
          ) : (
            <>
              {actions}
              <button type="button" className="review-apply" disabled={adding || !onApply} title={applyTitle} aria-label={applyTitle} onClick={() => onApply?.()}>
                {adding ? <span className="review-spinner" aria-hidden="true" /> : <Icon name={applyIcon} />}
              </button>
            </>
          )}
        </div>
      </div>
      <div className="review-card-more">
        <div className="review-card-more-inner" inert={added || undefined}>{children}</div>
      </div>
    </article>
  );
}

function Reasoning({ text }: { readonly text: string }) {
  return text ? <p className="review-reason">{text}</p> : null;
}

function Chip({ tone, icon, title, children }: { readonly tone?: string; readonly icon?: ReactNode; readonly title?: string; readonly children: ReactNode }) {
  return <span className={`review-chip${tone ? ` tone-${tone}` : ""}`} title={title}>{icon}<span className="review-chip-text">{children}</span></span>;
}

function statusText(t: Translate, status: string | undefined): string | null {
  switch (status) {
    case "inbox": case "backlog": case "next": case "in_progress": case "waiting": case "done": return t(`agent.status.${status}`);
    default: return null;
  }
}

function quadrantText(t: Translate, key: QuadrantKey): string {
  return t(`agent.quadrant.${key}`);
}

function FlagToggles({ important, urgent, disabled, onToggleImportant, onToggleUrgent }: {
  readonly important: boolean | undefined;
  readonly urgent: boolean | undefined;
  readonly disabled: boolean;
  readonly onToggleImportant: () => void;
  readonly onToggleUrgent: () => void;
}) {
  const { t } = useI18n();
  const importantLabel = important ? t("agent.cards.unmarkImportant") : t("agent.cards.markImportant");
  const urgentLabel = urgent ? t("agent.cards.unmarkUrgent") : t("agent.cards.markUrgent");
  return (
    <span className="review-flags">
      <button type="button" className={`review-flag flag-important${important ? " on" : ""}`} aria-label={importantLabel} aria-pressed={important} title={importantLabel} disabled={disabled} onClick={onToggleImportant}><Icon name="star" /></button>
      <button type="button" className={`review-flag flag-urgent${urgent ? " on" : ""}`} aria-label={urgentLabel} aria-pressed={urgent} title={urgentLabel} disabled={disabled} onClick={onToggleUrgent}><Icon name="bolt" /></button>
    </span>
  );
}

function Avatar({ name }: { readonly name: string }) {
  return <span className="review-avatar" aria-hidden="true">{name.trim().slice(0, 1).toUpperCase() || "?"}</span>;
}

function DueChip({ value, lang, label }: { readonly value: string; readonly lang: string; readonly label: string }) {
  const delta = daysBetween(localDateKey(), value.slice(0, 10));
  const tone = delta < 0 ? "late" : delta === 0 ? "today" : undefined;
  return <Chip tone={tone} icon={<CalendarGlyph />} title={label}>{formatShortDate(value, lang)}</Chip>;
}

/* ── Diff ──────────────────────────────────────────────────────────────── */

const DATE_FIELDS = new Set(["due", "scheduled", "followUp", "start", "target", "endDate"]);

function DiffValueView({ value, field }: { readonly value: DiffValue; readonly field: string }) {
  const { t, tp, lang } = useI18n();
  switch (value.kind) {
    case "none":
      return <em className="review-none">{DATE_FIELDS.has(field) ? t("agentui.value.noDate") : t("agentui.value.none")}</em>;
    case "text":
      return <span className="review-text">{value.text}</span>;
    case "date":
      return <span className="review-value"><CalendarGlyph />{formatShortDate(value.value, lang)}</span>;
    case "datetime":
      return <span className="review-value"><Icon name="bell" />{formatReminder(value.value, lang)}</span>;
    case "priority":
      return <span className="review-value"><PriorityGlyph priority={value.value} />P{value.value}</span>;
    case "status":
      return <span className="review-value"><StatusGlyph status={value.value as TaskStatus} />{statusText(t, value.value) ?? value.value}</span>;
    case "flag":
      return <span className="review-value"><Icon name={value.flag === "urgent" ? "bolt" : "star"} />{t(`agentui.value.${value.flag}${value.on ? "On" : "Off"}`)}</span>;
    case "done":
      return <span className="review-value">{value.done ? <Icon name="check-circle" /> : null}{value.done ? t("agentui.value.done") : t("agentui.value.open")}</span>;
    case "person":
      return <span className="review-value"><Avatar name={value.name} />{value.name}</span>;
    case "checklist":
      return <span className="review-text">{tp("agentui.value.items", value.items.length)}</span>;
    case "additions":
      return <ul className="review-adds">{value.items.map((item) => <li key={item}><span aria-hidden="true">+</span>{item}</li>)}</ul>;
    case "note":
      return <span className="review-note"><strong>{t(value.mode === "append" ? "agent.updates.appendNote" : "agent.updates.rewriteNote")}</strong><span className="review-note-text">{value.text.slice(0, 360)}</span></span>;
    case "recurrence":
      return <span className="review-value"><Icon name="repeat" />{describeRecurrence(value.value, t, lang, { dueDate: value.dueDate ?? undefined })}</span>;
    case "i18n":
      return <span className="review-text">{t(value.key, value.params)}</span>;
  }
}

function ChecklistDiff({ row }: { readonly row: DiffRow }) {
  const { t } = useI18n();
  const after = row.after.kind === "checklist" ? row.after.items : [];
  const before = row.before?.kind === "checklist" ? row.before.items : null;
  const added = before ? after.filter((item) => !before.includes(item)) : after;
  const removed = before ? before.filter((item) => !after.includes(item)) : [];
  const kept = before ? after.length - added.length : 0;
  return (
    <ul className="review-checklist-diff">
      {added.map((item) => <li key={`+${item}`} className="is-add"><span aria-hidden="true">+</span>{item}</li>)}
      {removed.map((item) => <li key={`-${item}`} className="is-remove"><span aria-hidden="true">−</span>{item}</li>)}
      {kept > 0 && <li className="is-kept">{t("agentui.value.unchanged", { count: kept })}</li>}
    </ul>
  );
}

function DiffList({ rows }: { readonly rows: readonly DiffRow[] }) {
  const { t } = useI18n();
  if (!rows.length) return null;
  return (
    <div className="review-diff">
      {rows.map((row) => {
        const wide = row.field === "description" || row.field === "checklist" || row.field === "note" || row.field === "milestones";
        return (
          <div key={row.key} className={`review-diff-row field-${row.field}${wide ? " is-wide" : ""}`}>
            <span className="review-diff-label">{t(`agentui.field.${row.field}`)}</span>
            {row.field === "checklist" ? <ChecklistDiff row={row} /> : (
              <div className="review-diff-values">
                {row.before && <span className="review-old"><DiffValueView value={row.before} field={row.field} /></span>}
                {row.before && <Icon name="arrow" className="review-diff-arrow" />}
                <span className="review-new"><DiffValueView value={row.after} field={row.field} /></span>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ── Create: task ──────────────────────────────────────────────────────── */

const PRIORITIES: readonly TaskPriority[] = [1, 2, 3, 4];

function TaskEditor({ messageId, task, onEdit }: { readonly messageId: string; readonly task: ProposedTask; readonly onEdit: NonNullable<AssistantMessageHandlers["onEditTask"]> }) {
  const { t } = useI18n();
  const [title, setTitle] = useState(task.title);
  return (
    <div className="review-edit">
      <label className="review-field review-field-title">
        <span>{t("agentui.field.title")}</span>
        <input
          type="text"
          value={title}
          maxLength={200}
          onChange={(event) => {
            setTitle(event.target.value);
            if (event.target.value.trim()) onEdit(messageId, task.id, { title: event.target.value });
          }}
          onBlur={() => { if (!title.trim()) setTitle(task.title); }}
        />
      </label>
      <div className="review-edit-row">
        <label className="review-field">
          <span>{t("agentui.field.due")}</span>
          <input type="date" value={task.dueDate?.slice(0, 10) ?? ""} onChange={(event) => onEdit(messageId, task.id, { dueDate: event.target.value || null })} />
        </label>
        <div className="review-field">
          <span>{t("agentui.field.priority")}</span>
          <div className="review-seg" role="group" aria-label={t("agentui.field.priority")}>
            {PRIORITIES.map((value) => (
              <button key={value} type="button" className={`review-seg-btn priority-${value}`} aria-pressed={task.priority === value} onClick={() => onEdit(messageId, task.id, { priority: value })}>P{value}</button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export function TaskCreateCard({ messageId, task, handlers }: { readonly messageId: string; readonly task: ProposedTask; readonly handlers: AssistantMessageHandlers }) {
  const { t, lang } = useI18n();
  const [editing, setEditing] = useState(false);
  const badge = getQuadrantBadge(task);
  const priority = task.priority ?? 4;
  const taskStatus = statusText(t, task.status);
  const canEdit = Boolean(handlers.onEditTask) && !task.added;
  const checklist = task.checklist ?? [];
  return (
    <ReviewCard
      kind="task"
      added={Boolean(task.added)}
      selected={task.selected}
      adding={handlers.addingIds[task.id] ?? false}
      lead={null}
      title={task.title}
      titleText={task.title}
      onToggle={() => handlers.onToggleTaskSelect(messageId, task.id)}
      onApply={() => void handlers.onAddSingleTask(messageId, task)}
      applyTitle={t("agent.cards.addTask")}
      addedLabel={t("agent.cards.added")}
      actions={canEdit ? (
        <button type="button" className={`review-edit-btn${editing ? " on" : ""}`} aria-pressed={editing} title={t("agentui.review.edit")} aria-label={t("agentui.review.edit")} onClick={() => setEditing((value) => !value)}>
          <Icon name={editing ? "check" : "pencil"} />
        </button>
      ) : undefined}
    >
      {editing && handlers.onEditTask && <TaskEditor messageId={messageId} task={task} onEdit={handlers.onEditTask} />}
      {task.description && <p className="review-desc">{task.description}</p>}
      {checklist.length > 0 && (
        <ul className="review-checklist" aria-label={t("checklist.title")}>
          {checklist.slice(0, 4).map((item, index) => <li key={`${index}-${item}`}><span className="review-checklist-dot" aria-hidden="true" />{item}</li>)}
          {checklist.length > 4 && <li className="review-checklist-more">{t("agentui.value.moreItems", { count: checklist.length - 4 })}</li>}
        </ul>
      )}
      <div className="review-meta">
        <Chip tone={`p${priority}`} icon={<PriorityGlyph priority={priority} />}>P{priority}</Chip>
        {taskStatus && <Chip icon={<StatusGlyph status={task.status as TaskStatus} />}>{taskStatus}</Chip>}
        {task.projectName && <Chip icon={<Icon name="folder" />}>{task.projectName}</Chip>}
        {task.areaName && !task.projectName && <Chip icon={<Icon name="briefcase" />}>{task.areaName}</Chip>}
        {task.dueDate && <DueChip value={task.dueDate} lang={lang} label={t("agent.cards.due", { date: formatShortDate(task.dueDate, lang) })} />}
        {task.scheduledDate && <Chip icon={<Icon name="calendar-check" />}>{t("agent.cards.scheduled", { date: formatShortDate(task.scheduledDate, lang) })}</Chip>}
        {task.assigneeName && <Chip icon={<Icon name="hourglass" />}>{t("agent.cards.waitingOn", { name: task.assigneeName })}</Chip>}
        {task.assigneeLabel && <Chip icon={<Avatar name={task.assigneeLabel} />}>{task.assigneeLabel}</Chip>}
        {task.milestoneLabel && <Chip icon={<Icon name="flag" />}>{task.milestoneLabel}</Chip>}
        {(task.parentId || task.parentTitle) && <Chip icon={<Icon name="list-todo" />}>{t("agent.cards.subtaskOf", { title: task.parentTitle ?? t("agent.cards.existingTask") })}</Chip>}
        {task.blockedByTaskIds?.length ? <Chip icon={<Icon name="lock" />}>{t("agent.cards.blockedBy", { count: task.blockedByTaskIds.length })}</Chip> : null}
        {task.followUpDate && <Chip icon={<Icon name="refresh" />}>{t("agent.cards.followUp", { date: formatShortDate(task.followUpDate, lang) })}</Chip>}
        {task.recurrence && <Chip icon={<Icon name="repeat" />}>{describeRecurrence(task.recurrence, t, lang, { dueDate: task.dueDate })}</Chip>}
        {task.reminderAt && <Chip icon={<Icon name="bell" />}>{t("reminders.picker.set", { when: formatReminder(task.reminderAt, lang) })}</Chip>}
        <Chip tone={`q-${badge.key}`}>{quadrantText(t, badge.key)}</Chip>
        <FlagToggles
          important={task.important}
          urgent={task.urgent}
          disabled={Boolean(task.added)}
          onToggleImportant={() => handlers.onToggleTaskImportant(messageId, task.id)}
          onToggleUrgent={() => handlers.onToggleTaskUrgent(messageId, task.id)}
        />
      </div>
      <Reasoning text={task.reasoning} />
    </ReviewCard>
  );
}

/* ── Update: task / project / habit / note / area ──────────────────────── */

export function TaskUpdateCard({ messageId, update, handlers, context }: { readonly messageId: string; readonly update: ProposedTaskUpdate; readonly handlers: AssistantMessageHandlers; readonly context: ProposalContext }) {
  const { t } = useI18n();
  const rows = taskDiffRows(update, context);
  return (
    <ReviewCard
      kind="update"
      added={Boolean(update.added)}
      selected={update.selected}
      adding={handlers.addingIds[update.id] ?? false}
      lead={<span className="review-tile tone-update"><Icon name="pencil" /></span>}
      title={update.taskTitle}
      titleText={update.taskTitle}
      onToggle={handlers.onUpdateTaskUpdate ? () => handlers.onUpdateTaskUpdate?.(messageId, update.id, { selected: !update.selected }) : undefined}
      onApply={handlers.onApplyTaskUpdate ? () => void handlers.onApplyTaskUpdate?.(messageId, update) : undefined}
      applyTitle={t("agent.updates.applyOne")}
      applyIcon="check"
      addedLabel={t("agent.updates.applied")}
    >
      <DiffList rows={rows} />
      <Reasoning text={update.reasoning} />
    </ReviewCard>
  );
}

const ENTITY_ICONS: Record<ProposedEntityUpdate["kind"], IconName> = { project: "folder", habit: "refresh", note: "file-text", area: "briefcase" };

export function EntityUpdateCard({ messageId, update, handlers, context }: { readonly messageId: string; readonly update: ProposedEntityUpdate; readonly handlers: AssistantMessageHandlers; readonly context: ProposalContext }) {
  const { t } = useI18n();
  const rows = entityDiffRows(update, context);
  return (
    <ReviewCard
      kind="update"
      added={Boolean(update.added)}
      selected={update.selected}
      adding={handlers.addingIds[update.id] ?? false}
      lead={<span className={`review-tile tone-${update.kind}`}><Icon name={ENTITY_ICONS[update.kind]} /></span>}
      title={update.targetTitle}
      titleText={update.targetTitle}
      onToggle={handlers.onUpdateEntityUpdate ? () => handlers.onUpdateEntityUpdate?.(messageId, update.id, { selected: !update.selected }) : undefined}
      onApply={handlers.onApplyEntityUpdate ? () => void handlers.onApplyEntityUpdate?.(messageId, update) : undefined}
      applyTitle={t("agent.updates.applyOne")}
      applyIcon="check"
      addedLabel={t("agent.updates.applied")}
    >
      <DiffList rows={rows} />
      <Reasoning text={update.reasoning} />
    </ReviewCard>
  );
}

/* ── Create: area / project / habit / note / folder ────────────────────── */

export function AreaCard({ messageId, area, handlers }: { readonly messageId: string; readonly area: ProposedArea; readonly handlers: AssistantMessageHandlers }) {
  const { t } = useI18n();
  return (
    <ReviewCard
      kind="area"
      added={Boolean(area.added)}
      selected={area.selected}
      adding={handlers.addingIds[area.id] ?? false}
      lead={<span className="review-tile tone-area"><Icon name="briefcase" /></span>}
      title={area.name}
      titleText={area.name}
      onToggle={handlers.onUpdateArea ? () => handlers.onUpdateArea?.(messageId, area.id, { selected: !area.selected }) : undefined}
      onApply={handlers.onAddSingleArea ? () => void handlers.onAddSingleArea?.(messageId, area) : undefined}
      applyTitle={t("agent.cards.addArea")}
      addedLabel={t("agent.cards.added")}
    >
      <div className="review-meta"><Chip icon={<Icon name="briefcase" />}>{t("agent.cards.areaKind")}</Chip></div>
      <Reasoning text={area.reasoning} />
    </ReviewCard>
  );
}

export function ProjectCard({ messageId, project, handlers }: { readonly messageId: string; readonly project: ProposedProject; readonly handlers: AssistantMessageHandlers }) {
  const { t, lang } = useI18n();
  return (
    <ReviewCard
      kind="project"
      added={Boolean(project.added)}
      selected={project.selected}
      adding={handlers.addingIds[project.id] ?? false}
      lead={<span className="review-tile tone-project"><Icon name="folder" /></span>}
      title={project.name}
      titleText={project.name}
      onToggle={handlers.onUpdateProject ? () => handlers.onUpdateProject?.(messageId, project.id, { selected: !project.selected }) : undefined}
      onApply={handlers.onAddSingleProject ? () => void handlers.onAddSingleProject?.(messageId, project) : undefined}
      applyTitle={t("agent.cards.addProject")}
      addedLabel={t("agent.cards.added")}
    >
      {project.description && <p className="review-desc">{project.description}</p>}
      <div className="review-meta">
        {project.areaName && <Chip icon={<Icon name="briefcase" />}>{t("agent.cards.areaBadge", { name: project.areaName })}</Chip>}
        {project.status && <Chip>{t(`collab.editor.status${project.status[0].toUpperCase()}${project.status.slice(1)}`)}</Chip>}
        {project.projectType === "software" && <Chip icon={<Icon name="terminal" />}>{t("common.workhub.typeSoftware")}</Chip>}
        {project.targetDate && <Chip icon={<CalendarGlyph />}>{t("agent.updates.targetOn", { date: formatShortDate(project.targetDate, lang) })}</Chip>}
      </div>
      <Reasoning text={project.reasoning} />
    </ReviewCard>
  );
}

export function HabitCard({ messageId, habit, handlers }: { readonly messageId: string; readonly habit: ProposedHabit; readonly handlers: AssistantMessageHandlers }) {
  const { t, lang } = useI18n();
  const badge = getQuadrantBadge(habit);
  return (
    <ReviewCard
      kind="habit"
      added={Boolean(habit.added)}
      selected={habit.selected}
      adding={handlers.addingIds[habit.id] ?? false}
      lead={<span className="review-tile tone-habit"><Icon name="refresh" /></span>}
      title={habit.title}
      titleText={habit.title}
      onToggle={() => handlers.onUpdateHabit(messageId, habit.id, { selected: !habit.selected })}
      onApply={() => void handlers.onAddSingleHabit(messageId, habit)}
      applyTitle={t("agent.cards.addHabit")}
      addedLabel={t("agent.cards.added")}
    >
      <div className="review-meta">
        <Chip icon={<Icon name="refresh" />}>{habitScheduleLabel(habit)}</Chip>
        {habit.endDate && <Chip icon={<CalendarGlyph />}>{t("agent.cards.endsOn", { date: formatShortDate(habit.endDate, lang) })}</Chip>}
        <Chip tone={`q-${badge.key}`}>{quadrantText(t, badge.key)}</Chip>
        <FlagToggles
          important={habit.important}
          urgent={habit.urgent}
          disabled={Boolean(habit.added)}
          onToggleImportant={() => handlers.onUpdateHabit(messageId, habit.id, { important: !habit.important })}
          onToggleUrgent={() => handlers.onUpdateHabit(messageId, habit.id, { urgent: !habit.urgent })}
        />
      </div>
      <Reasoning text={habit.reasoning} />
    </ReviewCard>
  );
}

function detectNoteFeatures(body: string): string[] {
  const features: string[] = [];
  if (/(^|\n)\s*[-*+]\s+\[[ xX]\]/.test(body)) features.push("taskList");
  if (/(^|\n)\s*\|[^|\n]+\|/.test(body)) features.push("table");
  if (/\$\$[^$]+\$\$|\$[^$\n]+\$/.test(body)) features.push("math");
  if (/\[\[[^\]]+\]\]/.test(body)) features.push("links");
  if (/(^|\s)#[A-Za-z][\w-]*/.test(body)) features.push("tags");
  if (/^> \[!(note|tip|warning|info)\]/im.test(body)) features.push("callout");
  if (/^```/m.test(body)) features.push("code");
  return features.slice(0, 4);
}

export function NoteCard({ messageId, note, handlers }: { readonly messageId: string; readonly note: ProposedNote; readonly handlers: AssistantMessageHandlers }) {
  const { t, tp } = useI18n();
  const features = detectNoteFeatures(note.bodyMarkdown);
  const preview = note.bodyMarkdown.length > 420 ? `${note.bodyMarkdown.slice(0, 417).trimEnd()}…` : note.bodyMarkdown;
  const wordCount = note.bodyMarkdown.trim() ? note.bodyMarkdown.trim().split(/\s+/).length : 0;
  const favoriteLabel = note.favorite ? t("agent.cards.unmarkFavorite") : t("agent.cards.markFavorite");
  return (
    <ReviewCard
      kind="note"
      added={Boolean(note.added)}
      selected={note.selected}
      adding={handlers.addingIds[note.id] ?? false}
      lead={<span className="review-tile tone-note"><Icon name="file-text" /></span>}
      title={note.title}
      titleText={note.title}
      onToggle={() => handlers.onUpdateNote(messageId, note.id, { selected: !note.selected })}
      onApply={() => void handlers.onAddSingleNote(messageId, note)}
      applyTitle={t("agent.cards.addNote")}
      addedLabel={t("agent.cards.added")}
    >
      <div className="review-meta">
        <Chip icon={<Icon name="folder" />}>{note.folderName ?? t("agent.cards.folderLibrary")}</Chip>
        {note.projectName && <Chip>{t("agent.cards.projectFor", { name: note.projectName })}</Chip>}
        <Chip>{tp("agent.cards.words", wordCount)}</Chip>
        {features.map((feature) => <Chip key={feature} tone="q-plan">{t(`agent.features.${feature}`)}</Chip>)}
        {!note.added && (
          <button type="button" className={`review-flag flag-important${note.favorite ? " on" : ""}`} aria-label={favoriteLabel} aria-pressed={note.favorite} title={favoriteLabel} onClick={() => handlers.onUpdateNote(messageId, note.id, { favorite: !note.favorite })}><Icon name="star" /></button>
        )}
      </div>
      {preview && <pre className="review-note-preview">{preview}</pre>}
      <Reasoning text={note.reasoning} />
    </ReviewCard>
  );
}

export function FolderCard({ messageId, folder, handlers }: { readonly messageId: string; readonly folder: ProposedFolder; readonly handlers: AssistantMessageHandlers }) {
  const { t } = useI18n();
  return (
    <ReviewCard
      kind="folder"
      added={Boolean(folder.added)}
      selected={folder.selected}
      adding={handlers.addingIds[folder.id] ?? false}
      lead={<span className="review-tile tone-folder"><Icon name="folder-plus" /></span>}
      title={folder.name}
      titleText={folder.name}
      onToggle={() => handlers.onUpdateFolder(messageId, folder.id, { selected: !folder.selected })}
      onApply={() => void handlers.onAddSingleFolder(messageId, folder)}
      applyTitle={t("agent.cards.addFolder")}
      addedLabel={t("agent.cards.added")}
    >
      <div className="review-meta"><Chip icon={<Icon name="folder" />}>{folder.parentName ? t("agent.cards.insideFolder", { name: folder.parentName }) : t("agent.cards.topLevel")}</Chip></div>
      <Reasoning text={folder.reasoning} />
    </ReviewCard>
  );
}
