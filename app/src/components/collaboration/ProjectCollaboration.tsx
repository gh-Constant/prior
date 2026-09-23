import { useId, useRef, useState } from "react";
import { ContextMenu, useContextMenu, type ContextMenuItem } from "../ContextMenu";
import { Icon } from "../Icon";
import { DEFAULT_PROJECT_ICON } from "../WorkspaceIcon";
import { EditableIcon } from "../IconPicker";
import { CollaborationState, ReadOnlyNotice } from "./CollaborationState";
import { ProjectShareDialog } from "./ProjectShareDialog";
import { PersonAvatar } from "./PersonAvatar";
import { AgilePropertyChips, PeopleChips } from "./TaskPlanning";
import { useI18n } from "../../lib/i18n";
import { AvatarStack, PROJECT_STATUS_LABELS, PriorityGlyph, ProjectStatusChip, StatusGlyph, UsersGlyph, projectTintStyle, statusGlyphKind } from "../ProjectVisuals";
import { ProjectDetailHeader, ProjectStatsStrip, ProjectTabs, ProjectTypeChip, type ProjectTabItem } from "../ProjectDetailParts";
import type { ProjectCollaborationProps, ProjectIssue, WorkflowState } from "./types";
import "./Collaboration.css";

const tabs = ["Board", "Issues", "Overview", "Cycles"] as const;
type Tab = typeof tabs[number];

function issueMenuItems(issue: ProjectIssue, t: (key: string, vars?: Record<string, string | number>) => string, onOpen?: (id: string) => void, onDelete?: (id: string) => void): ContextMenuItem[] {
  return [
    ...(onOpen ? [{ icon: "file" as const, label: t("collab.issue.openFor", { title: issue.title }), run: () => onOpen(issue.id) }] : []),
    ...(onDelete ? [{ icon: "trash" as const, label: t("collab.issue.deleteFor", { title: issue.title }), danger: true, run: () => onDelete(issue.id) }] : []),
  ];
}

/** Row used by the Issues list: full property chips and people. */
function IssueCard({ issue, stateName, state, onOpen, onDelete }: {
  issue: ProjectIssue; stateName: string; state?: WorkflowState; onOpen?: (id: string) => void; onDelete?: (id: string) => void;
}) {
  const { menu, openMenu, closeMenu, longPress } = useContextMenu();
  const { t } = useI18n();
  const menuItems = issueMenuItems(issue, t, onOpen, onDelete);
  return <article className="collab-issue"
    onContextMenu={menuItems.length ? (event) => openMenu(event, menuItems) : undefined}
    {...(menuItems.length ? longPress(() => menuItems) : {})}
  >
    <div className="collab-issue-heading">{issue.identifier && <small>{issue.identifier}</small>}
      {onOpen ? <button type="button" onClick={() => onOpen(issue.id)}>{issue.title}</button> : <strong>{issue.title}</strong>}
    </div>
    <AgilePropertyChips state={state} priority={issue.priority} properties={[{ key: "state", label: stateName }, ...(issue.properties ?? []).filter((property) => property.key !== "state")]} />
    <PeopleChips people={issue.people} />
    {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={closeMenu} />}
  </article>;
}

