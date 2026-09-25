import { useEffect, useMemo, useRef, useState } from "react";
import type { Area, Project, Task, TaskDraft, TaskPriority, TaskStatus } from "../types";
import { useModalDialog } from "../hooks/useModalDialog";
import { useI18n } from "../lib/i18n";
import { Icon } from "./Icon";
import { CustomSelect } from "./CustomSelect";
import { taskStatusTone } from "../lib/taskStatusAppearance";
import { TaskStatusBadge } from "./TaskStatusBadge";
import { DateTimePicker } from "./DateTimePicker";
import { TaskTitleInput } from "./TaskTitleInput";
import { TaskPeoplePicker } from "./collaboration/TaskPlanning";
import { PersonAvatar } from "./collaboration/PersonAvatar";
import type { TaskPlanningProps } from "./collaboration/types";
import { parseTaskTitle, type TaskTitleField, type TaskTitleToken } from "../lib/taskTitleParser";
import "./TaskComposer.css";

const PRIORITY_COLORS: Record<number, string> = {
  1: "#e53935",
  2: "#f57c00",
  3: "#1e88e5",
  4: "#888888",
};

/** Preset fields for a new task (project, status group, matrix quadrant). */
export type TaskComposerContext = Pick<TaskDraft, "areaId" | "projectId" | "status"> & Partial<Pick<TaskDraft, "important" | "urgent">>;

export type TaskComposerSaveOptions = { readonly keepOpen: boolean };

type Props = {
  readonly task?: Task;
  readonly areas?: Area[];
  readonly projects?: Project[];
  readonly initialContext?: TaskComposerContext;
  readonly planning?: TaskPlanningProps;
  readonly onProjectChange?: (projectId: string | null) => void;
  /** Shows the "Create more" switch; the parent keeps the sheet open when `keepOpen` is set. */
  readonly allowCreateMore?: boolean;
  readonly onSave: (input: TaskDraft, options?: TaskComposerSaveOptions) => Promise<void>;
  readonly onCancel: () => void;
};

const IS_MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/i.test(navigator.platform);

