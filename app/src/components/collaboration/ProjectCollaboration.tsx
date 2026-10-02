import { useId, useRef, useState } from "react";
import { ContextMenu, useContextMenu, type ContextMenuItem } from "../ContextMenu";
import { KanbanBoard, type KanbanColumn } from "../kanban/KanbanBoard";
import { Icon } from "../Icon";
import { DEFAULT_PROJECT_ICON } from "../WorkspaceIcon";
import { EditableIcon } from "../IconPicker";
import { CollaborationState, ReadOnlyNotice } from "./CollaborationState";
import { ProjectShareDialog } from "./ProjectShareDialog";
import { PersonAvatar } from "./PersonAvatar";
import { AgilePropertyChips, PeopleChips } from "./TaskPlanning";
import { AssigneeSelect } from "./AssigneeSelect";
import { ProjectActivity } from "./ProjectActivity";
import { useI18n } from "../../lib/i18n";
import { agileFeatures, filterBySprint, sprintStats, velocity, type SprintFilter } from "../../lib/agile";
import { StoryPointsChip } from "../tasks/StoryPoints";
import { AvatarStack, PROJECT_STATUS_LABELS, PriorityGlyph, ProjectStatusChip, UsersGlyph, glyphStatus, localDateKey, projectTintStyle } from "../ProjectVisuals";
import { StatusGlyph } from "../TaskGlyphs";
import { ProjectDetailHeader, ProjectPhoneGroups, ProjectPhoneHeader, ProjectPhoneSummary, ProjectStatsStrip, ProjectTabs, ProjectTypeChip, type ProjectTabItem } from "../ProjectDetailParts";
import { useIsPhone } from "../../lib/useMediaQuery";
import type { Person, ProjectCollaborationProps, ProjectIssue, WorkflowState } from "./types";
import "./Collaboration.css";

const tabs = ["Board", "Issues", "Overview", "Cycles", "Poker", "Activity"] as const;
type Tab = typeof tabs[number];

/** Who issues are shown for: everyone, me, nobody (unassigned) or one person. */
type AssigneeFilter = "all" | "mine" | "unassigned" | { personId: string };

type Assign = { people: readonly Person[]; currentUserId?: string | null; onAssign?: (issueId: string, personId: string | null) => Promise<void> };

function issueMenuItems(issue: ProjectIssue, t: (key: string, vars?: Record<string, string | number>) => string, onOpen?: (id: string) => void, onDelete?: (id: string) => void, assign?: Assign): ContextMenuItem[] {
  const me = assign?.currentUserId;
  return [
    ...(onOpen ? [{ icon: "file" as const, label: t("collab.issue.openFor", { title: issue.title }), run: () => onOpen(issue.id) }] : []),
    ...(assign?.onAssign && me && issue.assigneeId !== me ? [{ icon: "user" as const, label: t("collab.assign.toMe"), run: () => void assign.onAssign?.(issue.id, me) }] : []),
    ...(assign?.onAssign && issue.assigneeId ? [{ icon: "close" as const, label: t("collab.assign.unassign"), run: () => void assign.onAssign?.(issue.id, null) }] : []),
    ...(onDelete ? [{ icon: "trash" as const, label: t("collab.issue.deleteFor", { title: issue.title }), danger: true, run: () => onDelete(issue.id) }] : []),
  ];
}

/** The assignee on a card: a quick picker for editors, an avatar otherwise. */
function IssueAssignee({ issue, assign, busy }: { issue: ProjectIssue; assign?: Assign; busy?: boolean }) {
  const [saving, setSaving] = useState(false);
  if (!assign) return null;
  const person = assign.people.find((candidate) => candidate.id === issue.assigneeId);
  if (!assign.onAssign) return person ? <PersonAvatar person={person} className="collab-avatar collab-avatar-sm" showPresence={false} /> : null;
  return <AssigneeSelect compact taskTitle={issue.title} people={assign.people} currentUserId={assign.currentUserId} value={issue.assigneeId ?? null} disabled={busy || saving} onChange={(personId) => {
    setSaving(true);
    void assign.onAssign?.(issue.id, personId).finally(() => setSaving(false));
  }} />;
}