/** Compact board card: title, priority, cycle/labels and the lead person. */
function BoardIssueCard({ issue, completed, onOpen, onDelete, busy, onDrag, onDragEnd }: {
  issue: ProjectIssue; completed: boolean; onOpen?: (id: string) => void; onDelete?: (id: string) => void;
  busy: boolean; onDrag?: (id: string) => void; onDragEnd: () => void;
}) {
  const { menu, openMenu, closeMenu, longPress } = useContextMenu();
  const { t } = useI18n();
  const menuItems = issueMenuItems(issue, t, onOpen, onDelete);
  const lead = issue.people.find((person) => person.role === "owner") ?? issue.people[0];
  const chips = (issue.properties ?? []).filter((property) => property.key === "cycle" || property.key === "labels" || property.key === "milestone");
  const body = <>
    <span className="board-card-title">{issue.identifier && <small>{issue.identifier}</small>}{issue.title}</span>
    <span className="board-card-meta">
      {issue.priority !== undefined && <PriorityGlyph priority={issue.priority} />}
      {chips.map((property, index) => <span className="project-chip" key={`${property.key}-${index}`}><Icon name={property.key === "cycle" ? "refresh" : property.key === "milestone" ? "flag" : "tag"} />{property.label}</span>)}
      {lead && <PersonAvatar person={lead} className="project-avatar board-card-avatar" showPresence={false} />}
    </span>
  </>;
  return <article className={`board-card collab-issue-card${completed ? " is-done" : ""}`} draggable={Boolean(onDrag) && !busy} onDragStart={(event) => {
    if (!onDrag || busy) { event.preventDefault(); return; }
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", issue.id);
    onDrag(issue.id);
  }} onDragEnd={onDragEnd}
    onContextMenu={menuItems.length ? (event) => openMenu(event, menuItems) : undefined}
    {...(menuItems.length ? longPress(() => menuItems) : {})}
  >
    {onOpen ? <button type="button" className="board-card-open" onClick={() => onOpen(issue.id)}>{body}</button> : <div className="board-card-open">{body}</div>}
    {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={closeMenu} />}
  </article>;
}

