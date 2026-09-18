import { useId, useState, type KeyboardEvent } from "react";
import { Icon } from "../Icon";
import { CollaborationState, ReadOnlyNotice } from "./CollaborationState";
import { ProjectShareDialog } from "./ProjectShareDialog";
import { AgilePropertyChips, PeopleChips } from "./TaskPlanning";
import type { ProjectCollaborationProps, ProjectIssue } from "./types";
import "./Collaboration.css";

const tabs = ["Overview", "Issues", "Board", "Cycles"] as const;
type Tab = typeof tabs[number];

function IssueCard({ issue, stateName, onOpen }: { issue: ProjectIssue; stateName: string; onOpen?: (id: string) => void }) {
  return <article className="collab-issue">
    <div className="collab-issue-heading">{issue.identifier && <small>{issue.identifier}</small>}
      {onOpen ? <button type="button" onClick={() => onOpen(issue.id)}>{issue.title}</button> : <strong>{issue.title}</strong>}
    </div>
    <AgilePropertyChips priority={issue.priority} properties={[{ key: "state", label: stateName }, ...(issue.properties ?? [])]} />
    <PeopleChips people={issue.people} />
  </article>;
}

function Overview({ project, issues, states, sharing, overview = {}, onOpenNotes }: ProjectCollaborationProps) {
  const completed = issues.filter((issue) => states.some((state) => state.id === issue.stateId && state.category === "completed")).length;
  const progress = issues.length ? Math.round(completed / issues.length * 100) : 0;
  return <div className="collab-overview">
    <section className="collab-panel"><h3>Project brief</h3><p className="collab-brief">{project.description || "Add a brief to give the team a shared direction."}</p>
      <dl className="collab-metadata"><div><dt>Status</dt><dd>{project.status}</dd></div><div><dt>Health</dt><dd>{overview.health ?? "Not set"}</dd></div><div><dt>Start</dt><dd>{overview.startDate ?? "Not set"}</dd></div><div><dt>Target</dt><dd>{overview.targetDate ?? "Not set"}</dd></div></dl>
      <div className="collab-progress-label"><span>{completed} of {issues.length} issues complete</span><strong>{progress}%</strong></div>
      <progress className="collab-progress" value={completed} max={issues.length || 1} aria-label="Project completion" />
    </section>
    <section className="collab-panel"><h3>People</h3><p className="collab-muted">Lead: {overview.lead?.name ?? "Not assigned"}</p><PeopleChips people={sharing.members} /></section>
    <section className="collab-panel"><h3>Milestones</h3>{overview.milestones?.length ? <ul className="collab-milestones">{overview.milestones.map((milestone) => <li key={milestone.id}><Icon name={milestone.completed ? "check-circle" : "flag"} aria-hidden="true" /><span>{milestone.name}</span><small>{milestone.completed ? "Complete" : "Open"}</small></li>)}</ul> : <p className="collab-muted">No milestones planned yet.</p>}</section>
    <section className="collab-panel"><h3>Latest update</h3><p className="collab-brief">{overview.latestUpdate || "No updates yet. Project updates will appear here."}</p></section>
    <section className="collab-panel"><h3>Resources</h3>{overview.resources?.length ? <ul className="collab-resources">{overview.resources.map((resource) => <li key={resource.id}>{/^https?:\/\//i.test(resource.href) ? <a href={resource.href} target="_blank" rel="noreferrer"><Icon name="link" aria-hidden="true" />{resource.label}</a> : <span>{resource.label}</span>}</li>)}</ul> : <p className="collab-muted">No resources linked yet.</p>}{onOpenNotes && <button type="button" className="secondary-button" onClick={onOpenNotes}><Icon name="file-text" />Open project notes</button>}</section>
  </div>;
}

export function ProjectCollaboration(props: ProjectCollaborationProps) {
  const { project, issues, states, cycles, sharing, loading = false, readOnly = true, onCreateIssue, onOpenIssue } = props;
  const [tab, setTab] = useState<Tab>("Overview");
  const [shareOpen, setShareOpen] = useState(false);
  const [query, setQuery] = useState("");
  const id = useId();
  const visibleIssues = issues.filter((issue) => `${issue.identifier ?? ""} ${issue.title}`.toLowerCase().includes(query.trim().toLowerCase()));
  const stateName = (issue: ProjectIssue) => states.find((state) => state.id === issue.stateId)?.name ?? "Unassigned state";
  const unassigned = visibleIssues.filter((issue) => !states.some((state) => state.id === issue.stateId));
  const columns = [...states.map((state) => ({ id: state.id, name: state.name, issues: visibleIssues.filter((issue) => issue.stateId === state.id) })), ...(unassigned.length ? [{ id: "__unassigned", name: "Unassigned state", issues: unassigned }] : [])];

  function navigateTabs(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next = index;
    if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
    else if (event.key === "ArrowLeft") next = (index + tabs.length - 1) % tabs.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = tabs.length - 1;
    else return;
    event.preventDefault();
    setTab(tabs[next]);
    document.getElementById(`${id}-tab-${tabs[next]}`)?.focus();
  }

  return <section className="collab-project" aria-label={`${project.name} collaboration`}>
    <header className="collab-project-header"><div><p className="eyebrow">PROJECT</p><h2>{project.name}</h2></div>
      <div className="collab-actions"><button type="button" className="secondary-button" onClick={() => setShareOpen(true)}><Icon name="user" />Share</button>
        {!readOnly && onCreateIssue && <button type="button" className="primary-button" disabled={loading} onClick={onCreateIssue}><Icon name="plus" />New issue</button>}
      </div>
    </header>
    {readOnly && <ReadOnlyNotice />}
    <div className="collab-tabs" role="tablist" aria-label="Project views">{tabs.map((name, index) => <button key={name} type="button" role="tab" id={`${id}-tab-${name}`} aria-controls={`${id}-panel`} aria-selected={tab === name} tabIndex={tab === name ? 0 : -1} onClick={() => setTab(name)} onKeyDown={(event) => navigateTabs(event, index)}>{name}</button>)}</div>
    <div id={`${id}-panel`} role="tabpanel" aria-labelledby={`${id}-tab-${tab}`} tabIndex={0} aria-busy={loading}>
      {loading ? <CollaborationState title="Loading project…" description="Getting the latest project details." loading /> : <>
        {tab === "Overview" && <Overview {...props} />}
        {(tab === "Issues" || tab === "Board") && <>
          <div className="collab-issue-toolbar"><label className="collab-search"><Icon name="search" aria-hidden="true" /><input type="search" aria-label="Find an issue" placeholder="Find an issue" value={query} onChange={(event) => setQuery(event.target.value)} /></label><span className="collab-muted">{visibleIssues.length} issues</span></div>
          {!visibleIssues.length ? <CollaborationState title={query ? "No matching issues" : "No issues yet"} description={query ? "Try a different title or issue number." : "Break the project into a few concrete next steps."} /> : tab === "Issues" ? <div className="collab-issue-list">{visibleIssues.map((issue) => <IssueCard key={issue.id} issue={issue} stateName={stateName(issue)} onOpen={onOpenIssue} />)}</div> : <div className="collab-board">{columns.map((column) => <section key={column.id} className="collab-board-column" aria-label={column.name}><h3><span>{column.name}</span><small>{column.issues.length}</small></h3>{column.issues.map((issue) => <IssueCard key={issue.id} issue={issue} stateName={stateName(issue)} onOpen={onOpenIssue} />)}{!column.issues.length && <p className="collab-muted">No issues in this state.</p>}</section>)}</div>}
        </>}
        {tab === "Cycles" && (cycles.length ? <div className="collab-cycle-list">{cycles.map((cycle) => <article className="collab-panel" key={cycle.id}><div className="collab-cycle-heading"><h3>{cycle.name}</h3><span className="collab-chip">{cycle.phase}</span></div><p className="collab-muted">{cycle.dateLabel}</p><p>{cycle.completedCount} of {cycle.issueCount} issues complete{cycle.capacity !== undefined && ` · Capacity ${cycle.capacity}`}</p><progress className="collab-progress" aria-label={`${cycle.name} completion`} value={cycle.completedCount} max={cycle.issueCount || 1} /></article>)}</div> : <CollaborationState title="No cycles planned" description="Current and upcoming cycles will help the team plan its next stretch of work." />)}
      </>}
    </div>
    {shareOpen && <ProjectShareDialog {...sharing} loading={loading || sharing.loading} canManage={!readOnly && sharing.canManage} projectName={project.name} onClose={() => setShareOpen(false)} />}
  </section>;
}