/** Row used by the Issues list: full property chips and people. */
function IssueCard({ issue, stateName, state, onOpen, onDelete, assign, points }: {
  issue: ProjectIssue; stateName: string; state?: WorkflowState; onOpen?: (id: string) => void; onDelete?: (id: string) => void; assign?: Assign; points?: boolean;
}) {
  const { menu, openMenu, closeMenu, longPress } = useContextMenu();
  const { t } = useI18n();
  const menuItems = issueMenuItems(issue, t, onOpen, onDelete, assign);
  return <article className="collab-issue"
    onContextMenu={menuItems.length ? (event) => openMenu(event, menuItems) : undefined}
    {...(menuItems.length ? longPress(() => menuItems) : {})}
  >
    <div className="collab-issue-heading">{issue.identifier && <small>{issue.identifier}</small>}
      {onOpen ? <button type="button" onClick={() => onOpen(issue.id)}>{issue.title}</button> : <strong>{issue.title}</strong>}
    </div>
    <div className="collab-issue-row-meta">
      <AgilePropertyChips state={state} priority={issue.priority} storyPoints={points ? issue.storyPoints ?? null : undefined} properties={[{ key: "state", label: stateName }, ...(issue.properties ?? []).filter((property) => property.key !== "state")]} />
      {issue.blocked && <span className="collab-chip is-blocked"><Icon name="lock" aria-hidden="true" />{t("collab.issue.blocked")}</span>}
      {issue.subtasks && <span className="collab-chip"><Icon name="list-todo" aria-hidden="true" />{issue.subtasks.done}/{issue.subtasks.total}</span>}
      <IssueAssignee issue={issue} assign={assign} />
    </div>
    {!assign && <PeopleChips people={issue.people} />}
    {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={closeMenu} />}
  </article>;
}

/** Phone row of the Issues list: priority, title, a few facts and the assignee. */
function PhoneIssueRow({ issue, done, onOpen, onDelete, assign, points }: {
  issue: ProjectIssue; done: boolean; onOpen?: (id: string) => void; onDelete?: (id: string) => void; assign?: Assign; points?: boolean;
}) {
  const { menu, openMenu, closeMenu, longPress } = useContextMenu();
  const { t } = useI18n();
  const menuItems = issueMenuItems(issue, t, onOpen, onDelete, assign);
  const facts = (issue.properties ?? []).filter((property) => property.key === "milestone" || property.key === "labels");
  const body = <>
    <span className="phone-issue-title">{issue.title}</span>
    <span className="phone-issue-meta">
      {points && <StoryPointsChip points={issue.storyPoints} variant="project" />}
      {issue.identifier && <small>{issue.identifier}</small>}
      {issue.blocked && <span className="project-chip is-blocked"><Icon name="lock" />{t("collab.issue.blocked")}</span>}
      {issue.subtasks && <span className="project-chip" title={t("collab.issue.subtasks")}><Icon name="list-todo" />{issue.subtasks.done}/{issue.subtasks.total}</span>}
      {facts.map((property, index) => <span className="project-chip" key={`${property.key}-${index}`}><Icon name={property.key === "milestone" ? "flag" : "tag"} /><span className="project-chip-label">{property.label}</span></span>)}
    </span>
  </>;
  return <article className={`phone-issue-row${done ? " is-done" : ""}`}
    onContextMenu={menuItems.length ? (event) => openMenu(event, menuItems) : undefined}
    {...(menuItems.length ? longPress(() => menuItems) : {})}
  >
    {!points && (issue.priority !== undefined ? <PriorityGlyph priority={issue.priority} /> : <span className="phone-issue-glyph-spacer" aria-hidden="true" />)}
    {onOpen ? <button type="button" className="phone-issue-open" onClick={() => onOpen(issue.id)}>{body}</button> : <div className="phone-issue-open">{body}</div>}
    <IssueAssignee issue={issue} assign={assign} />
    {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={closeMenu} />}
  </article>;
}