function Overview({ project, issues, states, sharing, overview = {}, onOpenNotes }: ProjectCollaborationProps) {
  const { t, tp } = useI18n();
  const completed = issues.filter((issue) => states.some((state) => state.id === issue.stateId && state.category === "completed")).length;
  const progress = issues.length ? Math.round(completed / issues.length * 100) : 0;
  const notSet = t("collab.overview.notSet");
  const health = project.health ?? overview.health;
  const healthLabel = health === "On track" ? t("collab.editor.healthOnTrack") : health === "At risk" ? t("collab.editor.healthAtRisk") : health === "Off track" ? t("collab.editor.healthOffTrack") : notSet;
  return <div className="collab-overview">
    <section className="collab-panel"><h3>{t("collab.overview.brief")}</h3><p className="collab-brief">{project.description || t("collab.overview.briefEmpty")}</p>
      <dl className="collab-metadata"><div><dt>{t("collab.overview.status")}</dt><dd>{t(PROJECT_STATUS_LABELS[project.status])}</dd></div><div><dt>{t("collab.overview.health")}</dt><dd>{healthLabel}</dd></div><div><dt>{t("collab.overview.start")}</dt><dd>{overview.startDate ?? notSet}</dd></div><div><dt>{t("collab.overview.target")}</dt><dd>{project.targetDate ?? overview.targetDate ?? notSet}</dd></div></dl>
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
  const { project, issues, states, cycles, sharing, overview, loading = false, readOnly = true, onCreateIssue, onOpenIssue, onDeleteIssue, onEditProject, onMoveIssue, onCreateCycle, onEditCycle } = props;
  const { menu, openMenu, closeMenu, longPress } = useContextMenu();
  const [tab, setTab] = useState<Tab>("Board");
  const { t, tp } = useI18n();
  const tabItems: ProjectTabItem<Tab>[] = [
    { id: "Board", label: t("collab.tabs.board"), icon: "columns" },
    { id: "Issues", label: t("collab.tabs.issues"), icon: "list" },
    { id: "Overview", label: t("collab.tabs.overview"), icon: "eye" },
    { id: "Cycles", label: t("collab.tabs.cycles"), icon: "refresh" },
  ];
  const [shareOpen, setShareOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [moving, setMoving] = useState(false);
  const pendingMove = useRef(false);
  const draggedIssue = useRef<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [moveError, setMoveError] = useState("");
  const panelId = useId();
  const visibleIssues = issues.filter((issue) => `${issue.identifier ?? ""} ${issue.title}`.toLowerCase().includes(query.trim().toLowerCase()));
  const stateName = (issue: ProjectIssue) => states.find((state) => state.id === issue.stateId)?.name ?? t("collab.issue.unassigned");
  const isCompleted = (issue: ProjectIssue) => states.some((state) => state.id === issue.stateId && state.category === "completed");
  const unassigned = visibleIssues.filter((issue) => !states.some((state) => state.id === issue.stateId));
  const columns = [...states.map((state) => ({ id: state.id, name: state.name, state, issues: visibleIssues.filter((issue) => issue.stateId === state.id) })), ...(unassigned.length ? [{ id: "__unassigned", name: t("collab.issue.unassigned"), state: undefined, issues: unassigned }] : [])];
  const canMove = !readOnly && !loading && Boolean(onMoveIssue);
  const completedCount = issues.filter(isCompleted).length;
  const progress = { completed: completedCount, total: issues.length, percent: issues.length ? Math.round((completedCount / issues.length) * 100) : 0 };
  const activeCycle = cycles.find((cycle) => cycle.phase === "current") ?? null;

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

  const headerMenuItems: ContextMenuItem[] = [
    ...(!readOnly && onEditProject ? [{ icon: "pencil" as const, label: t("collab.header.editProjectFor", { name: project.name }), run: onEditProject }] : []),
    { icon: "user" as const, label: t("collab.header.shareManage"), run: () => setShareOpen(true) },
    ...(!readOnly && onCreateIssue ? [{ icon: "plus" as const, label: t("collab.header.newIssue"), run: () => onCreateIssue() }] : []),
    ...(!readOnly && onCreateCycle ? [{ icon: "refresh" as const, label: t("collab.header.newCycle"), run: onCreateCycle }] : []),
    ...(props.onOpenNotes ? [{ icon: "file-text" as const, label: t("collab.header.openNotes"), run: props.onOpenNotes }] : []),
  ];

  return <section className="collab-project" aria-label={t("collab.section.label", { name: project.name })}>
    <ProjectDetailHeader
      icon={<span className="project-tile-host" style={projectTintStyle(project.id)}><EditableIcon icon={project.icon} fallback={project.projectType === "software" ? "code" : DEFAULT_PROJECT_ICON} canEdit={!readOnly && Boolean(onEditProject)} readOnly={readOnly} onOpen={onEditProject} label={t("collab.header.editIconFor", { name: project.name })} className="project-tile size-lg" /></span>}
      title={project.name}
      chips={<><ProjectStatusChip status={project.status} /><ProjectTypeChip software cycleName={activeCycle?.name} /></>}
      description={project.description}
      aside={<AvatarStack people={sharing.members} max={5} size="md" label={t("collab.header.people")} />}
      actions={<>
        <button type="button" className="secondary-button" onClick={() => setShareOpen(true)}><UsersGlyph />{t("collab.header.share")}</button>
        {!readOnly && onEditProject && <button type="button" className="secondary-button project-edit-button" disabled={loading} aria-label={t("collab.header.editProject")} title={t("collab.header.editProject")} onClick={onEditProject}><Icon name="pencil" /><span>{t("collab.header.editProject")}</span></button>}
        {!readOnly && tab !== "Cycles" && onCreateIssue && <button type="button" className="primary-button" disabled={loading} onClick={() => onCreateIssue()}><Icon name="plus" /><span>{t("collab.header.newIssue")}</span></button>}
        {!readOnly && tab === "Cycles" && onCreateCycle && <button type="button" className="primary-button" disabled={loading} onClick={onCreateCycle}><Icon name="plus" /><span>{t("collab.header.newCycle")}</span></button>}
      </>}
      headerProps={{ onContextMenu: (event) => openMenu(event, headerMenuItems), ...longPress(() => headerMenuItems) }}
    />
    {readOnly && <ReadOnlyNotice />}
    {moveError && <p className="collab-error" role="alert">{moveError}</p>}
    <ProjectStatsStrip progress={progress} targetDate={project.targetDate ?? overview?.targetDate} cycle={activeCycle?.endsOn ? { name: activeCycle.name, endsOn: activeCycle.endsOn } : null} health={project.health ?? overview?.health} completed={project.status === "completed"} />
    <ProjectTabs tabs={tabItems} active={tab} onChange={setTab} label={t("collab.views.label")} panelId={panelId} />
    <div id={panelId} className="project-tab-panel" role="tabpanel" aria-label={tabItems.find((item) => item.id === tab)?.label} tabIndex={0} aria-busy={loading}>
      {loading ? <CollaborationState title={t("collab.loading.title")} description={t("collab.loading.hint")} loading /> : <>
        {tab === "Overview" && <Overview {...props} />}
        {(tab === "Issues" || tab === "Board") && <>
          <div className="collab-issue-toolbar"><label className="collab-search"><Icon name="search" aria-hidden="true" /><input type="search" aria-label={t("collab.issue.search")} placeholder={t("collab.issue.search")} value={query} onChange={(event) => setQuery(event.target.value)} /></label><span className="collab-muted">{tp("collab.issue.count", visibleIssues.length)}</span></div>
          {tab === "Issues" ? <>
            {!visibleIssues.length && <CollaborationState title={query ? t("collab.issue.noMatchTitle") : t("collab.issue.emptyTitle")} description={query ? t("collab.issue.noMatchHint") : t("collab.issue.emptyHint")} />}
            <div className="collab-issue-list">{visibleIssues.map((issue) => <IssueCard key={issue.id} issue={issue} stateName={stateName(issue)} state={states.find((state) => state.id === issue.stateId)} onOpen={onOpenIssue} onDelete={!readOnly ? onDeleteIssue : undefined} />)}</div>
          </> : <div className="project-board collab-board" aria-busy={moving}>{columns.map((column) => <section key={column.id} className={`project-board-column${dropTarget === column.id ? " is-drop-target collab-drop-target" : ""}`} aria-label={column.name}
            onDragOver={(event) => { if (canMove && !moving && draggedIssue.current && states.some((state) => state.id === column.id)) { event.preventDefault(); event.dataTransfer.dropEffect = "move"; setDropTarget(column.id); } }}
            onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropTarget(null); }}
            onDrop={(event) => { event.preventDefault(); const issueId = draggedIssue.current; endDrag(); if (issueId) void moveIssue(issueId, column.id); }}>
            <header className="project-board-column-heading">
              <StatusGlyph kind={statusGlyphKind(column.state?.id, column.state?.category)} />
              <h3>{column.name}</h3>
              <span className="project-board-count">{column.issues.length}</span>
              {!readOnly && onCreateIssue && column.state && <button type="button" className="project-board-add" disabled={loading} aria-label={t("common.projectHub.addTaskIn", { status: column.name })} title={t("common.projectHub.addTaskIn", { status: column.name })} onClick={() => onCreateIssue(column.id)}><Icon name="plus" /></button>}
            </header>
            <div className="project-board-cards">
              {column.issues.map((issue) => <BoardIssueCard key={issue.id} issue={issue} completed={column.state?.category === "completed" || column.state?.category === "canceled"} onOpen={onOpenIssue} onDelete={!readOnly ? onDeleteIssue : undefined} busy={moving} onDrag={canMove ? (issueId) => { draggedIssue.current = issueId; } : undefined} onDragEnd={endDrag} />)}
              {!column.issues.length && <div className="project-board-empty">{t("collab.issue.emptyTitle")}</div>}
            </div>
          </section>)}</div>}
        </>}
        {tab === "Cycles" && (cycles.length ? <div className="collab-cycle-list">{cycles.map((cycle) => {
          const assigned = issues.filter((issue) => cycle.issueIds?.includes(issue.id));
          const count = cycle.issueIds ? assigned.length : cycle.issueCount;
          const completed = cycle.issueIds ? assigned.filter(isCompleted).length : cycle.completedCount;
          const dates = cycle.startsOn || cycle.endsOn ? `${cycle.startsOn || t("collab.cycle.noStart")} – ${cycle.endsOn || t("collab.cycle.noEnd")}` : cycle.dateLabel;
          return <article
            className={`collab-panel collab-cycle is-${cycle.phase}`}
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
