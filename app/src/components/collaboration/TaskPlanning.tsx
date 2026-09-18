import { useState } from "react";
import { Icon, type IconName } from "../Icon";
import { CollaborationState, ReadOnlyNotice } from "./CollaborationState";
import { PersonAvatar } from "./PersonAvatar";
import type { Person, PlanningKey, ProjectIssue, TaskPerson, TaskPlanningProps } from "./types";
import "./Collaboration.css";

const propertyIcons: Record<PlanningKey, IconName> = {
  team: "user", project: "folder", state: "focus", cycle: "refresh", milestone: "flag", labels: "tag", parent: "list",
};

export function PeopleChips({ people }: { people: readonly Person[] }) {
  if (!people.length) return null;
  return <div className="collab-chips" aria-label="People">
    {people.map((person) => <span className="collab-chip" key={person.id}>
      <PersonAvatar person={person} />{person.name}
    </span>)}
  </div>;
}

export function AgilePropertyChips({ properties = [], priority }: Pick<ProjectIssue, "properties" | "priority">) {
  return <div className="collab-chips" aria-label="Issue properties">
    {properties.map((property, index) => <span className="collab-chip" key={`${property.key}-${index}`}>
      <Icon name={propertyIcons[property.key]} aria-hidden="true" /><span>{property.label}</span>
    </span>)}
    {priority !== undefined && <span className="collab-chip"><Icon name="flag" aria-hidden="true" />Priority {priority}</span>}
  </div>;
}

export function TaskPeoplePicker({ people, availablePeople, readOnly = false, loading = false, onPeopleChange }: Omit<TaskPlanningProps, "fields" | "onFieldChange">) {
  const [query, setQuery] = useState("");
  const editable = !readOnly && !loading && Boolean(onPeopleChange);
  const ownerCount = people.filter((person) => person.role === "owner").length;
  const selectedIds = new Set(people.map((person) => person.id));
  const candidates = availablePeople.filter((person) => !selectedIds.has(person.id) && `${person.name} ${person.email ?? ""}`.toLowerCase().includes(query.trim().toLowerCase()));

  function changeRole(person: TaskPerson, role: TaskPerson["role"]) {
    if (!editable || (person.role === "owner" && ownerCount === 1)) return;
    onPeopleChange?.(people.map((item) => item.id === person.id ? { ...item, role } : item));
  }

  return <section className="collab-people-picker" aria-label="Task people">
    <h3>People</h3>
    <PeopleChips people={people} />
    {readOnly && <ReadOnlyNotice />}
    {loading ? <CollaborationState title="Loading people…" loading /> : <>
      {people.length > 0 && <ul className="collab-members">{people.map((person) => {
        const lastOwner = person.role === "owner" && ownerCount === 1;
        return <li key={person.id}>
          <PersonAvatar person={person} />
          <div className="collab-person-copy"><strong>{person.name}</strong>{lastOwner && <small>At least one owner must remain</small>}</div>
          <select aria-label={`Task role for ${person.name}`} value={person.role} disabled={!editable || lastOwner} onChange={(event) => changeRole(person, event.target.value as TaskPerson["role"])}>
            <option value="owner">Owner</option><option value="assignee">Assignee</option><option value="collaborator">Collaborator</option>
          </select>
          <button type="button" className="icon-button" aria-label={`Remove ${person.name}`} disabled={!editable || lastOwner} onClick={() => { if (editable && !lastOwner) onPeopleChange?.(people.filter((item) => item.id !== person.id)); }}><Icon name="close" /></button>
        </li>;
      })}</ul>}
      {editable && <details className="collab-picker-options"><summary>Add people</summary>
        <label className="collab-field"><span>Find a project member</span><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Name or email" /></label>
        <div className="collab-candidates">{candidates.map((person) => <button key={person.id} type="button" className="secondary-button" onClick={() => onPeopleChange?.([...people, { ...person, role: "collaborator" }])}><Icon name="plus" />{person.name}</button>)}</div>
        {!candidates.length && <p className="collab-muted">{query ? "No matching members." : "No more project members to add."}</p>}
      </details>}
    </>}
  </section>;
}

/** Fully controlled: the parent owns the draft and saves it separately from TaskDraft. */
export function TaskPlanning({ fields, onFieldChange, ...peopleProps }: TaskPlanningProps) {
  const disabled = peopleProps.readOnly || peopleProps.loading || !onFieldChange;
  return <div className="collab-task-planning">
    <TaskPeoplePicker {...peopleProps} />
    <details className="collab-planning"><summary>Planning</summary>
      <div className="collab-planning-grid">{fields.map((field) => <label className="collab-field" key={field.key}>
        <span>{field.label}</span>
        <select disabled={disabled} multiple={field.key === "labels"} value={field.key === "labels" ? [...field.selectedIds] : field.selectedIds[0] ?? ""} onChange={(event) => onFieldChange?.(field.key, Array.from(event.currentTarget.selectedOptions, (option) => option.value).filter(Boolean))}>
          {field.key !== "labels" && <option value="">None</option>}
          {field.options.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
        </select>
      </label>)}</div>
      {!fields.length && <p className="collab-muted">No planning properties available.</p>}
    </details>
  </div>;
}