/** Content of a board card: title, priority, cycle/labels and the lead person. */
function BoardIssueContent({ issue, onOpen, busy, assign, points }: { issue: ProjectIssue; onOpen?: (id: string) => void; busy: boolean; assign?: Assign; points?: boolean }) {
  const { t } = useI18n();
  // Without assignment data (local projects), show the lead person as before.
  const lead = assign ? undefined : issue.people.find((person) => person.role === "owner") ?? issue.people[0];
  const chips = (issue.properties ?? []).filter((property) => property.key === "cycle" || property.key === "labels" || property.key === "milestone" || property.key === "parent");
  const body = <>
    <span className="board-card-title">{issue.identifier && <small>{issue.identifier}</small>}{issue.title}</span>
    <span className="board-card-meta">
      {points ? <StoryPointsChip points={issue.storyPoints} variant="project" /> : issue.priority !== undefined && <PriorityGlyph priority={issue.priority} />}
      {issue.blocked && <span className="project-chip is-blocked" title={t("collab.issue.blocked")}><Icon name="lock" />{t("collab.issue.blocked")}</span>}
      {issue.subtasks && <span className="project-chip" title={t("collab.issue.subtasks")}><Icon name="list-todo" />{issue.subtasks.done}/{issue.subtasks.total}</span>}
      {chips.map((property, index) => <span className="project-chip" key={`${property.key}-${index}`} title={property.key === "parent" ? t("collab.issue.parentOf", { title: property.label }) : undefined}><Icon name={property.key === "cycle" ? "refresh" : property.key === "milestone" ? "flag" : property.key === "parent" ? "arrow" : "tag"} /><span className="project-chip-label">{property.label}</span></span>)}
      {lead && <PersonAvatar person={lead} className="project-avatar board-card-avatar" showPresence={false} />}
    </span>
  </>;
  return <>
    {onOpen ? <button type="button" className="board-card-open" onClick={() => onOpen(issue.id)}>{body}</button> : <div className="board-card-open">{body}</div>}
    {assign && <span className="board-card-assignee" data-kanban-nodrag><IssueAssignee issue={issue} assign={assign} busy={busy} /></span>}
  </>;
}

/** Committed vs done points of a sprint: a bar and one line of figures. */
function SprintPoints({ stats, name }: { stats: ReturnType<typeof sprintStats>; name: string }) {
  const { t, tp } = useI18n();
  return <div className="collab-sprint-points">
    <progress className="collab-progress" aria-label={t("collab.cycle.completionFor", { name })} value={stats.done} max={stats.committed || 1} />
    <p className="collab-sprint-points-line"><strong>{t("scrum.sprint.pointsDone", { done: stats.done, total: stats.committed })}</strong>{stats.unestimated > 0 && <span className="collab-muted">{tp("scrum.sprint.unestimated", stats.unestimated)}</span>}</p>
  </div>;
}

/** Average done points of the last finished sprints. */
function VelocitySummary({ value }: { value: number | null }) {
  const { t } = useI18n();
  return <section className="collab-velocity" aria-label={t("scrum.sprint.velocity")}>
    <Icon name="bar-chart" aria-hidden="true" />
    <div className="collab-velocity-copy">
      <strong>{t("scrum.sprint.velocity")}{value !== null && <span>{t("scrum.sprint.velocityValue", { value })}</span>}</strong>
      <small>{value !== null ? t("scrum.sprint.velocityHint") : t("scrum.sprint.velocityNone")}</small>
    </div>
  </section>;
}

