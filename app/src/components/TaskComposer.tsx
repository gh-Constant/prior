import { useEffect, useRef, useState } from "react";
import type { Area, Project, Task, TaskDraft, TaskPriority, TaskStatus } from "../types";
import { useModalDialog } from "../hooks/useModalDialog";
import { useI18n } from "../lib/i18n";
import { Icon } from "./Icon";
import { CustomSelect } from "./CustomSelect";
import { TaskPeoplePicker } from "./collaboration/TaskPlanning";
import { PersonAvatar } from "./collaboration/PersonAvatar";
import type { TaskPlanningProps } from "./collaboration/types";
import "./TaskComposer.css";

const PRIORITY_COLORS: Record<number, string> = {
  1: "#e53935",
  2: "#f57c00",
  3: "#1e88e5",
  4: "#888888",
};

function formatDueDateDisplay(value: string, fallbackText: string, lang: string): string {
  if (!value) return fallbackText;
  const now = new Date();
  const todayKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  if (value === todayKey) {
    return lang === "fr" ? "Aujourd’hui" : "Today";
  }
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  const tomorrowKey = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, "0")}-${String(tomorrow.getDate()).padStart(2, "0")}`;
  if (value === tomorrowKey) {
    return lang === "fr" ? "Demain" : "Tomorrow";
  }
  try {
    const [year, month, day] = value.split("-").map(Number);
    const d = new Date(year, month - 1, day);
    return d.toLocaleDateString(lang, { day: "numeric", month: "short" });
  } catch {
    return value;
  }
}

type Props = { readonly task?: Task; readonly areas?: Area[]; readonly projects?: Project[]; readonly initialContext?: Pick<TaskDraft, "areaId" | "projectId" | "status">; readonly planning?: TaskPlanningProps; readonly onProjectChange?: (projectId: string | null) => void; readonly onSave: (input: TaskDraft) => Promise<void>; readonly onCancel: () => void };

export function TaskComposer({ task, areas = [], projects = [], initialContext, planning, onProjectChange, onSave, onCancel }: Props) {
  const { t, lang } = useI18n();
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
    if (typeof window !== "undefined" && window.matchMedia?.("(hover: none)")?.matches) {
      dialogRef.current?.focus();
      return;
    }
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
      <dialog ref={dialogRef} tabIndex={-1} className="modal composer-modal task-composer-modal" aria-labelledby="new-task-title" onCancel={handleCancel}>
        <div className="task-composer-grab-handle" aria-hidden="true" />
        <form aria-busy={saving} onSubmit={(event) => { event.preventDefault(); void submit(); }}>
          <div className="modal-header">
            <div className="task-composer-title-group">
              <h2 id="new-task-title">{task ? t("tasks.composer.titleEdit") : t("tasks.composer.titleNew")}</h2>
              {lockedProject && (
                <span className="task-composer-context-badge">
                  <Icon name="folder" />
                  <span>{lockedProject.name}</span>
                </span>
              )}
            </div>
            <button type="button" className="icon-button" aria-label={t("tasks.composer.close")} disabled={saving} onClick={onCancel}>
              <Icon name="close" />
            </button>
          </div>
          {planning?.readOnly && <p className="task-composer-feedback">{t("tasks.composer.readOnly")}</p>}
          <fieldset className="task-composer-body" disabled={saving || planningDisabled}>
            <div className="task-composer-hero">
              <input
                ref={inputRef}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder={t("tasks.composer.titlePlaceholder")}
                aria-label={t("tasks.composer.titleLabel")}
                className="task-composer-title-input"
              />
            </div>

            <div className="task-composer-toolbar">
              {!isProjectLocked && (
                <CustomSelect
                  ariaLabel={t("tasks.composer.project")}
                  className="custom-select-pill"
                  disabled={planningDisabled}
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
              {!isStatusLocked && (
                <CustomSelect
                  ariaLabel={t("tasks.composer.status")}
                  className="custom-select-pill"
                  disabled={planningDisabled}
                  value={status}
                  onChange={(val) => {
                    const next = val as TaskStatus;
                    setStatus(next);
                    planning?.onFieldChange?.("state", [next]);
                  }}
                  options={workflowOptions.map((option) => ({
                    value: option.id,
                    label: option.name,
                    icon: "check-circle" as const,
                  }))}
                />
              )}
              <CustomSelect
                ariaLabel={t("tasks.composer.priority")}
                className="custom-select-pill"
                value={priority}
                onChange={(val) => setPriority(Number(val) as TaskPriority)}
                options={[1, 2, 3, 4].map((value) => ({
                  value,
                  label: t("tasks.composer.priorityOption", { value }),
                  color: PRIORITY_COLORS[value],
                }))}
              />
              <div className="task-composer-date-pill-wrap">
                <label className={`task-composer-date-pill ${dueDate ? "has-date" : ""}`}>
                  <Icon name="calendar-check" />
                  <span>{formatDueDateDisplay(dueDate, t("tasks.composer.dueDate"), lang)}</span>
                  <input
                    type="date"
                    aria-label={t("tasks.composer.dueDate")}
                    value={dueDate}
                    onChange={(event) => setDueDate(event.target.value)}
                    className="task-composer-date-native"
                  />
                </label>
                {dueDate && (
                  <button
                    type="button"
                    className="task-composer-date-clear"
                    aria-label="Clear date"
                    onClick={() => setDueDate("")}
                  >
                    <Icon name="close" />
                  </button>
                )}
              </div>
            </div>

            <details className="task-composer-details">
              <summary className="task-composer-details-trigger">
                <Icon name="chevron-down" className="task-composer-chevron" />
                <span>{hasOptionalDetail ? t("tasks.composer.moreOptionsSet") : t("tasks.composer.moreOptions")}</span>
              </summary>
              <div className="task-composer-details-content">
                <div className="task-composer-input-field task-composer-field-full">
                  <span>{t("tasks.composer.description")}</span>
                  <textarea
                    className="task-composer-desc-input"
                    value={description}
                    onChange={(event) => setDescription(event.target.value)}
                    placeholder={t("tasks.composer.descriptionPlaceholder")}
                    aria-label={t("tasks.composer.descriptionLabel")}
                    rows={2}
                  />
                </div>
                <div className="task-composer-details-row">
                  {!isAreaLocked && (
                    <div className="task-composer-input-field">
                      <span>{t("tasks.composer.area")}</span>
                      <CustomSelect
                        ariaLabel={t("tasks.composer.area")}
                        disabled={planningDisabled}
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
                    <span>{t("tasks.composer.assignee")}</span>
                    <input
                      value={assigneeName}
                      onChange={(event) => setAssigneeName(event.target.value)}
                      placeholder={t("tasks.composer.assigneePlaceholder")}
                      aria-label={t("tasks.composer.assignee")}
                    />
                  </div>
                  <div className="task-composer-input-field">
                    <span>{t("tasks.composer.followUp")}</span>
                    <div className="task-composer-date-pill-wrap">
                      <label className={`task-composer-date-pill ${followUpDate ? "has-date" : ""}`}>
                        <Icon name="calendar-check" />
                        <span>{formatDueDateDisplay(followUpDate, t("tasks.composer.followUp"), lang)}</span>
                        <input
                          type="date"
                          value={followUpDate}
                          onChange={(event) => setFollowUpDate(event.target.value)}
                          aria-label={t("tasks.composer.followUp")}
                          className="task-composer-date-native"
                        />
                      </label>
                      {followUpDate && (
                        <button
                          type="button"
                          className="task-composer-date-clear"
                          aria-label="Clear follow up date"
                          onClick={() => setFollowUpDate("")}
                        >
                          <Icon name="close" />
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                <div className="task-composer-flags">
                  <button
                    type="button"
                    className={`task-composer-flag-btn ${important ? "selected important" : ""}`}
                    aria-pressed={important}
                    onClick={() => setImportant((value) => !value)}
                  >
                    <Icon name="star" />
                    <span>{t("tasks.composer.important")}</span>
                  </button>
                  <button
                    type="button"
                    className={`task-composer-flag-btn ${urgent ? "selected urgent" : ""}`}
                    aria-pressed={urgent}
                    onClick={() => setUrgent((value) => !value)}
                  >
                    <Icon name="bolt" />
                    <span>{t("tasks.composer.urgent")}</span>
                  </button>
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
                                      disabled={planningDisabled || !planning?.onFieldChange}
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
                                disabled={planningDisabled || !planning?.onFieldChange}
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
                              disabled={planningDisabled || !planning?.onFieldChange}
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
          </fieldset>
          {error && <p className="task-composer-feedback task-composer-error" role="alert">{error}</p>}
          <p className="task-composer-feedback" role="status">{saving ? t("tasks.composer.savingStatus") : notice}</p>
          <div className="task-composer-footer">
            <button type="button" className="secondary-button" disabled={saving} onClick={onCancel}>
              {t("tasks.composer.cancel")}
            </button>
            <button className="primary-button" type="submit" disabled={!title.trim() || saving || planningDisabled}>
              {saving ? t("tasks.composer.saving") : task ? t("tasks.composer.save") : t("tasks.composer.create")}
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}
