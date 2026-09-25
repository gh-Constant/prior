import { useId, useMemo, useState, type CSSProperties } from "react";
import type { Area, Project, ProjectStatus, Task } from "../types";
import { useI18n } from "../lib/i18n";
import { ContextMenu, useContextMenu, type ContextMenuItem } from "./ContextMenu";
import { Icon } from "./Icon";
import { DEFAULT_AREA_ICON, WorkspaceIcon } from "./WorkspaceIcon";
import type { Person } from "./collaboration/types";
import {
  AvatarStack, PROJECT_STATUS_LABELS, ProgressBar, ProjectStatusChip, ProjectTile,
  currentCycle, daysBetween, formatPercent, formatShortDate, localDateKey, nextDueDate, projectProgress,
} from "./ProjectVisuals";
import { CalendarGlyph, MoreGlyph } from "./TaskGlyphs";
import "./ProjectsOverview.css";

type Props = {
  areas: Area[];
  projects: Project[];
  /** Tasks used to compute each project's real progress and next due date. */
  tasks?: readonly Task[];
  /** Project members, when known (collaboration workspace). */
  membersByProject?: Readonly<Record<string, readonly Person[]>>;
  query: string;
  onQueryChange: (value: string) => void;
  onOpenProject: (id: string) => void;
  onNewProject: (areaId?: string | null) => void;
  onNewArea: () => void;
  onEditArea: (area: Area) => void;
  onDeleteArea: (area: Area) => void;
  onEditProject: (project: Project) => void;
  onDeleteProject: (project: Project) => void;
};

const statuses = ["all", "active", "planned", "paused", "completed"] as const;
const NO_TASKS: readonly Task[] = [];
const NO_PEOPLE: readonly Person[] = [];