function Overview({ project, issues, states, sharing, overview = {}, onOpenNotes, readOnly, onCreateMilestone, onEditMilestone }: ProjectCollaborationProps) {
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
    {(!!overview.milestones?.length || (!readOnly && onCreateMilestone)) && <section className="collab-panel collab-milestones-panel">
      <div className="collab-cycle-heading"><h3>{t("collab.overview.milestones")}</h3>{!readOnly && onCreateMilestone && <button type="button" className="secondary-button" onClick={onCreateMilestone}><Icon name="plus" />{t("collab.milestone.new")}</button>}</div>
      {overview.milestones?.length ? <ul className="collab-milestones">{overview.milestones.map((milestone) => {
        const percent = milestone.total ? Math.round(((milestone.done ?? 0) / milestone.total) * 100) : 0;
        const content = <>
          <Icon name={milestone.completed ? "check-circle" : "flag"} aria-hidden="true" />
          <span className="collab-milestone-copy"><strong>{milestone.name}</strong><small>{milestone.targetDate ? `${t("collab.milestone.dueOn", { date: milestone.targetDate })} · ` : ""}{milestone.total ? t("collab.milestone.progress", { done: milestone.done ?? 0, total: milestone.total }) : t("collab.milestone.empty")}</small></span>
          <span className="collab-milestone-bar" aria-hidden="true"><span style={{ width: `${percent}%` }} /></span>
          <small>{milestone.completed ? t("collab.overview.milestoneComplete") : `${percent}%`}</small>
        </>;
        return <li key={milestone.id}>{!readOnly && onEditMilestone ? <button type="button" className="collab-milestone-row" onClick={() => onEditMilestone(milestone.id)} aria-label={t("collab.milestone.editFor", { name: milestone.name })}>{content}</button> : <div className="collab-milestone-row">{content}</div>}</li>;
      })}</ul> : <p className="collab-muted">{t("collab.milestone.none")}</p>}
    </section>}
    {overview.latestUpdate && <section className="collab-panel"><h3>{t("collab.overview.latestUpdate")}</h3><p className="collab-brief">{overview.latestUpdate}</p></section>}
    <section className="collab-panel"><h3>{t("collab.overview.resources")}</h3>{overview.resources?.length ? <ul className="collab-resources">{overview.resources.map((resource) => <li key={resource.id}>{/^https?:\/\//i.test(resource.href) ? <a href={resource.href} target="_blank" rel="noreferrer"><Icon name="link" aria-hidden="true" />{resource.label}</a> : <span>{resource.label}</span>}</li>)}</ul> : <p className="collab-muted">{t("collab.overview.noResources")}</p>}{onOpenNotes && <button type="button" className="secondary-button" onClick={onOpenNotes}><Icon name="file-text" />{t("collab.overview.openNotes")}</button>}</section>
  </div>;
}

export function ProjectCollaboration(props: ProjectCollaborationProps) {
  const { project, issues, states, cycles, sharing, overview, loading = false, readOnly = true, offline = false, renderPoker, onCreateIssue, onOpenIssue, onDeleteIssue, onEditProject, onMoveIssue, onCreateCycle, onEditCycle, onTabChange, assignablePeople, currentUserId, onAssignIssue, loadActivity, areaName, onBack } = props;
  const { menu, openMenu, closeMenu, longPress } = useContextMenu();
  const phone = useIsPhone();
  // Phones open on the issues grouped by state: the whole project at a glance.
  const defaultTab: Tab = phone ? "Issues" : "Board";
  const features = agileFeatures(project);
  // Planning Poker is a tab of Scrum and Scrumban projects, once the app hands over its content.
  const pokerTab = features.poker && Boolean(renderPoker);
  const [localTab, setLocalTab] = useState<Tab | null>(null);
  const available = (candidate: Tab | undefined): Tab | undefined => candidate === "Poker" && !pokerTab ? undefined : candidate;
  const controlledTab = available(tabs.find((candidate) => candidate.toLowerCase() === props.tab));
  const tab: Tab = onTabChange ? controlledTab ?? defaultTab : available(localTab ?? undefined) ?? defaultTab;
  const setTab = (next: Tab) => { setLocalTab(next); onTabChange?.(next.toLowerCase()); };
  const { t, tp } = useI18n();
  const cycleLabel = features.sprints ? t("scrum.tabs.sprints") : t("collab.tabs.cycles");
  const boardTab: ProjectTabItem<Tab> = { id: "Board", label: t("collab.tabs.board"), icon: "columns" };
  const issuesTab: ProjectTabItem<Tab> = { id: "Issues", label: t("collab.tabs.issues"), icon: "list" };
  const tabItems: ProjectTabItem<Tab>[] = [
    ...(phone ? [issuesTab, boardTab] : [boardTab, issuesTab]),
    { id: "Overview", label: t("collab.tabs.overview"), icon: "eye" },
    { id: "Cycles", label: cycleLabel, icon: "refresh" },
    ...(pokerTab ? [{ id: "Poker" as const, label: t("scrum.tabs.poker"), icon: "layers" as const }] : []),
    { id: "Activity", label: t("collab.tabs.activity"), icon: "activity" },
  ];
  const [shareOpen, setShareOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [moving, setMoving] = useState(false);
  const pendingMove = useRef(false);
  const [moveError, setMoveError] = useState("");
  const panelId = useId();
  const [assigneeFilter, setAssigneeFilter] = useState<AssigneeFilter>("all");
  const assign: Assign | undefined = assignablePeople?.length ? { people: assignablePeople, currentUserId, onAssign: readOnly || loading ? undefined : onAssignIssue } : undefined;
  const matchesAssignee = (issue: ProjectIssue) => assigneeFilter === "all" ? true
    : assigneeFilter === "mine" ? Boolean(currentUserId) && issue.assigneeId === currentUserId
    : assigneeFilter === "unassigned" ? !issue.assigneeId
    : issue.assigneeId === assigneeFilter.personId;
  const activeCycle = cycles.find((cycle) => cycle.phase === "current") ?? null;
  // Scrum: the lists show the running sprint by default (specs/SCRUM.md).
  const [sprintChoice, setSprintChoice] = useState<SprintFilter | null>(null);
  const showSprintFilter = features.sprints && cycles.length > 0;
  const sprintFilter: SprintFilter = showSprintFilter ? sprintChoice ?? (activeCycle ? "active" : "all") : "all";
  const sprintIssues = showSprintFilter ? filterBySprint(issues, cycles, sprintFilter, activeCycle) : issues;
  const visibleIssues = sprintIssues.filter((issue) => matchesAssignee(issue) && `${issue.identifier ?? ""} ${issue.title}`.toLowerCase().includes(query.trim().toLowerCase()));
  const stateName = (issue: ProjectIssue) => states.find((state) => state.id === issue.stateId)?.name ?? t("collab.issue.unassigned");
  const isCompleted = (issue: ProjectIssue) => states.some((state) => state.id === issue.stateId && state.category === "completed");
  const unassigned = visibleIssues.filter((issue) => !states.some((state) => state.id === issue.stateId));
  const columns = [...states.map((state) => ({ id: state.id, name: state.name, state, issues: visibleIssues.filter((issue) => issue.stateId === state.id) })), ...(unassigned.length ? [{ id: "__unassigned", name: t("collab.issue.unassigned"), state: undefined, issues: unassigned }] : [])];
  const isDone = (issue: ProjectIssue) => states.some((state) => state.id === issue.stateId && (state.category === "completed" || state.category === "canceled"));
  const boardColumns: KanbanColumn<ProjectIssue>[] = columns.map((column) => ({
    id: column.id,
    label: column.name,
    glyph: <StatusGlyph status={glyphStatus(column.state?.id, column.state?.category)} />,
    items: column.issues,
    canAdd: Boolean(column.state),
    canDrop: Boolean(column.state),
  }));
  const canMove = !readOnly && !loading && Boolean(onMoveIssue);
  const completedCount = issues.filter(isCompleted).length;
  const progress = { completed: completedCount, total: issues.length, percent: issues.length ? Math.round((completedCount / issues.length) * 100) : 0 };
  // Why the issue list is empty: a sprint scope with nothing in it says so instead of "no issues yet".
  const emptyIssuesState = showSprintFilter && !query && sprintIssues.length === 0 && issues.length > 0 && ((sprintFilter === "active" && !activeCycle) || sprintFilter === "backlog")
    ? sprintFilter === "backlog" ? { title: t("scrum.sprint.backlogEmptyTitle"), description: t("scrum.sprint.backlogEmptyHint") } : { title: t("scrum.sprint.noActiveTitle"), description: t("scrum.sprint.noActiveHint") }
    : { title: query ? t("collab.issue.noMatchTitle") : t("collab.issue.emptyTitle"), description: query ? t("collab.issue.noMatchHint") : t("collab.issue.emptyHint") };
  const today = localDateKey();
  const sprintIssueRows = issues.map((issue) => ({ id: issue.id, storyPoints: issue.storyPoints, done: isCompleted(issue) }));
  const sprintVelocity = features.sprints ? velocity(cycles, sprintIssueRows, today) : null;

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

  const summary = { progress, targetDate: project.targetDate ?? overview?.targetDate, cycle: activeCycle?.endsOn ? { name: activeCycle.name, endsOn: activeCycle.endsOn } : null, health: project.health ?? overview?.health, completed: project.status === "completed", sprints: features.sprints };
  const projectIcon = <span className="project-tile-host" style={projectTintStyle(project.id)}><EditableIcon icon={project.icon} fallback={project.projectType === "software" ? "code" : DEFAULT_PROJECT_ICON} canEdit={!readOnly && Boolean(onEditProject)} readOnly={readOnly} onOpen={onEditProject} label={t("collab.header.editIconFor", { name: project.name })} className="project-tile size-lg" /></span>;
  const headerMenuItems: ContextMenuItem[] = [
    ...(!readOnly && onEditProject ? [{ icon: "pencil" as const, label: t("collab.header.editProjectFor", { name: project.name }), run: onEditProject }] : []),
    { icon: "user" as const, label: t("collab.header.shareManage"), run: () => setShareOpen(true) },
    ...(!readOnly && onCreateIssue ? [{ icon: "plus" as const, label: t("collab.header.newIssue"), run: () => onCreateIssue() }] : []),
    ...(!readOnly && onCreateCycle ? [{ icon: "refresh" as const, label: features.sprints ? t("scrum.sprint.new") : t("collab.header.newCycle"), run: onCreateCycle }] : []),
    ...(props.onOpenNotes ? [{ icon: "file-text" as const, label: t("collab.header.openNotes"), run: props.onOpenNotes }] : []),
  ];

  return <section className="collab-project" aria-label={t("collab.section.label", { name: project.name })}>
    {phone ? <ProjectPhoneHeader
      icon={projectIcon}
      title={project.name}
      areaName={areaName}
      chips={<><ProjectStatusChip status={project.status} /><ProjectTypeChip software methodology={project.methodology} cycleName={activeCycle?.name} /></>}
      description={project.description}
      members={sharing.members.length > 0 ? <button type="button" className="project-phone-members" aria-label={t("collab.header.shareManage")} onClick={() => setShareOpen(true)}><AvatarStack people={sharing.members} max={3} size="md" label={t("collab.header.people")} /></button> : undefined}
      menuItems={headerMenuItems}
      onBack={onBack ?? (() => window.history.back())}
    >
      <ProjectPhoneSummary {...summary} />
    </ProjectPhoneHeader> : <ProjectDetailHeader
      icon={projectIcon}
      title={project.name}
      chips={<><ProjectStatusChip status={project.status} /><ProjectTypeChip software methodology={project.methodology} cycleName={activeCycle?.name} /></>}
      description={project.description}
      aside={<AvatarStack people={sharing.members} max={5} size="md" label={t("collab.header.people")} />}
      actions={<>
        <button type="button" className="secondary-button" onClick={() => setShareOpen(true)}><UsersGlyph />{t("collab.header.share")}</button>
        {!readOnly && onEditProject && <button type="button" className="secondary-button project-edit-button" disabled={loading} aria-label={t("collab.header.editProject")} title={t("collab.header.editProject")} onClick={onEditProject}><Icon name="pencil" /><span>{t("collab.header.editProject")}</span></button>}
        {!readOnly && tab !== "Cycles" && onCreateIssue && <button type="button" className="primary-button" disabled={loading} onClick={() => onCreateIssue()}><Icon name="plus" /><span>{t("collab.header.newIssue")}</span></button>}
        {!readOnly && tab === "Cycles" && onCreateCycle && <button type="button" className="primary-button" disabled={loading} onClick={onCreateCycle}><Icon name="plus" /><span>{features.sprints ? t("scrum.sprint.new") : t("collab.header.newCycle")}</span></button>}
      </>}
      headerProps={{ onContextMenu: (event) => openMenu(event, headerMenuItems), ...longPress(() => headerMenuItems) }}
      moreItems={headerMenuItems}
    />}
    {offline ? <p className="collab-notice" role="status"><Icon name="lock" aria-hidden="true" />{t("collab.offline.notice")}</p> : readOnly && <ReadOnlyNotice />}
    {moveError && <p className="collab-error" role="alert">{moveError}</p>}
    {!phone && <ProjectStatsStrip {...summary} />}
    <ProjectTabs tabs={tabItems} active={tab} onChange={setTab} label={t("collab.views.label")} panelId={panelId} />
    <div id={panelId} className="project-tab-panel" role="tabpanel" aria-label={tabItems.find((item) => item.id === tab)?.label} tabIndex={0} aria-busy={loading}>
      {loading ? <CollaborationState title={t("collab.loading.title")} description={t("collab.loading.hint")} loading /> : <>
        {tab === "Overview" && <Overview {...props} />}
        {(tab === "Issues" || tab === "Board") && <>
          <div className="collab-issue-toolbar"><label className="collab-search"><Icon name="search" aria-hidden="true" /><input type="search" aria-label={t("collab.issue.search")} placeholder={t("collab.issue.search")} value={query} onChange={(event) => setQuery(event.target.value)} /></label>
            {showSprintFilter && <div className="scope-switch collab-sprint-filter" role="group" aria-label={t("scrum.sprint.filterLabel")}>
              {(["active", "all", "backlog"] as const).map((choice) => <button type="button" key={choice} aria-pressed={sprintFilter === choice} onClick={() => setSprintChoice(choice)}>{t(choice === "active" ? "scrum.sprint.filterActive" : choice === "all" ? "scrum.sprint.filterAll" : "scrum.sprint.filterBacklog")}</button>)}
            </div>}
            {assign && <div className="collab-assignee-filter" role="group" aria-label={t("collab.assign.filter")}>
              <button type="button" className={`collab-chip-btn ${assigneeFilter === "all" ? "selected" : ""}`} aria-pressed={assigneeFilter === "all"} onClick={() => setAssigneeFilter("all")}>{t("collab.assign.filterAll")}</button>
              {currentUserId && <button type="button" className={`collab-chip-btn ${assigneeFilter === "mine" ? "selected" : ""}`} aria-pressed={assigneeFilter === "mine"} onClick={() => setAssigneeFilter("mine")}><Icon name="user" />{t("collab.assign.filterMine")}</button>}
              <button type="button" className={`collab-chip-btn ${assigneeFilter === "unassigned" ? "selected" : ""}`} aria-pressed={assigneeFilter === "unassigned"} onClick={() => setAssigneeFilter("unassigned")}>{t("collab.assign.filterUnassigned")}</button>
              {assign.people.filter((person) => person.id !== currentUserId).slice(0, 6).map((person) => {
                const pressed = typeof assigneeFilter === "object" && assigneeFilter.personId === person.id;
                return <button type="button" key={person.id} className="collab-avatar-btn" aria-pressed={pressed} aria-label={t("collab.assign.filterPerson", { name: person.name })} title={person.name} onClick={() => setAssigneeFilter(pressed ? "all" : { personId: person.id })}><PersonAvatar person={person} className="collab-avatar collab-avatar-sm" showPresence={false} /></button>;
              })}
            </div>}
            <span className="collab-muted">{tp("collab.issue.count", visibleIssues.length)}</span></div>
          {tab === "Issues" ? <>
            {!visibleIssues.length && <CollaborationState {...emptyIssuesState} />}
            {phone ? <ProjectPhoneGroups
              label={t("collab.tabs.issues")}
              groups={columns.map((column) => ({ id: column.id, label: column.name, glyph: <StatusGlyph status={glyphStatus(column.state?.id, column.state?.category)} />, items: column.issues, folded: column.state?.category === "completed" || column.state?.category === "canceled" }))}
              renderItem={(issue) => <PhoneIssueRow issue={issue} done={isDone(issue)} onOpen={onOpenIssue} onDelete={!readOnly ? onDeleteIssue : undefined} assign={assign} points={features.points} />}
            /> : <div className="collab-issue-list">{visibleIssues.map((issue) => <IssueCard key={issue.id} issue={issue} stateName={stateName(issue)} state={states.find((state) => state.id === issue.stateId)} onOpen={onOpenIssue} onDelete={!readOnly ? onDeleteIssue : undefined} assign={assign} points={features.points} />)}</div>}
          </> : <KanbanBoard<ProjectIssue>
            className="collab-board"
            label={t("collab.tabs.board")}
            emptyLabel={t("collab.issue.emptyTitle")}
            dropTargetClassName="collab-drop-target"
            columns={boardColumns}
            canDrag={() => canMove && !moving}
            onMove={moveIssue}
            onAdd={!readOnly && onCreateIssue ? (stateId) => { if (!loading) onCreateIssue(stateId); } : undefined}
            menuItems={(issue) => issueMenuItems(issue, t, onOpenIssue, !readOnly ? onDeleteIssue : undefined, assign)}
            itemClassName={(issue) => `collab-issue-card${isDone(issue) ? " is-done" : ""}`}
            renderCard={(issue) => <BoardIssueContent issue={issue} onOpen={onOpenIssue} busy={moving} assign={assign} points={features.points} />}
          />}
        </>}
        {tab === "Activity" && <ProjectActivity loadActivity={loadActivity} people={assignablePeople?.length ? assignablePeople : sharing.members} currentUserId={currentUserId} />}
        {tab === "Poker" && pokerTab && renderPoker?.()}
        {tab === "Cycles" && (cycles.length ? <>
          {features.sprints && <VelocitySummary value={sprintVelocity} />}
          <div className="collab-cycle-list">{cycles.map((cycle) => {
          const assigned = issues.filter((issue) => cycle.issueIds?.includes(issue.id));
          const count = cycle.issueIds ? assigned.length : cycle.issueCount;
          const completed = cycle.issueIds ? assigned.filter(isCompleted).length : cycle.completedCount;
          const dates = cycle.startsOn || cycle.endsOn ? `${cycle.startsOn || t("collab.cycle.noStart")} – ${cycle.endsOn || t("collab.cycle.noEnd")}` : cycle.dateLabel;
          const stats = features.sprints ? sprintStats(cycle, sprintIssueRows) : null;
          const editMenu = !readOnly && onEditCycle ? [{ icon: "pencil" as const, label: features.sprints ? t("scrum.sprint.editFor", { name: cycle.name }) : t("collab.cycle.editFor", { name: cycle.name }), run: () => onEditCycle(cycle.id) }] : null;
          return <article
            className={`collab-panel collab-cycle is-${cycle.phase}${stats ? " is-sprint" : ""}`}
            key={cycle.id}
            onContextMenu={editMenu ? (event) => openMenu(event, editMenu) : undefined}
            {...(editMenu ? longPress(() => editMenu) : {})}
          ><div className="collab-cycle-heading"><h3>{cycle.name}</h3><span className="collab-chip">{stats ? t(`scrum.sprint.phase.${cycle.phase}`) : cycle.phase}</span></div><p className="collab-muted">{dates}</p><p>{tp("collab.cycle.progress", completed, { completed, total: count })}{cycle.capacity !== undefined && t("collab.cycle.capacity", { capacity: cycle.capacity })}</p>
            {stats && stats.committed > 0 ? <SprintPoints stats={stats} name={cycle.name} /> : <progress className="collab-progress" aria-label={t("collab.cycle.completionFor", { name: cycle.name })} value={completed} max={count || 1} />}
            {!readOnly && onEditCycle && <button type="button" className="secondary-button collab-cycle-edit" onClick={() => onEditCycle(cycle.id)} aria-label={features.sprints ? t("scrum.sprint.editFor", { name: cycle.name }) : t("collab.cycle.editFor", { name: cycle.name })}>{features.sprints ? t("scrum.sprint.edit") : t("collab.cycle.edit")}</button>}</article>;
        })}</div></> : <CollaborationState title={features.sprints ? t("scrum.sprint.emptyTitle") : t("collab.cycle.emptyTitle")} description={features.sprints ? t("scrum.sprint.emptyHint") : t("collab.cycle.emptyHint")} />)}
      </>}
    </div>
    {shareOpen && <ProjectShareDialog {...sharing} loading={loading || sharing.loading} canManage={!readOnly && sharing.canManage} projectName={project.name} onClose={() => setShareOpen(false)} />}
    {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={closeMenu} />}
  </section>;
}