export function TaskComposer({ task, areas = [], projects = [], initialContext, planning, onProjectChange, allowCreateMore = false, onSave, onCancel }: Props) {
  const { t, lang } = useI18n();
  const [title, setTitle] = useState(task?.title ?? "");
  const [description, setDescription] = useState(task?.description ?? "");
  const [dueDate, setDueDate] = useState(task?.dueDate ?? "");
  const [dueTime, setDueTime] = useState(task?.dueTime ?? null);
  const [priority, setPriority] = useState<TaskPriority>(task?.priority ?? 4);
  const [important, setImportant] = useState(task?.important ?? initialContext?.important ?? false);
  const [urgent, setUrgent] = useState(task?.urgent ?? initialContext?.urgent ?? false);
  const [areaId, setAreaId] = useState(task?.areaId ?? initialContext?.areaId ?? null);
  const [projectId, setProjectId] = useState(task?.projectId ?? initialContext?.projectId ?? planning?.fields.find((field) => field.key === "project")?.selectedIds[0] ?? null);

  const currentProject = projects.find((p) => p.id === (projectId ?? initialContext?.projectId));
  const isSoftwareProject = currentProject?.projectType === "software" || Boolean(planning);

  const workflowOptions = useMemo<{ id: TaskStatus; name: string }[]>(() => {
    if (isSoftwareProject) {
      return [
        { id: "inbox", name: t("tasks.composer.statusInbox") },
        { id: "backlog", name: t("tasks.composer.statusBacklog") },
        { id: "next", name: t("tasks.composer.statusTodo") },
        { id: "in_progress", name: t("tasks.composer.statusInProgress") },
        { id: "waiting", name: t("tasks.composer.statusWaiting") },
        { id: "done", name: t("tasks.composer.statusDone") },
      ];
    }
    const options: { id: TaskStatus; name: string }[] = [
      { id: "next", name: t("tasks.composer.statusTodo") },
      { id: "in_progress", name: t("tasks.composer.statusInProgress") },
      { id: "waiting", name: t("tasks.composer.statusWaiting") },
      { id: "done", name: t("tasks.composer.statusDone") },
    ];
    if (task?.status === "inbox" || initialContext?.status === "inbox") options.unshift({ id: "inbox", name: t("tasks.composer.statusInbox") });
    if (task?.status === "backlog" || initialContext?.status === "backlog") options.unshift({ id: "backlog", name: t("tasks.composer.statusBacklog") });
    return options;
  }, [initialContext?.status, isSoftwareProject, t, task?.status]);

  const [status, setStatus] = useState<TaskStatus>(() => {
    const plannedStatus = planning?.fields.find((field) => field.key === "state")?.selectedIds[0];
    const explicit = task?.status ?? (task?.completed ? "done" : undefined) ?? initialContext?.status
      ?? (plannedStatus as TaskStatus | undefined);
    return explicit ?? "next";
  });
  // The creation context a "Create more" reset returns to.
  const initialDraft = useRef({ status, projectId, areaId });
  const [createMore, setCreateMore] = useState(false);
  const refocusAfterSave = useRef(false);
  const [assigneeName, setAssigneeName] = useState(task?.assigneeName ?? "");
  const [followUpDate, setFollowUpDate] = useState(task?.followUpDate ?? "");
  const [followUpTime, setFollowUpTime] = useState(task?.followUpTime ?? null);
  const [planningPeople, setPlanningPeople] = useState(planning?.people ?? []);
  const peopleSource = useRef(planning?.people);
  const awaitingProjectPeople = useRef(!planning);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [ignoredTitleTokens, setIgnoredTitleTokens] = useState<string[]>([]);
  const submitting = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const autoTitleValues = useRef<Partial<Record<TaskTitleField, string | number | boolean>>>({});
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
  const hasOptionalDetail = Boolean(followUpDate || (!isAreaLocked && areaId) || planningPeople.length || extraFields.some((field) => field.selectedIds.length > 0));
  const parsedTitle = useMemo(() => parseTaskTitle(title, {
    lang,
    projects: isProjectLocked ? [] : projects,
    areas: isAreaLocked ? [] : areas,
  }, ignoredTitleTokens), [areas, ignoredTitleTokens, isAreaLocked, isProjectLocked, lang, projects, title]);
  const parsedFieldSignature = JSON.stringify(parsedTitle.fields);

  const currentTitleFieldValues: Partial<Record<TaskTitleField, string | number | boolean>> = {
    dueDate,
    dueTime: dueTime ?? "",
    priority,
    status,
    projectId: projectId ?? "",
    areaId: areaId ?? "",
    assigneeName,
    important,
    urgent,
  };

  function clearParsedField(field: TaskTitleField) {
    switch (field) {
      case "dueDate": setDueDate(""); break;
      case "dueTime": setDueTime(null); break;
      case "priority": setPriority(4); break;
      case "status": setStatus("next"); break;
      case "projectId": setProjectId(null); onProjectChange?.(null); break;
      case "areaId": setAreaId(null); break;
      case "assigneeName": setAssigneeName(""); break;
      case "important": setImportant(false); break;
      case "urgent": setUrgent(false); break;
    }
  }

  function applyParsedField(field: TaskTitleField, value: string | number | boolean) {
    switch (field) {
      case "dueDate": setDueDate(String(value)); break;
      case "dueTime": setDueTime(String(value)); break;
      case "priority": setPriority(Number(value) as TaskPriority); break;
      case "status": setStatus(value as TaskStatus); break;
      case "projectId": changeProject(String(value)); break;
      case "areaId": setAreaId(String(value)); break;
      case "assigneeName": setAssigneeName(String(value)); break;
      case "important": setImportant(Boolean(value)); break;
      case "urgent": setUrgent(Boolean(value)); break;
    }
  }

  useEffect(() => {
    const nextFields = parsedTitle.fields;
    const previousFields = autoTitleValues.current;
    for (const [field, value] of Object.entries(nextFields) as [TaskTitleField, string | number | boolean][]) {
      if (previousFields[field] !== value) applyParsedField(field, value);
      previousFields[field] = value;
    }
    for (const field of Object.keys(previousFields) as TaskTitleField[]) {
      if (field in nextFields) continue;
      const previousValue = previousFields[field];
      const currentValue = currentTitleFieldValues[field];
      if (String(currentValue ?? "") === String(previousValue ?? "")) clearParsedField(field);
      delete previousFields[field];
    }
    // The signature is intentionally consumed here so this effect only reacts
    // to recognized title changes, not to every unrelated composer render.
    void parsedFieldSignature;
  }, [parsedFieldSignature]);

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
    if (project?.projectType !== "software" && status === "backlog") {
      setStatus("next");
    }
    planning?.onFieldChange?.("project", id ? [id] : []);
    onProjectChange?.(id);
  }

  // Don't steal focus on touch devices: it pops the keyboard, shrinks the
  // visual viewport, and can push the sheet footer out of view.
  useEffect(() => {
    if (typeof window !== "undefined" && window.matchMedia?.("(hover: none)")?.matches) {
      dialogRef.current?.focus();
      return;
    }
    inputRef.current?.focus();
  }, []);

  async function submit() {
    const clean = parsedTitle.cleanTitle.trim();
    if (!clean || submitting.current || planningDisabled) return;
    submitting.current = true;
    setSaving(true);
    setError("");
    setNotice("");
    const keepOpen = allowCreateMore && !task && createMore;
    try {
      const draft: TaskDraft = { title: clean, description: description.trim(), dueDate: dueDate || null, dueTime: dueDate ? dueTime : null, priority, important, urgent, areaId: effectiveAreaId, projectId, status, assigneeName: assigneeName.trim(), ...(planning || onProjectChange ? { peopleIds: planningPeople.map((person) => person.id) } : {}), followUpDate: followUpDate || null, followUpTime: followUpDate ? followUpTime : null };
      await (allowCreateMore ? onSave(draft, { keepOpen }) : onSave(draft));
      setNotice(task ? t("tasks.composer.saved") : t("tasks.composer.created"));
      if (!task) {
        // Return to the creation context (project, area, status) so the next
        // task in a "Create more" run lands in the same place.
        const initial = initialDraft.current;
        setTitle("");
        setDescription("");
        setDueDate("");
        setDueTime(null);
        setPriority(4);
        setImportant(initialContext?.important ?? false);
        setUrgent(initialContext?.urgent ?? false);
        setAreaId(initial.areaId);
        if (projectId !== initial.projectId) {
          setPlanningPeople([]);
          peopleSource.current = planning?.people;
          awaitingProjectPeople.current = true;
          onProjectChange?.(initial.projectId);
        }
        setProjectId(initial.projectId);
        setStatus(initial.status);
        refocusAfterSave.current = keepOpen;
        setAssigneeName("");
        setFollowUpDate("");
        setFollowUpTime(null);
        setIgnoredTitleTokens([]);
        autoTitleValues.current = {};
      }
    } catch {
      setError(t("tasks.composer.saveError"));
    } finally {
      submitting.current = false;
      setSaving(false);
    }
  }

  // "Create more": once the save settles and the title is enabled again, keep typing.
  useEffect(() => {
    if (saving || !refocusAfterSave.current) return;
    refocusAfterSave.current = false;
    inputRef.current?.focus();
  }, [saving]);

  function handleCancel(event: React.SyntheticEvent<HTMLDialogElement>) {
    event.preventDefault();
    if (!submitting.current) onCancel();
  }

  function handleFormKeyDown(event: React.KeyboardEvent<HTMLFormElement>) {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void submit();
    }
  }

  const submitLabel = saving ? t("tasks.composer.saving") : task ? t("tasks.composer.save") : t("tasks.composer.create");
  const flagDisabled = saving || planningDisabled;

  return (
    <>
      <button type="button" className="modal-backdrop" aria-label={t("tasks.composer.closeDialog")} disabled={saving} onClick={onCancel} />
      <dialog ref={dialogRef} tabIndex={-1} className="modal composer-modal task-composer-modal" aria-labelledby="new-task-title" onCancel={handleCancel}>
        <div className="task-composer-grab-handle" aria-hidden="true" />
        <form aria-busy={saving} onKeyDown={handleFormKeyDown} onSubmit={(event) => { event.preventDefault(); void submit(); }}>
          <div className="modal-header">
            <nav className="task-composer-breadcrumb" aria-label={t("tasks.composerPills.breadcrumb")}>
              {lockedProject && (
                <>
                  <span className="task-composer-context-badge">
                    <Icon name="folder" />
                    <span>{lockedProject.name}</span>
                  </span>
                  <Icon name="chevron-right" className="task-composer-breadcrumb-separator" aria-hidden="true" />
                </>
              )}
              <h2 id="new-task-title">{task ? t("tasks.composer.titleEdit") : t("tasks.composer.titleNew")}</h2>
            </nav>
            <button type="button" className="icon-button" aria-label={t("tasks.composer.close")} disabled={saving} onClick={onCancel}>
              <Icon name="close" />
            </button>
          </div>
          {planning?.readOnly && <p className="task-composer-feedback">{t("tasks.composer.readOnly")}</p>}
          <div className="task-composer-body">
            <div className="task-composer-hero">
              <TaskTitleInput
                inputRef={inputRef}
                value={title}
                disabled={saving || planningDisabled}
                onChange={(nextTitle) => setTitle(nextTitle)}
                parsed={parsedTitle}
                onTokenClick={(token: TaskTitleToken) => {
                  setIgnoredTitleTokens((current) => current.includes(token.key) ? current : [...current, token.key]);
                  clearParsedField(token.field);
                }}
                projects={isProjectLocked ? [] : projects}
                areas={isAreaLocked ? [] : areas}
                placeholder={t("tasks.composer.titlePlaceholder")}
                ariaLabel={t("tasks.composer.titleLabel")}
              />
              <textarea
                className="task-composer-desc-input"
                value={description}
                disabled={saving || planningDisabled}
                onChange={(event) => setDescription(event.target.value)}
                placeholder={t("tasks.composerPills.addDescription")}
                aria-label={t("tasks.composer.descriptionLabel")}
                rows={1}
              />
            </div>

            <div className="task-composer-toolbar">
              {!isStatusLocked && (
                <CustomSelect
                  ariaLabel={t("tasks.composer.status")}
                  className="custom-select-pill"
                  disabled={planningDisabled || saving}
                  value={status}
                  onChange={(val) => {
                    const next = val as TaskStatus;
                    setStatus(next);
                    planning?.onFieldChange?.("state", [next]);
                  }}
                  options={workflowOptions.map((option) => ({
                    value: option.id,
                    label: option.name,
                    color: taskStatusTone(option.id).color,
                    tone: taskStatusTone(option.id),
                  }))}
                />
              )}
              {isStatusLocked && <TaskStatusBadge status={status} label={workflowOptions.find((option) => option.id === status)?.name ?? t("tasks.composer.statusTodo")} />}
              <CustomSelect
                ariaLabel={t("tasks.composer.priority")}
                className="custom-select-pill"
                disabled={planningDisabled || saving}
                value={priority}
                onChange={(val) => setPriority(Number(val) as TaskPriority)}
                options={[1, 2, 3, 4].map((value) => ({
                  value,
                  label: t("tasks.composer.priorityOption", { value }),
                  color: PRIORITY_COLORS[value],
                }))}
              />
              {!isProjectLocked && (
                <CustomSelect
                  ariaLabel={t("tasks.composer.project")}
                  className="custom-select-pill"
                  disabled={planningDisabled || saving}
                  value={projectId ?? ""}
                  onChange={(val) => changeProject(val ? String(val) : null)}
                  options={[
                    { value: "", label: t("tasks.composer.noProject"), icon: "folder" },
                    ...[...projectOptions, ...extraProjects].map((project) => ({
                      value: project.id,
                      label: project.name,
                      icon: "folder" as const,
                    })),
                  ]}
                />
              )}
              <DateTimePicker className="pill" value={dueDate} onChange={setDueDate} time={dueTime} onTimeChange={setDueTime} allowTime ariaLabel={t("tasks.composer.dueDate")} placeholder={t("tasks.composer.dueDate")} disabled={saving || planningDisabled} />
              <button
                type="button"
                disabled={flagDisabled}
                className={`task-composer-flag-btn ${important ? "selected important" : ""}`}
                aria-pressed={important}
                onClick={() => setImportant((value) => !value)}
              >
                <Icon name="star" />
                <span>{t("tasks.composer.important")}</span>
              </button>
              <button
                type="button"
                disabled={flagDisabled}
                className={`task-composer-flag-btn ${urgent ? "selected urgent" : ""}`}
                aria-pressed={urgent}
                onClick={() => setUrgent((value) => !value)}
              >
                <Icon name="bolt" />
                <span>{t("tasks.composer.urgent")}</span>
              </button>
              <label className={`task-composer-assignee-pill ${assigneeName.trim() ? "has-value" : ""}`}>
                <Icon name="user" aria-hidden="true" />
                <input
                  value={assigneeName}
                  disabled={flagDisabled}
                  onChange={(event) => setAssigneeName(event.target.value)}
                  placeholder={t("tasks.composerPills.assign")}
                  aria-label={t("tasks.composer.assignee")}
                  size={Math.max(t("tasks.composerPills.assign").length, assigneeName.length + 1)}
                  autoComplete="off"
                />
              </label>
            </div>

            <details className="task-composer-details">
              <summary className="task-composer-details-trigger">
                <Icon name="chevron-down" className="task-composer-chevron" />
                <span>{hasOptionalDetail ? t("tasks.composer.moreOptionsSet") : t("tasks.composer.moreOptions")}</span>
              </summary>
              <div className="task-composer-details-content">
                <div className="task-composer-details-row">
                  {!isAreaLocked && (
                    <div className="task-composer-input-field">
                      <span>{t("tasks.composer.area")}</span>
                      <CustomSelect
                        ariaLabel={t("tasks.composer.area")}
                        disabled={planningDisabled || saving}
                        value={areaId ?? ""}
                        onChange={(val) => {
                          const next = val ? String(val) : null;
                          setAreaId(next);
                          if (projectId && projects.find((project) => project.id === projectId)?.areaId !== next) changeProject(null);
                        }}
                        options={[
                          { value: "", label: t("tasks.composer.noArea") },
                          ...areas.map((area) => ({
                            value: area.id,
                            label: area.name,
                            color: area.color || undefined,
                          })),
                        ]}
                      />
                    </div>
                  )}
                  <div className="task-composer-input-field">
                    <span>{t("tasks.composer.followUp")}</span>
                    <DateTimePicker value={followUpDate} onChange={setFollowUpDate} time={followUpTime} onTimeChange={setFollowUpTime} allowTime ariaLabel={t("tasks.composer.followUp")} placeholder={t("tasks.composer.followUp")} disabled={saving || planningDisabled} />
                  </div>
                </div>

                {planning && (
                  <div className="task-composer-people">
                    <p className="task-composer-section-heading">
                      <span className="task-composer-avatars" aria-hidden="true">
                        {planningPeople.length ? planningPeople.slice(0, 4).map((person) => <PersonAvatar key={person.id} person={person} />) : <Icon name="user" />}
                      </span>
                      <span>{planningPeople.length > 0 ? t("tasks.composer.peopleCount", { count: planningPeople.length }) : t("tasks.composer.people")}</span>
                    </p>
                    <TaskPeoplePicker
                      {...planning}
                      people={planningPeople}
                      availablePeople={awaitingProjectPeople.current ? [] : planning.availablePeople}
                      loading={planning.loading || awaitingProjectPeople.current}
                      onPeopleChange={(people) => { setPlanningPeople(people); planning.onPeopleChange?.(people); }}
                    />
                  </div>
                )}

                {extraFields.length > 0 && (
                  <div className="task-composer-planning">
                    <p className="task-composer-section-heading">{t("tasks.composer.planning")}</p>
                    <div className="task-composer-details-row">
                      {extraFields.map((field) => (
                        <div
                          className={`task-composer-input-field ${field.key === "labels" ? "task-composer-field-full" : ""}`}
                          key={field.key}
                        >
                          <span>{field.label}</span>
                          {field.key === "labels" ? (
                            <>
                              <div className="collab-multi-chips">
                                {field.options.map((option) => {
                                  const isSelected = field.selectedIds.includes(option.id);
                                  return (
                                    <button
                                      key={option.id}
                                      type="button"
                                      disabled={planningDisabled || saving || !planning?.onFieldChange}
                                      className={`collab-chip-btn ${isSelected ? "selected" : ""}`}
                                      aria-pressed={isSelected}
                                      onClick={() => {
                                        const next = isSelected
                                          ? field.selectedIds.filter((id) => id !== option.id)
                                          : [...field.selectedIds, option.id];
                                        planning?.onFieldChange?.(field.key, next);
                                      }}
                                    >
                                      <Icon name={isSelected ? "check" : "tag"} />
                                      <span>{option.name}</span>
                                    </button>
                                  );
                                })}
                              </div>
                              <select
                                aria-label={field.label}
                                className="custom-select-native-hidden"
                                disabled={planningDisabled || saving || !planning?.onFieldChange}
                                multiple
                                tabIndex={-1}
                                value={[...field.selectedIds]}
                                onChange={(event) =>
                                  planning?.onFieldChange?.(
                                    field.key,
                                    Array.from(event.currentTarget.selectedOptions, (option) => option.value).filter(Boolean)
                                  )
                                }
                              >
                                {field.options.map((option) => (
                                  <option key={option.id} value={option.id}>
                                    {option.name}
                                  </option>
                                ))}
                              </select>
                            </>
                          ) : (
                            <CustomSelect
                              ariaLabel={field.label}
                              disabled={planningDisabled || saving || !planning?.onFieldChange}
                              value={field.selectedIds[0] ?? ""}
                              onChange={(val) => planning?.onFieldChange?.(field.key, val ? [String(val)] : [])}
                              options={[
                                { value: "", label: t("tasks.composer.none") },
                                ...field.options.map((opt) => ({ value: opt.id, label: opt.name })),
                              ]}
                            />
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </details>
          </div>
          {error && <p className="task-composer-feedback task-composer-error" role="alert">{error}</p>}
          <p className="task-composer-feedback" role="status">{saving ? t("tasks.composer.savingStatus") : notice}</p>
          <div className="task-composer-footer">
            {allowCreateMore && !task && (
              <label className="task-composer-create-more">
                <input type="checkbox" role="switch" checked={createMore} disabled={saving} onChange={(event) => setCreateMore(event.target.checked)} />
                <span className="task-composer-switch" aria-hidden="true" />
                <span>{t("tasks.composerPills.createMore")}</span>
              </label>
            )}
            <button type="button" className="secondary-button" disabled={saving} onClick={onCancel}>
              {t("tasks.composer.cancel")}
            </button>
            <button
              className="primary-button"
              type="submit"
              aria-label={submitLabel}
              aria-keyshortcuts={IS_MAC ? "Meta+Enter" : "Control+Enter"}
              data-shortcut={IS_MAC ? "⌘ ↵" : "Ctrl ↵"}
              disabled={!parsedTitle.cleanTitle.trim() || saving || planningDisabled}
            >
              {submitLabel}
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}
