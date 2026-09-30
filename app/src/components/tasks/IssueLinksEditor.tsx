import { useState } from "react";
import type { ProjectMilestone, Task } from "../../types";
import { useI18n } from "../../lib/i18n";
import { CustomSelect } from "../CustomSelect";
import { Icon } from "../Icon";
import "./IssueLinksEditor.css";

type Props = {
  /** The task being edited (absent while creating one). */
  readonly task?: Task;
  readonly projectId: string | null;
  readonly tasks: readonly Task[];
  readonly milestones: readonly ProjectMilestone[];
  readonly parentId: string | null;
  readonly milestoneId: string | null;
  readonly blockedBy: readonly string[];
  readonly disabled?: boolean;
  readonly onParentChange: (parentId: string | null) => void;
  readonly onMilestoneChange: (milestoneId: string | null) => void;
  readonly onBlockedByChange: (taskIds: string[]) => void;
  /** Creates a sub-task of the edited task. */
  readonly onCreateSubtask?: (title: string) => Promise<void>;
  readonly onOpenTask?: (task: Task) => void;
};

/** Ids of the task and everything below it (a parent cannot be one of them). */
export function descendantIds(taskId: string, tasks: readonly Task[]): Set<string> {
  const ids = new Set([taskId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const task of tasks) {
      if (task.parentId && ids.has(task.parentId) && !ids.has(task.id)) {
        ids.add(task.id);
        grew = true;
      }
    }
  }
  return ids;
}

/**
 * Linear-style links of a task inside its project: its parent (sub-issue),
 * the tasks it waits on ("blocked by"), its milestone, and its sub-tasks.
 */
export function IssueLinksEditor({ task, projectId, tasks, milestones, parentId, milestoneId, blockedBy, disabled = false, onParentChange, onMilestoneChange, onBlockedByChange, onCreateSubtask, onOpenTask }: Props) {
  const { t } = useI18n();
  const [subtaskTitle, setSubtaskTitle] = useState("");
  const [creating, setCreating] = useState(false);
  const sameProject = tasks.filter((candidate) => !candidate.deletedAt && (candidate.projectId ?? null) === projectId && candidate.id !== task?.id);
  const excluded = task ? descendantIds(task.id, tasks) : new Set<string>();
  const parentOptions = sameProject.filter((candidate) => !excluded.has(candidate.id) && !candidate.completed);
  const blockerOptions = sameProject.filter((candidate) => !blockedBy.includes(candidate.id));
  const children = task ? tasks.filter((candidate) => !candidate.deletedAt && candidate.parentId === task.id) : [];
  const doneChildren = children.filter((child) => child.completed).length;
  const titleOf = (id: string) => tasks.find((candidate) => candidate.id === id)?.title ?? t("tasks.links.missingTask");

  async function createSubtask() {
    const title = subtaskTitle.trim();
    if (!title || !onCreateSubtask || creating) return;
    setCreating(true);
    try {
      await onCreateSubtask(title);
      setSubtaskTitle("");
    } finally {
      setCreating(false);
    }
  }

  return <div className="issue-links">
    <p className="task-composer-section-heading">{t("tasks.links.title")}</p>
    <div className="task-composer-details-row">
      <div className="task-composer-input-field">
        <span>{t("tasks.links.parent")}</span>
        <CustomSelect
          ariaLabel={t("tasks.links.parent")}
          disabled={disabled}
          value={parentId ?? ""}
          onChange={(value) => onParentChange(value ? String(value) : null)}
          options={[
            { value: "", label: t("tasks.links.noParent") },
            ...(parentId && !parentOptions.some((option) => option.id === parentId) ? [{ value: parentId, label: titleOf(parentId) }] : []),
            ...parentOptions.map((option) => ({ value: option.id, label: option.title })),
          ]}
        />
      </div>
      {milestones.length > 0 && <div className="task-composer-input-field">
        <span>{t("tasks.links.milestone")}</span>
        <CustomSelect
          ariaLabel={t("tasks.links.milestone")}
          disabled={disabled}
          value={milestoneId ?? ""}
          onChange={(value) => onMilestoneChange(value ? String(value) : null)}
          options={[
            { value: "", label: t("tasks.links.noMilestone") },
            ...milestones.map((milestone) => ({ value: milestone.id, label: milestone.name, icon: "flag" as const })),
          ]}
        />
      </div>}
    </div>
    <div className="task-composer-input-field task-composer-field-full">
      <span>{t("tasks.links.blockedBy")}</span>
      <div className="issue-links-blockers">
        {blockedBy.map((id) => {
          const blocker = tasks.find((candidate) => candidate.id === id);
          return <span key={id} className={`collab-chip issue-links-blocker ${blocker?.completed ? "is-done" : ""}`}>
            <Icon name={blocker?.completed ? "check-circle" : "lock"} />
            {blocker && onOpenTask ? <button type="button" className="issue-links-open" onClick={() => onOpenTask(blocker)}>{blocker.title}</button> : <span>{titleOf(id)}</span>}
            <button type="button" className="issue-links-remove" disabled={disabled} aria-label={t("tasks.links.removeBlocker", { title: titleOf(id) })} onClick={() => onBlockedByChange(blockedBy.filter((value) => value !== id))}><Icon name="close" /></button>
          </span>;
        })}
        {blockerOptions.length > 0 && <CustomSelect
          ariaLabel={t("tasks.links.addBlocker")}
          className="issue-links-add"
          disabled={disabled}
          value=""
          placeholder={t("tasks.links.addBlocker")}
          onChange={(value) => { if (value) onBlockedByChange([...blockedBy, String(value)]); }}
          options={[{ value: "", label: t("tasks.links.addBlocker"), icon: "plus" as const }, ...blockerOptions.map((option) => ({ value: option.id, label: option.title }))]}
        />}
        {!blockedBy.length && !blockerOptions.length && <span className="collab-muted">{t("tasks.links.noCandidates")}</span>}
      </div>
    </div>
    {task && <div className="task-composer-input-field task-composer-field-full">
      <span>{t("tasks.links.subtasks")}{children.length > 0 && <span className="collab-muted"> · {doneChildren}/{children.length}</span>}</span>
      {children.length > 0 && <ul className="issue-links-children">
        {children.map((child) => <li key={child.id}>
          <Icon name={child.completed ? "check-circle" : "later"} />
          {onOpenTask ? <button type="button" className="issue-links-open" onClick={() => onOpenTask(child)}>{child.title}</button> : <span>{child.title}</span>}
        </li>)}
      </ul>}
      {onCreateSubtask && <div className="issue-links-new">
        <input
          value={subtaskTitle}
          disabled={disabled || creating}
          placeholder={t("tasks.links.newSubtask")}
          aria-label={t("tasks.links.newSubtask")}
          onChange={(event) => setSubtaskTitle(event.target.value)}
          onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); event.stopPropagation(); void createSubtask(); } }}
        />
        <button type="button" className="secondary-button" disabled={disabled || creating || !subtaskTitle.trim()} onClick={() => void createSubtask()}><Icon name="plus" />{t("tasks.links.addSubtask")}</button>
      </div>}
    </div>}
  </div>;
}
