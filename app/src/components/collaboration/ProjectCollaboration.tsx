import { useId, useRef, useState, type KeyboardEvent } from "react";
import { ContextMenu, useContextMenu } from "../ContextMenu";
import { Icon } from "../Icon";
import { DEFAULT_PROJECT_ICON } from "../WorkspaceIcon";
import { EditableIcon } from "../IconPicker";
import { CollaborationState, ReadOnlyNotice } from "./CollaborationState";
import { ProjectShareDialog } from "./ProjectShareDialog";
import { PersonAvatar } from "./PersonAvatar";
import { AgilePropertyChips, PeopleChips } from "./TaskPlanning";
import type { ProjectCollaborationProps, ProjectIssue } from "./types";
import "./Collaboration.css";

const tabs = ["Overview", "Issues", "Board", "Cycles"] as const;
type Tab = typeof tabs[number];

function IssueCard({ issue, stateName, onOpen, onDelete, busy, onDrag, onDragEnd }: {
  issue: ProjectIssue; stateName: string; onOpen?: (id: string) => void; onDelete?: (id: string) => void;
  busy: boolean;
  onDrag?: (id: string) => void; onDragEnd: () => void;
}) {
  const { menu, openMenu, closeMenu, longPress } = useContextMenu();
  const menuItems = [
    ...(onOpen ? [{ icon: "file" as const, label: `Open ${issue.title}`, run: () => onOpen(issue.id) }] : []),
    ...(onDelete ? [{ icon: "trash" as const, label: `Delete ${issue.title}`, danger: true, run: () => onDelete(issue.id) }] : []),
  ];
  return <article className="collab-issue" draggable={Boolean(onDrag) && !busy} onDragStart={(event) => {
    if (!onDrag || busy) { event.preventDefault(); return; }
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", issue.id);
    onDrag(issue.id);
  }} onDragEnd={onDragEnd}
    onContextMenu={menuItems.length ? (event) => openMenu(event, menuItems) : undefined}
    {...(menuItems.length ? longPress(() => menuItems) : {})}
  >
    <div className="collab-issue-heading">{issue.identifier && <small>{issue.identifier}</small>}
      {onOpen ? <button type="button" onClick={() => onOpen(issue.id)}>{issue.title}</button> : <strong>{issue.title}</strong>}
    </div>
    <AgilePropertyChips priority={issue.priority} properties={[{ key: "state", label: stateName }, ...(issue.properties ?? [])]} />
    <PeopleChips people={issue.people} />
    {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={closeMenu} />}
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
    {!!overview.milestones?.length && <section className="collab-panel"><h3>Milestones</h3><ul className="collab-milestones">{overview.milestones.map((milestone) => <li key={milestone.id}><Icon name={milestone.completed ? "check-circle" : "flag"} aria-hidden="true" /><span>{milestone.name}</span><small>{milestone.completed ? "Complete" : "Open"}</small></li>)}</ul></section>}
    {overview.latestUpdate && <section className="collab-panel"><h3>Latest update</h3><p className="collab-brief">{overview.latestUpdate}</p></section>}
    <section className="collab-panel"><h3>Resources</h3>{overview.resources?.length ? <ul className="collab-resources">{overview.resources.map((resource) => <li key={resource.id}>{/^https?:\/\//i.test(resource.href) ? <a href={resource.href} target="_blank" rel="noreferrer"><Icon name="link" aria-hidden="true" />{resource.label}</a> : <span>{resource.label}</span>}</li>)}</ul> : <p className="collab-muted">No resources linked yet.</p>}{onOpenNotes && <button type="button" className="secondary-button" onClick={onOpenNotes}><Icon name="file-text" />Open project notes</button>}</section>
  </div>;
}

export function ProjectCollaboration(props: ProjectCollaborationProps) {
  const { project, issues, states, cycles, sharing, loading = false, readOnly = true, onCreateIssue, onOpenIssue, onDeleteIssue, onEditProject, onMoveIssue, onCreateCycle, onEditCycle } = props;
  const { menu, openMenu, closeMenu, longPress } = useContextMenu();
  const [tab, setTab] = useState<Tab>("Overview");
  const [shareOpen, setShareOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [moving, setMoving] = useState(false);
  const pendingMove = useRef(false);
  const draggedIssue = useRef<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [moveError, setMoveError] = useState("");
  const id = useId();
  const visibleIssues = issues.filter((issue) => `${issue.identifier ?? ""} ${issue.title}`.toLowerCase().includes(query.trim().toLowerCase()));
  const stateName = (issue: ProjectIssue) => states.find((state) => state.id === issue.stateId)?.name ?? "Unassigned state";
  const unassigned = visibleIssues.filter((issue) => !states.some((state) => state.id === issue.stateId));
  const columns = [...states.map((state) => ({ id: state.id, name: state.name, issues: visibleIssues.filter((issue) => issue.stateId === state.id) })), ...(unassigned.length ? [{ id: "__unassigned", name: "Unassigned state", issues: unassigned }] : [])];
  const canMove = !readOnly && !loading && Boolean(onMoveIssue);

  async function moveIssue(issueId: string, stateId: string) {
    const issue = issues.find((item) => item.id === issueId);
    const state = states.find((item) => item.id === stateId);
    if (!canMove || !onMoveIssue || pendingMove.current || !issue || !state || issue.stateId === stateId) return;
    pendingMove.current = true;
    setMoving(true);
    setMoveError("");
    try { await onMoveIssue(issueId, stateId); }
    catch (cause) { setMoveError(cause instanceof Error ? cause.message : "Unable to move issue. Please try again."); }
    finally { pendingMove.current = false; setMoving(false); }
  }

  function endDrag() { draggedIssue.current = null; setDropTarget(null); }
  function issueCard(issue: ProjectIssue, draggable = false) {
    return <IssueCard key={issue.id} issue={issue} stateName={stateName(issue)} onOpen={onOpenIssue} onDelete={!readOnly ? onDeleteIssue : undefined} busy={moving} onDrag={canMove && draggable ? (issueId) => { draggedIssue.current = issueId; } : undefined} onDragEnd={endDrag} />;
  }

  const headerMenuItems = [
    ...(!readOnly && onEditProject ? [{ icon: "pencil" as const, label: `Edit ${project.name}`, run: onEditProject }] : []),
    { icon: "user" as const, label: "Share / manage members", run: () => setShareOpen(true) },
    ...(!readOnly && onCreateIssue ? [{ icon: "plus" as const, label: "New issue", run: onCreateIssue }] : []),
    ...(!readOnly && onCreateCycle ? [{ icon: "refresh" as const, label: "New cycle", run: onCreateCycle }] : []),
    ...(props.onOpenNotes ? [{ icon: "file-text" as const, label: "Open project notes", run: props.onOpenNotes }] : []),
  ];

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
    <header
      className="collab-project-header"
      onContextMenu={(event) => openMenu(event, headerMenuItems)}
      {...longPress(() => headerMenuItems)}
    ><div className="collab-project-heading"><EditableIcon icon={project.icon} fallback={DEFAULT_PROJECT_ICON} canEdit={!readOnly && Boolean(onEditProject)} readOnly={readOnly} onOpen={onEditProject} label={`Edit ${project.name} icon`} className="collab-project-icon" /><div><p className="eyebrow">PROJECT</p><h2>{project.name}</h2></div></div>
      <div className="collab-actions"><button type="button" className="secondary-button" onClick={() => setShareOpen(true)}><Icon name="user" />Share</button>
        <div className="collab-avatar-stack" role="group" aria-label="Project people">{sharing.members.slice(0, 5).map((person) => <span key={person.id} role="img" aria-label={person.name}><PersonAvatar person={person} /></span>)}{sharing.members.length > 5 && <span className="collab-avatar" aria-label={`${sharing.members.length - 5} more members`}>+{sharing.members.length - 5}</span>}</div>
        {!readOnly && onEditProject && <button type="button" className="secondary-button" disabled={loading} onClick={onEditProject}><Icon name="pencil" />Edit project</button>}
        {!readOnly && tab !== "Cycles" && onCreateIssue && <button type="button" className="primary-button" disabled={loading} onClick={onCreateIssue}><Icon name="plus" />New issue</button>}
        {!readOnly && tab === "Cycles" && onCreateCycle && <button type="button" className="primary-button" disabled={loading} onClick={onCreateCycle}><Icon name="plus" />New cycle</button>}
      </div>
    </header>
    {readOnly && <ReadOnlyNotice />}
    {moveError && <p className="collab-error" role="alert">{moveError}</p>}
    <div className="collab-tabs" role="tablist" aria-label="Project views">{tabs.map((name, index) => <button key={name} type="button" role="tab" id={`${id}-tab-${name}`} aria-controls={`${id}-panel`} aria-selected={tab === name} tabIndex={tab === name ? 0 : -1} onClick={() => setTab(name)} onKeyDown={(event) => navigateTabs(event, index)}>{name}</button>)}</div>
    <div id={`${id}-panel`} role="tabpanel" aria-labelledby={`${id}-tab-${tab}`} tabIndex={0} aria-busy={loading}>
      {loading ? <CollaborationState title="Loading project…" description="Getting the latest project details." loading /> : <>
        {tab === "Overview" && <Overview {...props} />}
        {(tab === "Issues" || tab === "Board") && <>
          <div className="collab-issue-toolbar"><label className="collab-search"><Icon name="search" aria-hidden="true" /><input type="search" aria-label="Find an issue" placeholder="Find an issue" value={query} onChange={(event) => setQuery(event.target.value)} /></label><span className="collab-muted">{visibleIssues.length} issues</span></div>
          {tab === "Issues" ? <>
            {!visibleIssues.length && <CollaborationState title={query ? "No matching issues" : "No issues yet"} description={query ? "Try a different title or issue number." : "Break the project into a few concrete next steps."} />}
            <div className="collab-issue-list">{visibleIssues.map((issue) => issueCard(issue))}</div>
          </> : <>
            <div className="collab-board" aria-busy={moving}>{columns.map((column) => <section key={column.id} className={`collab-board-column${dropTarget === column.id ? " collab-drop-target" : ""}`} aria-label={column.name}
              onDragOver={(event) => { if (canMove && !moving && draggedIssue.current && states.some((state) => state.id === column.id)) { event.preventDefault(); event.dataTransfer.dropEffect = "move"; setDropTarget(column.id); } }}
              onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropTarget(null); }}
              onDrop={(event) => { event.preventDefault(); const issueId = draggedIssue.current; endDrag(); if (issueId) void moveIssue(issueId, column.id); }}>
              <h3><span>{column.name}</span><small>{column.issues.length}</small></h3>{column.issues.map((issue) => issueCard(issue, true))}{!column.issues.length && <p className="collab-muted">No issues yet</p>}</section>)}</div>
          </>}
        </>}
        {tab === "Cycles" && (cycles.length ? <div className="collab-cycle-list">{cycles.map((cycle) => {
          const assigned = issues.filter((issue) => cycle.issueIds?.includes(issue.id));
          const count = cycle.issueIds ? assigned.length : cycle.issueCount;
          const completed = cycle.issueIds ? assigned.filter((issue) => states.some((state) => state.id === issue.stateId && state.category === "completed")).length : cycle.completedCount;
          const dates = cycle.startsOn || cycle.endsOn ? `${cycle.startsOn || "No start date"} – ${cycle.endsOn || "No end date"}` : cycle.dateLabel;
          return <article
            className="collab-panel"
            key={cycle.id}
            onContextMenu={!readOnly && onEditCycle ? (event) => openMenu(event, [
              { icon: "pencil", label: `Edit ${cycle.name}`, run: () => onEditCycle(cycle.id) },
            ]) : undefined}
            {...(!readOnly && onEditCycle ? longPress(() => [
              { icon: "pencil", label: `Edit ${cycle.name}`, run: () => onEditCycle(cycle.id) },
            ]) : {})}
          ><div className="collab-cycle-heading"><h3>{cycle.name}</h3><span className="collab-chip">{cycle.phase}</span></div><p className="collab-muted">{dates}</p><p>{completed} of {count} issues complete{cycle.capacity !== undefined && ` · Capacity ${cycle.capacity}`}</p><progress className="collab-progress" aria-label={`${cycle.name} completion`} value={completed} max={count || 1} />{!readOnly && onEditCycle && <button type="button" className="secondary-button collab-cycle-edit" onClick={() => onEditCycle(cycle.id)} aria-label={`Edit ${cycle.name}`}>Edit cycle</button>}</article>;
        })}</div> : <CollaborationState title="No cycles planned" description="Current and upcoming cycles will help the team plan its next stretch of work." />)}
      </>}
    </div>
    {shareOpen && <ProjectShareDialog {...sharing} loading={loading || sharing.loading} canManage={!readOnly && sharing.canManage} projectName={project.name} onClose={() => setShareOpen(false)} />}
    {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={closeMenu} />}
  </section>;
}
