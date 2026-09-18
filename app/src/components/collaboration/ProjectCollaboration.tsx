import { useId, useRef, useState, type KeyboardEvent } from "react";
import { ContextMenu, useContextMenu } from "../ContextMenu";
import { Icon } from "../Icon";
import { DEFAULT_PROJECT_ICON } from "../WorkspaceIcon";
import { EditableIcon } from "../IconPicker";
import { CollaborationState, ReadOnlyNotice } from "./CollaborationState";
import { ProjectShareDialog } from "./ProjectShareDialog";
import { PersonAvatar } from "./PersonAvatar";
import { AgilePropertyChips, PeopleChips } from "./TaskPlanning";
import { useI18n } from "../../lib/i18n";
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
  const { t } = useI18n();
  const menuItems = [
    ...(onOpen ? [{ icon: "file" as const, label: t("collab.issue.openFor", { title: issue.title }), run: () => onOpen(issue.id) }] : []),
    ...(onDelete ? [{ icon: "trash" as const, label: t("collab.issue.deleteFor", { title: issue.title }), danger: true, run: () => onDelete(issue.id) }] : []),
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
  const { t, tp } = useI18n();
  const completed = issues.filter((issue) => states.some((state) => state.id === issue.stateId && state.category === "completed")).length;
  const progress = issues.length ? Math.round(completed / issues.length * 100) : 0;
  const notSet = t("collab.overview.notSet");
  return <div className="collab-overview">
    <section className="collab-panel"><h3>{t("collab.overview.brief")}</h3><p className="collab-brief">{project.description || t("collab.overview.briefEmpty")}</p>
      <dl className="collab-metadata"><div><dt>{t("collab.overview.status")}</dt><dd>{project.status}</dd></div><div><dt>{t("collab.overview.health")}</dt><dd>{overview.health ?? notSet}</dd></div><div><dt>{t("collab.overview.start")}</dt><dd>{overview.startDate ?? notSet}</dd></div><div><dt>{t("collab.overview.target")}</dt><dd>{overview.targetDate ?? notSet}</dd></div></dl>
      <div className="collab-progress-label"><span>{tp("collab.overview.progress", completed, { completed, total: issues.length })}</span><strong>{progress}%</strong></div>
      <progress className="collab-progress" value={completed} max={issues.length || 1} aria-label={t("collab.overview.completion")} />
    </section>
    <section className="collab-panel"><h3>{t("collab.people.label")}</h3><p className="collab-muted">{t("collab.overview.lead", { lead: overview.lead?.name ?? t("collab.overview.leadUnassigned") })}</p><PeopleChips people={sharing.members} /></section>
    {!!overview.milestones?.length && <section className="collab-panel"><h3>{t("collab.overview.milestones")}</h3><ul className="collab-milestones">{overview.milestones.map((milestone) => <li key={milestone.id}><Icon name={milestone.completed ? "check-circle" : "flag"} aria-hidden="true" /><span>{milestone.name}</span><small>{milestone.completed ? t("collab.overview.milestoneComplete") : t("collab.overview.milestoneOpen")}</small></li>)}</ul></section>}
    {overview.latestUpdate && <section className="collab-panel"><h3>{t("collab.overview.latestUpdate")}</h3><p className="collab-brief">{overview.latestUpdate}</p></section>}
    <section className="collab-panel"><h3>{t("collab.overview.resources")}</h3>{overview.resources?.length ? <ul className="collab-resources">{overview.resources.map((resource) => <li key={resource.id}>{/^https?:\/\//i.test(resource.href) ? <a href={resource.href} target="_blank" rel="noreferrer"><Icon name="link" aria-hidden="true" />{resource.label}</a> : <span>{resource.label}</span>}</li>)}</ul> : <p className="collab-muted">{t("collab.overview.noResources")}</p>}{onOpenNotes && <button type="button" className="secondary-button" onClick={onOpenNotes}><Icon name="file-text" />{t("collab.overview.openNotes")}</button>}</section>
  </div>;
}

export function ProjectCollaboration(props: ProjectCollaborationProps) {
  const { project, issues, states, cycles, sharing, loading = false, readOnly = true, onCreateIssue, onOpenIssue, onDeleteIssue, onEditProject, onMoveIssue, onCreateCycle, onEditCycle } = props;
  const { menu, openMenu, closeMenu, longPress } = useContextMenu();
  const [tab, setTab] = useState<Tab>("Overview");
  const { t, tp } = useI18n();
  const tabLabels: Record<Tab, string> = {
    Overview: t("collab.tabs.overview"),
    Issues: t("collab.tabs.issues"),
    Board: t("collab.tabs.board"),
    Cycles: t("collab.tabs.cycles"),
  };
  const [shareOpen, setShareOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [moving, setMoving] = useState(false);
  const pendingMove = useRef(false);
  const draggedIssue = useRef<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [moveError, setMoveError] = useState("");
  const id = useId();
  const visibleIssues = issues.filter((issue) => `${issue.identifier ?? ""} ${issue.title}`.toLowerCase().includes(query.trim().toLowerCase()));
  const stateName = (issue: ProjectIssue) => states.find((state) => state.id === issue.stateId)?.name ?? t("collab.issue.unassigned");
  const unassigned = visibleIssues.filter((issue) => !states.some((state) => state.id === issue.stateId));
  const columns = [...states.map((state) => ({ id: state.id, name: state.name, issues: visibleIssues.filter((issue) => issue.stateId === state.id) })), ...(unassigned.length ? [{ id: "__unassigned", name: t("collab.issue.unassigned"), issues: unassigned }] : [])];
  const canMove = !readOnly && !loading && Boolean(onMoveIssue);

  async function moveIssue(issueId: string, stateId: string) {
    const issue = issues.find((item) => item.id === issueId);
    const state = states.find((item) => item.id === stateId);
    if (!canMove || !onMoveIssue || pendingMove.current || !issue || !state || issue.stateId === stateId) return;
    pendingMove.current = true;
    setMoving(true);
    setMoveError("");
    try { await onMoveIssue(issueId, stateId); }
    catch (cause) { setMoveError(cause instanceof Error ? cause.message : t("collab.issue.moveError")); }
    finally { pendingMove.current = false; setMoving(false); }
  }

  function endDrag() { draggedIssue.current = null; setDropTarget(null); }
  function issueCard(issue: ProjectIssue, draggable = false) {
    return <IssueCard key={issue.id} issue={issue} stateName={stateName(issue)} onOpen={onOpenIssue} onDelete={!readOnly ? onDeleteIssue : undefined} busy={moving} onDrag={canMove && draggable ? (issueId) => { draggedIssue.current = issueId; } : undefined} onDragEnd={endDrag} />;
  }

  const headerMenuItems = [
    ...(!readOnly && onEditProject ? [{ icon: "pencil" as const, label: t("collab.header.editProjectFor", { name: project.name }), run: onEditProject }] : []),
    { icon: "user" as const, label: t("collab.header.shareManage"), run: () => setShareOpen(true) },
    ...(!readOnly && onCreateIssue ? [{ icon: "plus" as const, label: t("collab.header.newIssue"), run: onCreateIssue }] : []),
    ...(!readOnly && onCreateCycle ? [{ icon: "refresh" as const, label: t("collab.header.newCycle"), run: onCreateCycle }] : []),
    ...(props.onOpenNotes ? [{ icon: "file-text" as const, label: t("collab.header.openNotes"), run: props.onOpenNotes }] : []),
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

  return <section className="collab-project" aria-label={t("collab.section.label", { name: project.name })}>
    <header
      className="collab-project-header"
      onContextMenu={(event) => openMenu(event, headerMenuItems)}
      {...longPress(() => headerMenuItems)}
    ><div className="collab-project-heading"><EditableIcon icon={project.icon} fallback={DEFAULT_PROJECT_ICON} canEdit={!readOnly && Boolean(onEditProject)} readOnly={readOnly} onOpen={onEditProject} label={t("collab.header.editIconFor", { name: project.name })} className="collab-project-icon" /><div><p className="eyebrow">{t("collab.header.eyebrow")}</p><h2>{project.name}</h2></div></div>
      <div className="collab-actions"><button type="button" className="secondary-button" onClick={() => setShareOpen(true)}><Icon name="user" />{t("collab.header.share")}</button>
        <div className="collab-avatar-stack" role="group" aria-label={t("collab.header.people")}>{sharing.members.slice(0, 5).map((person) => <span key={person.id} role="img" aria-label={person.name}><PersonAvatar person={person} /></span>)}{sharing.members.length > 5 && <span className="collab-avatar" aria-label={tp("collab.header.moreMembers", sharing.members.length - 5)}>+{sharing.members.length - 5}</span>}</div>
        {!readOnly && onEditProject && <button type="button" className="secondary-button" disabled={loading} onClick={onEditProject}><Icon name="pencil" />{t("collab.header.editProject")}</button>}
        {!readOnly && tab !== "Cycles" && onCreateIssue && <button type="button" className="primary-button" disabled={loading} onClick={onCreateIssue}><Icon name="plus" />{t("collab.header.newIssue")}</button>}
        {!readOnly && tab === "Cycles" && onCreateCycle && <button type="button" className="primary-button" disabled={loading} onClick={onCreateCycle}><Icon name="plus" />{t("collab.header.newCycle")}</button>}
      </div>
    </header>
    {readOnly && <ReadOnlyNotice />}
    {moveError && <p className="collab-error" role="alert">{moveError}</p>}
    <div className="collab-tabs" role="tablist" aria-label={t("collab.views.label")}>{tabs.map((name, index) => <button key={name} type="button" role="tab" id={`${id}-tab-${name}`} aria-controls={`${id}-panel`} aria-selected={tab === name} tabIndex={tab === name ? 0 : -1} onClick={() => setTab(name)} onKeyDown={(event) => navigateTabs(event, index)}>{tabLabels[name]}</button>)}</div>
    <div id={`${id}-panel`} role="tabpanel" aria-labelledby={`${id}-tab-${tab}`} tabIndex={0} aria-busy={loading}>
      {loading ? <CollaborationState title={t("collab.loading.title")} description={t("collab.loading.hint")} loading /> : <>
        {tab === "Overview" && <Overview {...props} />}
        {(tab === "Issues" || tab === "Board") && <>
          <div className="collab-issue-toolbar"><label className="collab-search"><Icon name="search" aria-hidden="true" /><input type="search" aria-label={t("collab.issue.search")} placeholder={t("collab.issue.search")} value={query} onChange={(event) => setQuery(event.target.value)} /></label><span className="collab-muted">{tp("collab.issue.count", visibleIssues.length)}</span></div>
          {tab === "Issues" ? <>
            {!visibleIssues.length && <CollaborationState title={query ? t("collab.issue.noMatchTitle") : t("collab.issue.emptyTitle")} description={query ? t("collab.issue.noMatchHint") : t("collab.issue.emptyHint")} />}
            <div className="collab-issue-list">{visibleIssues.map((issue) => issueCard(issue))}</div>
          </> : <>
            <div className="collab-board" aria-busy={moving}>{columns.map((column) => <section key={column.id} className={`collab-board-column${dropTarget === column.id ? " collab-drop-target" : ""}`} aria-label={column.name}
              onDragOver={(event) => { if (canMove && !moving && draggedIssue.current && states.some((state) => state.id === column.id)) { event.preventDefault(); event.dataTransfer.dropEffect = "move"; setDropTarget(column.id); } }}
              onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropTarget(null); }}
              onDrop={(event) => { event.preventDefault(); const issueId = draggedIssue.current; endDrag(); if (issueId) void moveIssue(issueId, column.id); }}>
              <h3><span>{column.name}</span><small>{column.issues.length}</small></h3>{column.issues.map((issue) => issueCard(issue, true))}{!column.issues.length && <p className="collab-muted">{t("collab.issue.emptyTitle")}</p>}</section>)}</div>
          </>}
        </>}
        {tab === "Cycles" && (cycles.length ? <div className="collab-cycle-list">{cycles.map((cycle) => {
          const assigned = issues.filter((issue) => cycle.issueIds?.includes(issue.id));
          const count = cycle.issueIds ? assigned.length : cycle.issueCount;
          const completed = cycle.issueIds ? assigned.filter((issue) => states.some((state) => state.id === issue.stateId && state.category === "completed")).length : cycle.completedCount;
          const dates = cycle.startsOn || cycle.endsOn ? `${cycle.startsOn || t("collab.cycle.noStart")} – ${cycle.endsOn || t("collab.cycle.noEnd")}` : cycle.dateLabel;
          return <article
            className="collab-panel"
            key={cycle.id}
            onContextMenu={!readOnly && onEditCycle ? (event) => openMenu(event, [
              { icon: "pencil", label: t("collab.cycle.editFor", { name: cycle.name }), run: () => onEditCycle(cycle.id) },
            ]) : undefined}
            {...(!readOnly && onEditCycle ? longPress(() => [
              { icon: "pencil", label: t("collab.cycle.editFor", { name: cycle.name }), run: () => onEditCycle(cycle.id) },
            ]) : {})}
          ><div className="collab-cycle-heading"><h3>{cycle.name}</h3><span className="collab-chip">{cycle.phase}</span></div><p className="collab-muted">{dates}</p><p>{tp("collab.cycle.progress", completed, { completed, total: count })}{cycle.capacity !== undefined && t("collab.cycle.capacity", { capacity: cycle.capacity })}</p><progress className="collab-progress" aria-label={t("collab.cycle.completionFor", { name: cycle.name })} value={completed} max={count || 1} />{!readOnly && onEditCycle && <button type="button" className="secondary-button collab-cycle-edit" onClick={() => onEditCycle(cycle.id)} aria-label={t("collab.cycle.editFor", { name: cycle.name })}>{t("collab.cycle.edit")}</button>}</article>;
        })}</div> : <CollaborationState title={t("collab.cycle.emptyTitle")} description={t("collab.cycle.emptyHint")} />)}
      </>}
    </div>
    {shareOpen && <ProjectShareDialog {...sharing} loading={loading || sharing.loading} canManage={!readOnly && sharing.canManage} projectName={project.name} onClose={() => setShareOpen(false)} />}
    {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={closeMenu} />}
  </section>;
}
