import { useState, type CSSProperties } from "react";
import type { Area, Project, ProjectStatus } from "../types";
import { useI18n } from "../lib/i18n";
import { ContextMenu, useContextMenu, type ContextMenuItem } from "./ContextMenu";
import { Icon } from "./Icon";
import { DEFAULT_AREA_ICON, DEFAULT_PROJECT_ICON, WorkspaceIcon } from "./WorkspaceIcon";
import "./ProjectsOverview.css";

type Props = {
  areas: Area[];
  projects: Project[];
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

const statusLabels: Record<ProjectStatus, string> = {
  active: "common.workhub.statusActive",
  planned: "common.workhub.statusPlanned",
  paused: "common.workhub.statusPaused",
  completed: "common.workhub.statusCompleted",
};
const statuses = ["all", "active", "planned", "paused", "completed"] as const;

export function ProjectsOverview({ areas, projects, query, onQueryChange, onOpenProject, onNewProject, onNewArea, onEditArea, onDeleteArea, onEditProject, onDeleteProject }: Props) {
  const { t, tp } = useI18n();
  const [status, setStatus] = useState<ProjectStatus | "all">("all");
  const { menu, openMenu, closeMenu, longPress } = useContextMenu();
  const search = query.trim().toLocaleLowerCase();
  const areaById = new Map(areas.map((area) => [area.id, area]));
  const matching = projects.filter((project) =>
    [project.name, project.description, areaById.get(project.areaId ?? "")?.name ?? ""]
      .some((value) => value.toLocaleLowerCase().includes(search)));
  const filtered = matching.filter((project) => status === "all" || project.status === status);
  const isFiltering = Boolean(search) || status !== "all";
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
  function resetFilters() {
    onQueryChange("");
    setStatus("all");
  }

  return <section className="projects-overview" aria-label={t("common.views.projects")}>
    <header className="projects-overview-header">
      <div className="projects-overview-intro">
        <h2>{t("common.views.projects")}</h2>
      </div>
      <div className="projects-overview-actions">
        <button type="button" className="secondary-button" onClick={onNewArea}><Icon name="layers" />{t("common.workhub.newArea")}</button>
        <button type="button" className="primary-button" onClick={() => onNewProject()}><Icon name="plus" />{t("common.workhub.newProject")}</button>
      </div>
    </header>

    <div className="projects-overview-toolbar">
      <label className="projects-overview-search">
        <Icon name="search" />
        <input type="search" value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder={t("common.workhub.searchProjectsAndAreas")} aria-label={t("common.workhub.searchProjectsAndAreas")} />
      </label>
      <div className="projects-status-filters" role="group" aria-label={t("common.workhub.detailStatusLabel")}>
        {statuses.map((value) => <button type="button" key={value} aria-pressed={status === value} onClick={() => setStatus(value)}>
          {value === "all" ? t("common.workhub.allProjectsFilter") : t(statusLabels[value])}
          <span>{value === "all" ? matching.length : matching.filter((project) => project.status === value).length}</span>
        </button>)}
      </div>
      <label className="projects-mobile-status">
        <select value={status} aria-label={t("common.workhub.detailStatusLabel")} onChange={(event) => setStatus(event.target.value as ProjectStatus | "all")}>
          {statuses.map((value) => <option key={value} value={value}>{value === "all" ? t("common.workhub.backToAll") : t(statusLabels[value])}</option>)}
        </select>
        <Icon name="chevron-down" />
      </label>
    </div>

    {isFiltering && <div className="projects-overview-summary" role="status">
      <span>{tp("common.workhub.overviewProjectCount", filtered.length, { count: filtered.length })}</span>
      <button type="button" onClick={resetFilters}>{t("common.workhub.clearFilters")}<Icon name="close" /></button>
    </div>}

    <div className="projects-overview-groups">
      {groups.map((group) => {
        // Shared projects can refer to an area that is not in this workspace.
        const groupProjects = filtered.filter((project) => (areaById.has(project.areaId ?? "") ? project.areaId : null) === group.id);
        if (!groupProjects.length && (isFiltering || !group.area)) return null;
        return <section className="projects-area" key={group.id ?? "__none__"} aria-label={group.name} style={{ "--area-color": group.area?.color || "#797773" } as CSSProperties}>
          <div className="projects-area-heading"
            onContextMenu={group.area ? (event) => openMenu(event, areaActions(group.area!)) : undefined}
            {...(group.area ? longPress(() => areaActions(group.area!)) : {})}>
            <span className="projects-area-icon"><WorkspaceIcon icon={group.area?.icon} fallback={group.area ? DEFAULT_AREA_ICON : "layers"} /></span>
            <h3>{group.name}</h3>
            <span className="projects-area-count">{groupProjects.length}</span>
            <div className="projects-area-actions">
              <button type="button" className="projects-area-add" aria-label={t("common.workhub.menuNewProjectIn", { name: group.name })} onClick={() => onNewProject(group.id)}><Icon name="plus" /><span>{t("common.workhub.projectAction")}</span></button>
              {group.area && <button type="button" className="projects-icon-button" aria-label={t("common.workhub.areaOptions", { name: group.name })} aria-haspopup="menu" onClick={(event) => {
                const bounds = event.currentTarget.getBoundingClientRect();
                openMenu({ clientX: bounds.left, clientY: bounds.bottom + 6, target: event.currentTarget, preventDefault() {} }, areaActions(group.area!));
              }}><svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="19" cy="12" r="1.5" /></svg></button>}
            </div>
          </div>
          {groupProjects.length ? <div className="projects-card-grid">
            {groupProjects.map((project) => <article className="projects-card" key={project.id}
              onContextMenu={(event) => openMenu(event, projectActions(project))}
              {...longPress(() => projectActions(project))}>
              <button type="button" className="projects-card-open" aria-label={t("common.workhub.menuOpen", { name: project.name })} onClick={() => onOpenProject(project.id)}>
                <span className="projects-card-icon"><WorkspaceIcon icon={project.icon} fallback={project.projectType === "software" ? "code" : DEFAULT_PROJECT_ICON} /></span>
                <span className="projects-card-copy">
                  <span className="projects-card-name">{project.name}</span>
                  {project.description && <span className="projects-card-description">{project.description}</span>}
                </span>
                <span className="projects-card-meta">
                  <span className={`projects-card-status is-${project.status}`}><span aria-hidden="true" />{t(statusLabels[project.status])}</span>
                  <span className="projects-card-type"><Icon name={project.projectType === "software" ? "code" : "list-todo"} />{t(project.projectType === "software" ? "common.workhub.badgeSoftware" : "common.workhub.badgeStandard")}</span>
                </span>
                <Icon name="chevron-right" className="projects-card-arrow" />
              </button>
              <button type="button" className="projects-icon-button projects-card-edit" aria-label={t("common.workhub.editProjectAria", { name: project.name })} title={t("common.workhub.editProject")} onClick={() => onEditProject(project)}><Icon name="pencil" /></button>
            </article>)}
          </div> : <button type="button" className="projects-area-empty" onClick={() => onNewProject(group.id)}><Icon name="plus" />{t("common.workhub.emptyInline", { label: group.name })}</button>}
        </section>;
      })}
      {!filtered.length && (isFiltering || !areas.length) && <div className="projects-overview-empty">
        <span className="projects-overview-empty-icon"><Icon name={isFiltering ? "search" : "folder"} /></span>
        <h3>{t(isFiltering ? "common.workhub.emptyNoMatch" : "common.workhub.emptyTitle")}</h3>
        <p>{t(isFiltering ? "common.workhub.overviewNoMatchHint" : "common.workhub.emptyHint")}</p>
        <button type="button" className={isFiltering ? "secondary-button" : "primary-button"} onClick={isFiltering ? resetFilters : () => onNewProject()}>{t(isFiltering ? "common.workhub.clearFilters" : "common.workhub.newProject")}</button>
      </div>}
    </div>
    {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={closeMenu} />}
  </section>;
}
