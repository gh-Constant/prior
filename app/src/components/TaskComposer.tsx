import { useEffect, useRef, useState } from "react";
import type { Area, Project, Task, TaskDraft, TaskPriority, TaskStatus } from "../types";
import { useModalDialog } from "../hooks/useModalDialog";
import { useI18n } from "../lib/i18n";
import { Icon } from "./Icon";
import { TaskPeoplePicker } from "./collaboration/TaskPlanning";
import { PersonAvatar } from "./collaboration/PersonAvatar";
import type { TaskPlanningProps } from "./collaboration/types";
import "./TaskComposer.css";

type Props = { readonly task?: Task; readonly areas?: Area[]; readonly projects?: Project[]; readonly initialContext?: Pick<TaskDraft, "areaId" | "projectId" | "status">; readonly planning?: TaskPlanningProps; readonly onProjectChange?: (projectId: string | null) => void; readonly onSave: (input: TaskDraft) => Promise<void>; readonly onCancel: () => void };

export function TaskComposer({ task, areas = [], projects = [], initialContext, planning, onProjectChange, onSave, onCancel }: Props) {
  const { t } = useI18n();
  const workflowOptions: { id: TaskStatus; name: string }[] = [
    { id: "inbox", name: t("tasks.composer.statusInbox") },
    { id: "backlog", name: t("tasks.composer.statusBacklog") },
    { id: "next", name: t("tasks.composer.statusTodo") },
    { id: "in_progress", name: t("tasks.composer.statusInProgress") },
    { id: "waiting", name: t("tasks.composer.statusWaiting") },
    { id: "done", name: t("tasks.composer.statusDone") },
  ];
  const [title, setTitle] = useState(task?.title ?? "");
  const [description, setDescription] = useState(task?.description ?? "");
  const [dueDate, setDueDate] = useState(task?.dueDate ?? "");
  const [priority, setPriority] = useState<TaskPriority>(task?.priority ?? 4);
  const [important, setImportant] = useState(task?.important ?? false);
  const [urgent, setUrgent] = useState(task?.urgent ?? false);
  const [areaId, setAreaId] = useState(task?.areaId ?? initialContext?.areaId ?? null);
  const [projectId, setProjectId] = useState(task?.projectId ?? initialContext?.projectId ?? planning?.fields.find((field) => field.key === "project")?.selectedIds[0] ?? null);
  const [status, setStatus] = useState<TaskStatus>(() => {
    const plannedStatus = planning?.fields.find((field) => field.key === "state")?.selectedIds[0];
    return task?.status ?? (task?.completed ? "done" : undefined) ?? initialContext?.status
      ?? workflowOptions.find((option) => option.id === plannedStatus)?.id ?? "inbox";
  });
  const [assigneeName, setAssigneeName] = useState(task?.assigneeName ?? "");
  const [followUpDate, setFollowUpDate] = useState(task?.followUpDate ?? "");
  const [planningPeople, setPlanningPeople] = useState(planning?.people ?? []);
  const peopleSource = useRef(planning?.people);
  const awaitingProjectPeople = useRef(!planning);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const submitting = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  useModalDialog(dialogRef);
  const planningDisabled = Boolean(planning?.readOnly || planning?.loading);
  const extraFields = planning?.fields.filter((field) => field.key !== "state" && field.key !== "project") ?? [];
  const projectOptions = [...projects.filter((project) => !areaId || project.areaId === areaId)];
  const extraProjects = planning?.fields.find((field) => field.key === "project")?.options.filter((option) => !projects.some((project) => project.id === option.id)) ?? [];
  // Progressive disclosure: fields implied by the creation/edit context are
  // hidden entirely (not even a "No project" placeholder) but still saved.
  const planningProjectId = planning?.fields.find((field) => field.key === "project")?.selectedIds[0] ?? null;
  const lockedProjectId = task?.projectId ?? initialContext?.projectId ?? planningProjectId ?? null;
  const isProjectLocked = Boolean(lockedProjectId);
  const lockedProject = projects.find((project) => project.id === (projectId ?? lockedProjectId)) ?? null;
  const isAreaLocked = Boolean(initialContext?.areaId ?? (isProjectLocked ? lockedProject?.areaId : null));
  const isStatusLocked = Boolean(!task && initialContext?.status);
  const effectiveAreaId = areaId ?? (isAreaLocked ? initialContext?.areaId ?? lockedProject?.areaId ?? null : null);
  const hasOptionalDetail = Boolean(description.trim() || assigneeName.trim() || followUpDate || important || urgent || (!isAreaLocked && areaId) || planningPeople.length || extraFields.some((field) => field.selectedIds.length > 0));

  useEffect(() => {
    if (awaitingProjectPeople.current && planning?.people !== peopleSource.current) {
      setPlanningPeople(planning?.people ?? []);
      awaitingProjectPeople.current = !planning;
    }
    peopleSource.current = planning?.people;
  }, [planning?.people, projectId]);

  function changeProject(id: string | null) {
    if (planningDisabled || submitting.current) return;
    if (id !== projectId) {
      setPlanningPeople([]);
      peopleSource.current = planning?.people;
      awaitingProjectPeople.current = true;
    }
    setProjectId(id);
    const project = projects.find((item) => item.id === id);
    if (project?.areaId) setAreaId(project.areaId);
    planning?.onFieldChange?.("project", id ? [id] : []);
    onProjectChange?.(id);
  }

  // Don't steal focus on touch devices: it pops the keyboard, shrinks the
  // visual viewport, and can push the sheet footer out of view.
  useEffect(() => {
    if (typeof window !== "undefined" && window.matchMedia?.("(hover: none)")?.matches) return;
    inputRef.current?.focus();
  }, []);

  async function submit() {
    const clean = title.trim();
    if (!clean || submitting.current || planningDisabled) return;
    submitting.current = true;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await onSave({ title: clean, description: description.trim(), dueDate: dueDate || null, priority, important, urgent, areaId: effectiveAreaId, projectId, status, assigneeName: assigneeName.trim(), ...(planning || onProjectChange ? { peopleIds: planningPeople.map((person) => person.id) } : {}), followUpDate: followUpDate || null });
      setNotice(task ? t("tasks.composer.saved") : t("tasks.composer.created"));
      if (!task) {
        setTitle("");
        setDescription("");
        setDueDate("");
        setPriority(4);
        setImportant(false);
        setUrgent(false);
        setAreaId(null);
        if (projectId) {
          setPlanningPeople([]);
          peopleSource.current = planning?.people;
          awaitingProjectPeople.current = true;
          onProjectChange?.(null);
        }
        setProjectId(null);
        setStatus("inbox");
        setAssigneeName("");
        setFollowUpDate("");
      }
    } catch {
      setError(t("tasks.composer.saveError"));
    } finally {
      submitting.current = false;
      setSaving(false);
    }
  }

  function handleCancel(event: React.SyntheticEvent<HTMLDialogElement>) {
    event.preventDefault();
    if (!submitting.current) onCancel();
  }

  return (
    <>
      <button type="button" className="modal-backdrop" aria-label={t("tasks.composer.closeDialog")} disabled={saving} onClick={onCancel} />
      <dialog ref={dialogRef} className="modal composer-modal task-composer-modal" aria-labelledby="new-task-title" onCancel={handleCancel}>
      <form aria-busy={saving} onSubmit={(event) => { event.preventDefault(); void submit(); }}>
        <div className="modal-header">
          <h2 id="new-task-title">{task ? t("tasks.composer.titleEdit") : t("tasks.composer.titleNew")}</h2>
          <button type="button" className="icon-button" aria-label={t("tasks.composer.close")} disabled={saving} onClick={onCancel}><Icon name="close" /></button>
        </div>
        {planning?.readOnly && <p className="task-composer-feedback">{t("tasks.composer.readOnly")}</p>}
        <fieldset className="task-composer-body" disabled={saving || planningDisabled}>
        <div className="composer-input-row">
          <span className="composer-mark" aria-hidden="true"><Icon name="plus" /></span>
          <input ref={inputRef} value={title} onChange={(event) => setTitle(event.target.value)} placeholder={t("tasks.composer.titlePlaceholder")} aria-label={t("tasks.composer.titleLabel")} />
        </div>
        <div className="task-composer-primary">
          {!isProjectLocked && <label className="task-composer-field"><span>{t("tasks.composer.project")}</span><select disabled={planningDisabled} value={projectId ?? ""} onChange={(event) => changeProject(event.target.value || null)}><option value="">{t("tasks.composer.noProject")}</option>{[...projectOptions, ...extraProjects].map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>}
          {!isStatusLocked && <label className="task-composer-field"><span>{t("tasks.composer.status")}</span><select aria-label={t("tasks.composer.status")} disabled={planningDisabled} value={status} onChange={(event) => { const next = event.target.value as TaskStatus; setStatus(next); planning?.onFieldChange?.("state", [next]); }}>{workflowOptions.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}</select></label>}
          <label className="task-composer-field"><span>{t("tasks.composer.priority")}</span><select value={priority} onChange={(event) => setPriority(Number(event.target.value) as TaskPriority)}>{[1, 2, 3, 4].map((value) => <option key={value} value={value}>{t("tasks.composer.priorityOption", { value })}</option>)}</select></label>
          <label className="task-composer-field"><span>{t("tasks.composer.dueDate")}</span><input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} /></label>
        </div>
        <details className="task-composer-secondary"><summary>{hasOptionalDetail ? t("tasks.composer.moreOptionsSet") : t("tasks.composer.moreOptions")}</summary>
          <div className="task-composer-secondary-grid">
            <label className="task-composer-field task-composer-description-field"><span>{t("tasks.composer.description")}</span><textarea className="composer-description" value={description} onChange={(event) => setDescription(event.target.value)} placeholder={t("tasks.composer.descriptionPlaceholder")} aria-label={t("tasks.composer.descriptionLabel")} rows={2} /></label>
            {!isAreaLocked && <label className="task-composer-field"><span>{t("tasks.composer.area")}</span><select disabled={planningDisabled} value={areaId ?? ""} onChange={(event) => { const next = event.target.value || null; setAreaId(next); if (projectId && projects.find((project) => project.id === projectId)?.areaId !== next) changeProject(null); }}><option value="">{t("tasks.composer.noArea")}</option>{areas.map((area) => <option key={area.id} value={area.id}>{area.name}</option>)}</select></label>}
            <label className="task-composer-field"><span>{t("tasks.composer.assignee")}</span><input value={assigneeName} onChange={(event) => setAssigneeName(event.target.value)} placeholder={t("tasks.composer.assigneePlaceholder")} /></label>
            <label className="task-composer-field"><span>{t("tasks.composer.followUp")}</span><input type="date" value={followUpDate} onChange={(event) => setFollowUpDate(event.target.value)} /></label>
          </div>
          <div className="task-composer-flags">
          <button type="button" className={`option-button flag-toggle ${important ? "selected important" : ""}`} aria-pressed={important} onClick={() => setImportant((value) => !value)}><Icon name="star" /> {t("tasks.composer.important")}</button>
          <button type="button" className={`option-button flag-toggle ${urgent ? "selected urgent" : ""}`} aria-pressed={urgent} onClick={() => setUrgent((value) => !value)}><Icon name="bolt" /> {t("tasks.composer.urgent")}</button>
          </div>
          {planning && <div className="task-composer-people">
            <p className="task-composer-more-heading"><span className="task-composer-avatars" aria-hidden="true">{planningPeople.length ? planningPeople.slice(0, 4).map((person) => <PersonAvatar key={person.id} person={person} />) : <Icon name="user" />}</span><span>{planningPeople.length > 0 ? t("tasks.composer.peopleCount", { count: planningPeople.length }) : t("tasks.composer.people")}</span></p>
            <TaskPeoplePicker
            {...planning}
            people={planningPeople}
            availablePeople={awaitingProjectPeople.current ? [] : planning.availablePeople}
            loading={planning.loading || awaitingProjectPeople.current}
            onPeopleChange={(people) => { setPlanningPeople(people); planning.onPeopleChange?.(people); }}
            />
          </div>}
          {extraFields.length > 0 && <div className="task-composer-planning"><p className="task-composer-more-heading">{t("tasks.composer.planning")}</p><div className="task-composer-secondary-grid">
            {extraFields.map((field) => <label className="task-composer-field" key={field.key}><span>{field.label}</span><select disabled={planningDisabled || !planning?.onFieldChange} multiple={field.key === "labels"} value={field.key === "labels" ? [...field.selectedIds] : field.selectedIds[0] ?? ""} onChange={(event) => planning?.onFieldChange?.(field.key, Array.from(event.currentTarget.selectedOptions, (option) => option.value).filter(Boolean))}>
              {field.key !== "labels" && <option value="">{t("tasks.composer.none")}</option>}{field.options.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
            </select></label>)}
          </div></div>}
        </details>
        </fieldset>
        {error && <p className="task-composer-feedback task-composer-error" role="alert">{error}</p>}
        <p className="task-composer-feedback" role="status">{saving ? t("tasks.composer.savingStatus") : notice}</p>
        <div className="modal-footer">
          <button type="button" className="secondary-button" disabled={saving} onClick={onCancel}>{t("tasks.composer.cancel")}</button>
          <button className="primary-button" type="submit" disabled={!title.trim() || saving || planningDisabled}>{saving ? t("tasks.composer.saving") : task ? t("tasks.composer.save") : t("tasks.composer.create")}</button>
        </div>
      </form>
    </dialog>
    </>
  );
}
