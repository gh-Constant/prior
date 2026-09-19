import { useState } from "react";
import { Icon, type IconName } from "../Icon";
import { CollaborationState, ReadOnlyNotice } from "./CollaborationState";
import { PersonAvatar } from "./PersonAvatar";
import { useI18n } from "../../lib/i18n";
import { CustomSelect } from "../CustomSelect";
import { TaskStatusBadge } from "../TaskStatusBadge";
import { taskStatusTone } from "../../lib/taskStatusAppearance";
import type { Person, PlanningKey, ProjectIssue, TaskPerson, TaskPlanningProps, WorkflowState } from "./types";
import "./Collaboration.css";

const propertyIcons: Record<PlanningKey, IconName> = {
  team: "user", project: "folder", state: "focus", cycle: "refresh", milestone: "flag", labels: "tag", parent: "list",
};

export function PeopleChips({ people }: { people: readonly Person[] }) {
  const { t } = useI18n();
  if (!people.length) return null;
  return <div className="collab-chips" aria-label={t("collab.people.label")}>
    {people.map((person) => <span className="collab-chip" key={person.id}>
      <PersonAvatar person={person} />{person.name}
    </span>)}
  </div>;
}

export function AgilePropertyChips({ properties = [], priority, state }: Pick<ProjectIssue, "properties" | "priority"> & { state?: WorkflowState }) {
  const { t } = useI18n();
  return <div className="collab-chips" aria-label={t("collab.issue.properties")}>
    {properties.map((property, index) => property.key === "state" ? <TaskStatusBadge key={`${property.key}-${index}`} status={state?.id} category={state?.category} label={property.label} /> : <span className="collab-chip" key={`${property.key}-${index}`}>
      <Icon name={propertyIcons[property.key]} aria-hidden="true" /><span>{property.label}</span>
    </span>)}
    {priority !== undefined && <span className="collab-chip"><Icon name="flag" aria-hidden="true" />{t("collab.issue.priority", { priority })}</span>}
  </div>;
}

export function TaskPeoplePicker({ people, availablePeople, readOnly = false, loading = false, onPeopleChange }: Omit<TaskPlanningProps, "fields" | "onFieldChange">) {
  const [query, setQuery] = useState("");
  const { t } = useI18n();
  const editable = !readOnly && !loading && Boolean(onPeopleChange);
  const ownerCount = people.filter((person) => person.role === "owner").length;
  const selectedIds = new Set(people.map((person) => person.id));
  const candidates = availablePeople.filter((person) => !selectedIds.has(person.id) && `${person.name} ${person.email ?? ""}`.toLowerCase().includes(query.trim().toLowerCase()));

  function changeRole(person: TaskPerson, role: TaskPerson["role"]) {
    if (!editable || (person.role === "owner" && ownerCount === 1)) return;
    onPeopleChange?.(people.map((item) => item.id === person.id ? { ...item, role } : item));
  }

  return <section className="collab-people-picker" aria-label={t("collab.taskPeople.group")}>
    <h3>{t("collab.people.label")}</h3>
    <PeopleChips people={people} />
    {readOnly && <ReadOnlyNotice />}
    {loading ? <CollaborationState title={t("collab.taskPeople.loading")} loading /> : <>
      {people.length > 0 && <ul className="collab-members">{people.map((person) => {
        const lastOwner = person.role === "owner" && ownerCount === 1;
        return <li key={person.id}>
          <PersonAvatar person={person} />
          <div className="collab-person-copy"><strong>{person.name}</strong>{lastOwner && <small>{t("collab.taskPeople.lastOwner")}</small>}</div>
          <div className="collab-role-select-wrap">
            <CustomSelect
              ariaLabel={t("collab.taskPeople.roleFor", { name: person.name })}
              value={person.role}
              disabled={!editable || lastOwner}
              onChange={(val) => changeRole(person, val as TaskPerson["role"])}
              options={[
                { value: "owner", label: t("collab.roles.owner") },
                { value: "assignee", label: t("collab.roles.assignee") },
                { value: "collaborator", label: t("collab.roles.collaborator") },
              ]}
            />
          </div>
          <button type="button" className="icon-button" aria-label={t("collab.taskPeople.removeFor", { name: person.name })} disabled={!editable || lastOwner} onClick={() => { if (editable && !lastOwner) onPeopleChange?.(people.filter((item) => item.id !== person.id)); }}><Icon name="close" /></button>
        </li>;
      })}</ul>}
      {editable && <details className="collab-picker-options">
        <summary className="collab-disclosure-summary">
          {t("collab.taskPeople.add")}
          <Icon name="chevron-down" className="collab-disclosure-chevron" />
        </summary>
        <label className="collab-field"><span>{t("collab.taskPeople.search")}</span><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("collab.taskPeople.searchPlaceholder")} /></label>
        <div className="collab-candidates">{candidates.map((person) => <button key={person.id} type="button" className="secondary-button" onClick={() => onPeopleChange?.([...people, { ...person, role: "collaborator" }])}><Icon name="plus" />{person.name}</button>)}</div>
        {!candidates.length && <p className="collab-muted">{query ? t("collab.taskPeople.noMatch") : t("collab.taskPeople.noMore")}</p>}
      </details>}
    </>}
  </section>;
}

/** Fully controlled: the parent owns the draft and saves it separately from TaskDraft. */
export function TaskPlanning({ fields, onFieldChange, ...peopleProps }: TaskPlanningProps) {
  const { t } = useI18n();
  const disabled = peopleProps.readOnly || peopleProps.loading || !onFieldChange;
  return <div className="collab-task-planning">
    <TaskPeoplePicker {...peopleProps} />
    <details className="collab-planning">
      <summary className="collab-disclosure-summary">
        {t("collab.planning.title")}
        <Icon name="chevron-down" className="collab-disclosure-chevron" />
      </summary>
      <div className="collab-planning-grid">{fields.map((field) => <div className="collab-field" key={field.key}>
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
                    disabled={disabled}
                    className={`collab-chip-btn ${isSelected ? "selected" : ""}`}
                    aria-pressed={isSelected}
                    onClick={() => {
                      const next = isSelected
                        ? field.selectedIds.filter((id) => id !== option.id)
                        : [...field.selectedIds, option.id];
                      onFieldChange?.(field.key, next);
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
              disabled={disabled}
              multiple
              tabIndex={-1}
              value={[...field.selectedIds]}
              onChange={(event) =>
                onFieldChange?.(
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
            disabled={disabled}
            value={field.selectedIds[0] ?? ""}
            onChange={(next) => onFieldChange?.(field.key, next ? [String(next)] : [])}
            options={[
              { value: "", label: t("collab.planning.none") },
              ...field.options.map((opt) => ({
                value: opt.id,
                label: opt.name,
                ...(field.key === "state" ? { color: taskStatusTone(opt.id).color, tone: taskStatusTone(opt.id) } : {}),
              })),
            ]}
          />
        )}
      </div>)}</div>
      {!fields.length && <p className="collab-muted">{t("collab.planning.empty")}</p>}
    </details>
  </div>;
}