export function ProjectsOverview({ areas, projects, tasks = NO_TASKS, membersByProject, query, onQueryChange, onOpenProject, onNewProject, onNewArea, onEditArea, onDeleteArea, onEditProject, onDeleteProject }: Props) {
  const { t, tp, lang } = useI18n();
  const [status, setStatus] = useState<ProjectStatus | "all">("all");
  const [searchOpen, setSearchOpen] = useState(false);
  const toolbarId = useId();
  const { menu, openMenu, closeMenu, longPress } = useContextMenu();
  const today = localDateKey();
  const tasksByProject = useMemo(() => {
    const map = new Map<string, Task[]>();
    for (const task of tasks) {
      if (!task.projectId || task.deletedAt) continue;
      const list = map.get(task.projectId);
      if (list) list.push(task);
      else map.set(task.projectId, [task]);
    }
    return map;
  }, [tasks]);
  const search = query.trim().toLocaleLowerCase();
  const areaById = new Map(areas.map((area) => [area.id, area]));
  const matching = projects.filter((project) =>
    [project.name, project.description, areaById.get(project.areaId ?? "")?.name ?? ""]
      .some((value) => value.toLocaleLowerCase().includes(search)));
  const filtered = matching.filter((project) => status === "all" || project.status === status);
  const isFiltering = Boolean(search) || status !== "all";
  const toolbarVisible = searchOpen || isFiltering;
  const groups = [
    ...areas.map((area) => ({ id: area.id, name: area.name, area })),
    { id: null, name: t("common.workhub.noArea"), area: undefined },
  ];
  const projectActions = (project: Project): ContextMenuItem[] => [
    { icon: "arrow", label: t("common.workhub.menuOpen", { name: project.name }), run: () => onOpenProject(project.id) },
    { icon: "pencil", label: t("common.workhub.menuEdit", { name: project.name }), run: () => onEditProject(project) },
    { icon: "trash", label: t("common.workhub.menuDelete", { name: project.name }), danger: true, run: () => onDeleteProject(project) },
  ];
  const areaActions = (area: Area): ContextMenuItem[] => [
    { icon: "plus", label: t("common.workhub.menuNewProjectIn", { name: area.name }), run: () => onNewProject(area.id) },
    { icon: "pencil", label: t("common.workhub.menuEditArea", { name: area.name }), run: () => onEditArea(area) },
    { icon: "trash", label: t("common.workhub.menuDeleteArea", { name: area.name }), danger: true, run: () => onDeleteArea(area) },
  ];
  function openMenuFrom(target: HTMLElement, items: ContextMenuItem[]) {
    const bounds = target.getBoundingClientRect();
    openMenu({ clientX: bounds.left, clientY: bounds.bottom + 6, target, preventDefault() {} }, items);
  }
  function resetFilters() {
    onQueryChange("");
    setStatus("all");
  }
  const statusLabel = (value: typeof statuses[number]) => value === "all" ? t("common.workhub.allProjectsFilter") : t(PROJECT_STATUS_LABELS[value]);

  function projectCard(project: Project) {
    const projectTasks = tasksByProject.get(project.id) ?? NO_TASKS;
    const progress = projectProgress(projectTasks);
    const cycle = project.projectType === "software" ? currentCycle(project.cycles, today) : null;
    const target = project.targetDate?.slice(0, 10) || null;
    const due = target ?? nextDueDate(projectTasks);
    const overdue = Boolean(due && project.status !== "completed" && daysBetween(today, due) < 0);
    const members = membersByProject?.[project.id] ?? NO_PEOPLE;
    const dueLabel = due ? t(target ? "common.projectHub.targetDateOn" : "common.projectHub.nextDueOn", { date: formatShortDate(due, lang) }) : "";
    return <article className="projects-card" key={project.id}
      onContextMenu={(event) => openMenu(event, projectActions(project))}
      {...longPress(() => projectActions(project))}>
      <button type="button" className="projects-card-open" aria-label={t("common.workhub.menuOpen", { name: project.name })} onClick={() => onOpenProject(project.id)}>
        <span className="projects-card-head">
          <ProjectTile project={project} />
          <span className="projects-card-title">
            <span className="projects-card-name">{project.name}</span>
            <span className="projects-card-type">
              <span>{t(project.projectType === "software" ? "common.workhub.badgeSoftware" : "common.workhub.badgeStandard")}</span>
              {cycle && <span>{` · ${cycle.name}`}</span>}
            </span>
          </span>
          <span className="projects-card-fraction">{progress.completed}/{progress.total}</span>
        </span>
        {project.description && <span className="projects-card-description">{project.description}</span>}
        <span className="projects-card-progress">
          <span className="projects-card-progress-label">
            <span>{tp("common.projectHub.taskFraction", progress.total, { completed: progress.completed, total: progress.total })}</span>
            <strong>{formatPercent(progress.percent, lang)}</strong>
          </span>
          <ProgressBar percent={progress.percent} />
        </span>
        <span className="projects-card-footer">
          <ProjectStatusChip status={project.status} />
          {due && <span className={`project-chip${overdue ? " is-overdue" : ""}`} title={dueLabel} aria-label={dueLabel}><CalendarGlyph />{formatShortDate(due, lang)}</span>}
          <AvatarStack people={members} label={t("common.projectHub.members")} />
        </span>
      </button>
      <button type="button" className="projects-card-menu" aria-label={t("common.projectHub.projectOptions", { name: project.name })} aria-haspopup="menu" title={t("common.projectHub.projectOptions", { name: project.name })}
        onClick={(event) => openMenuFrom(event.currentTarget, projectActions(project))}><MoreGlyph /></button>
    </article>;
  }

  return <section className={`projects-overview${toolbarVisible ? " is-search-open" : ""}`} aria-label={t("common.views.projects")}>
    <header className="projects-overview-header">
      <div className="projects-overview-intro">
        <h2>{t("common.views.projects")}</h2>
      </div>
      <div className="projects-overview-toolbar" id={toolbarId}>
        <div className="projects-status-filters" role="group" aria-label={t("common.workhub.detailStatusLabel")}>
          {statuses.map((value) => {
            const count = value === "all" ? matching.length : matching.filter((project) => project.status === value).length;
            return <button type="button" key={value} aria-pressed={status === value} onClick={() => setStatus(value)}>
              {statusLabel(value)}
              {(value === "all" || count > 0) && <span>{count}</span>}
            </button>;
          })}
        </div>
        <label className="projects-mobile-status">
          <select value={status} aria-label={t("common.workhub.detailStatusLabel")} onChange={(event) => setStatus(event.target.value as ProjectStatus | "all")}>
            {statuses.map((value) => <option key={value} value={value}>{value === "all" ? t("common.workhub.backToAll") : t(PROJECT_STATUS_LABELS[value])}</option>)}
          </select>
          <Icon name="chevron-down" />
        </label>
        <label className="projects-overview-search">
          <Icon name="search" />
          <input type="search" value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder={t("common.projectHub.searchPlaceholder")} aria-label={t("common.workhub.searchProjectsAndAreas")} />
        </label>
      </div>
      <div className="projects-overview-actions">
        <button type="button" className="secondary-button projects-search-toggle" aria-label={t("common.projectHub.searchToggle")} aria-expanded={toolbarVisible} aria-controls={toolbarId}
          onClick={() => { if (toolbarVisible) { resetFilters(); setSearchOpen(false); } else setSearchOpen(true); }}><Icon name={toolbarVisible ? "close" : "search"} /></button>
        <button type="button" className="secondary-button" aria-label={t("common.workhub.newArea")} onClick={onNewArea}><Icon name="layers" /><span>{t("common.workhub.newArea")}</span></button>
        <button type="button" className="primary-button" aria-label={t("common.workhub.newProject")} onClick={() => onNewProject()}><Icon name="plus" /><span>{t("common.workhub.newProject")}</span></button>
      </div>
    </header>

    {isFiltering && <div className="projects-overview-summary" role="status">
      <span>{tp("common.workhub.overviewProjectCount", filtered.length, { count: filtered.length })}</span>
      <button type="button" onClick={resetFilters}>{t("common.workhub.clearFilters")}<Icon name="close" /></button>
    </div>}

    <div className="projects-overview-groups">
      {groups.map((group) => {
        // Shared projects can refer to an area that is not in this workspace.
        const groupProjects = filtered.filter((project) => (areaById.has(project.areaId ?? "") ? project.areaId : null) === group.id);
        if (!groupProjects.length && (isFiltering || !group.area)) return null;
        const newLabel = groupProjects.length ? t("common.workhub.menuNewProjectIn", { name: group.name }) : t("common.workhub.emptyInline", { label: group.name });
        return <section className="projects-area" key={group.id ?? "__none__"} aria-label={group.name} style={{ "--area-color": group.area?.color || "var(--faint)" } as CSSProperties}>
          <div className="projects-area-heading"
            onContextMenu={group.area ? (event) => openMenu(event, areaActions(group.area!)) : undefined}
            {...(group.area ? longPress(() => areaActions(group.area!)) : {})}>
            <span className="projects-area-icon"><WorkspaceIcon icon={group.area?.icon} fallback={group.area ? DEFAULT_AREA_ICON : "folder"} /></span>
            <h3>{group.name}</h3>
            <span className="projects-area-count">{groupProjects.length}</span>
            <div className="projects-area-actions">
              <button type="button" className="projects-area-add" aria-label={t("common.workhub.menuNewProjectIn", { name: group.name })} onClick={() => onNewProject(group.id)}><Icon name="plus" /><span>{t("common.workhub.projectAction")}</span></button>
              {group.area && <button type="button" className="projects-icon-button" aria-label={t("common.workhub.areaOptions", { name: group.name })} aria-haspopup="menu" onClick={(event) => openMenuFrom(event.currentTarget, areaActions(group.area!))}><MoreGlyph /></button>}
            </div>
          </div>
          <div className="projects-card-grid">
            {groupProjects.map(projectCard)}
            {(!isFiltering || !groupProjects.length) && <button type="button" className={`projects-card-new${groupProjects.length ? "" : " is-empty"}`} onClick={() => onNewProject(group.id)}>
              <Icon name="plus" /><span>{newLabel}</span>
            </button>}
          </div>
        </section>;
      })}
      {!filtered.length && (isFiltering || !areas.length) && <div className="projects-overview-empty">
        <span className="projects-overview-empty-icon"><Icon name={isFiltering ? "search" : "folder"} /></span>
        <h3>{t(isFiltering ? "common.workhub.emptyNoMatch" : "common.workhub.emptyTitle")}</h3>
        <p>{t(isFiltering ? "common.workhub.overviewNoMatchHint" : "common.workhub.emptyHint")}</p>
        <div className="projects-overview-empty-actions">
          {isFiltering
            ? <button type="button" className="secondary-button" onClick={resetFilters}>{t("common.workhub.clearFilters")}</button>
            : <>
              <button type="button" className="secondary-button" onClick={onNewArea}><Icon name="layers" />{t("common.workhub.newArea")}</button>
              <button type="button" className="primary-button" onClick={() => onNewProject()}><Icon name="plus" />{t("common.workhub.newProject")}</button>
            </>}
        </div>
      </div>}
    </div>
    {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={closeMenu} />}
  </section>;
}
