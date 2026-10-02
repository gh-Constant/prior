import { useEffect, useId, useRef, useState, type CSSProperties, type HTMLAttributes, type KeyboardEvent, type ReactNode } from "react";
import type { ProjectHealth, ProjectMethodology } from "../types";
import { projectKindOf } from "../lib/agile";
import { PROJECT_KIND_ICONS, projectKindBadge } from "./ProjectKindSelect";
import { useI18n } from "../lib/i18n";
import { ContextMenu, type ContextMenuItem } from "./ContextMenu";
import { Icon, type IconName } from "./Icon";
import { ProgressBar, daysBetween, formatPercent, formatRelativeDays, formatShortDate, localDateKey, type ProjectProgress } from "./ProjectVisuals";
import "./ProjectDetail.css";

/* Shared chrome for both project detail surfaces (standard and agile). */

export function ProjectBreadcrumb({ areaName, projectName, onBack }: { areaName?: string | null; projectName: string; onBack: () => void }) {
  const { t } = useI18n();
  return <nav className="project-breadcrumb" aria-label={t("common.projectHub.breadcrumb")}>
    <ol>
      <li><button type="button" onClick={onBack}><Icon name="folder" />{t("common.views.projects")}</button></li>
      {areaName && <li><Icon name="chevron-right" className="project-breadcrumb-sep" /><span>{areaName}</span></li>}
      <li><Icon name="chevron-right" className="project-breadcrumb-sep" /><span aria-current="page">{projectName}</span></li>
    </ol>
  </nav>;
}

/** Standard, Kanban, Scrum or Scrumban; the cycle name follows when a cycle is running. */
export function ProjectTypeChip({ software, methodology, cycleName }: { software: boolean; methodology?: ProjectMethodology | null; cycleName?: string | null }) {
  const { t } = useI18n();
  const kind = projectKindOf({ projectType: software ? "software" : "standard", methodology });
  const type = projectKindBadge(kind, t);
  return <span className="project-chip project-type-chip"><Icon name={PROJECT_KIND_ICONS[kind]} />{cycleName ? `${type} · ${cycleName}` : type}</span>;
}

/** Phone-only "•••" button of the project header: the secondary actions as a sheet. */
function ProjectMoreButton({ items }: { items: readonly ContextMenuItem[] }) {
  const { t } = useI18n();
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);
  if (!items.length) return null;
  return <>
    <button type="button" className="secondary-button project-more-button" aria-label={t("kanban.phone.moreActions")} aria-haspopup="menu" aria-expanded={anchor !== null}
      onClick={(event) => { const rect = event.currentTarget.getBoundingClientRect(); setAnchor({ x: rect.right - 220, y: rect.bottom + 6 }); }}><Icon name="more" /></button>
    {anchor && <ContextMenu x={anchor.x} y={anchor.y} items={items} onClose={() => setAnchor(null)} />}
  </>;
}

export function ProjectDetailHeader({ icon, title, chips, description, aside, actions, headerProps, moreItems }: {
  icon: ReactNode; title: string; chips: ReactNode; description?: string; aside?: ReactNode; actions: ReactNode;
  /** Context-menu and long-press handlers for the header. */
  headerProps?: HTMLAttributes<HTMLElement>;
  /** Secondary actions, shown as a "•••" sheet button on phones. */
  moreItems?: readonly ContextMenuItem[];
}) {
  return <header className="project-page-header" {...headerProps}>
    <div className="project-page-identity">
      {icon}
      <div className="project-page-copy">
        <div className="project-page-title-row">
          <h2>{title}</h2>
          <div className="project-page-chips">{chips}</div>
        </div>
        {description && <p className="project-page-description">{description}</p>}
      </div>
    </div>
    <div className="project-page-actions">{aside}{actions}{moreItems && <ProjectMoreButton items={moreItems} />}</div>
  </header>;
}

export type ProjectStat = { key: string; label: string; shortLabel?: string; icon: IconName; value: ReactNode; sub?: string; tone?: "danger" | "warning" | "good" };

type ProjectFactsInput = {
  targetDate?: string | null;
  cycle?: { name: string; endsOn: string } | null;
  health?: ProjectHealth | null;
  completed?: boolean;
};

/** Due date, current cycle and health of a project, as label/value pairs. */
function useProjectFacts({ targetDate, cycle, health, completed }: ProjectFactsInput): ProjectStat[] {
  const { t, tp, lang } = useI18n();
  const today = localDateKey();
  const stats: ProjectStat[] = [];
  if (targetDate) {
    const days = daysBetween(today, targetDate.slice(0, 10));
    stats.push({
      key: "due",
      label: t("common.projectHub.statDue"),
      icon: "calendar-check",
      value: formatShortDate(targetDate, lang),
      sub: completed ? undefined : formatRelativeDays(days, lang),
      tone: !completed && days < 0 ? "danger" : undefined,
    });
  }
  if (cycle) {
    const left = Math.max(0, daysBetween(today, cycle.endsOn.slice(0, 10)));
    stats.push({ key: "cycle", label: t("common.projectHub.statCycle"), shortLabel: t("common.projectHub.statCycleShort"), icon: "refresh", value: cycle.name, sub: tp("common.projectHub.daysLeft", left) });
  }
  if (health) {
    const key = health === "On track" ? "healthOnTrack" : health === "At risk" ? "healthAtRisk" : "healthOffTrack";
    stats.push({ key: "health", label: t("common.projectHub.statHealth"), icon: "activity", value: t(`collab.editor.${key}`), tone: health === "On track" ? "good" : health === "At risk" ? "warning" : "danger" });
  }
  return stats;
}

export function ProjectStatsStrip({ progress, ...facts }: ProjectFactsInput & { progress: ProjectProgress }) {
  const { t, lang } = useI18n();
  const stats = useProjectFacts(facts);
  return <section className="project-stats" aria-label={t("common.projectHub.statsLabel")} style={{ "--project-stats-columns": `minmax(0, 1.4fr)${" minmax(0, 1fr)".repeat(stats.length)}` } as CSSProperties}>
    <div className="project-stat project-stat-progress">
      <div className="project-stat-progress-row">
        <span className="project-stat-label">{t("common.projectHub.statProgress")}</span>
        <span className="project-stat-progress-value">{progress.total ? `${formatPercent(progress.percent, lang)} · ${progress.completed} / ${progress.total}` : t("common.projectHub.noTasksYet")}</span>
      </div>
      <ProgressBar percent={progress.percent} />
      <span className="project-sr-only">{t("common.workhub.progress", { completed: progress.completed, total: progress.total })}</span>
    </div>
    {stats.map((stat) => <div className="project-stat" key={stat.key}>
      <span className="project-stat-label">{stat.label}</span>
      <strong className={`project-stat-value${stat.tone ? ` is-${stat.tone}` : ""}`}>{stat.value}{stat.sub && <span className="project-stat-sub"> · {stat.sub}</span>}</strong>
    </div>)}
  </section>;
}

/* ── Phone layout ─────────────────────────────────────────────────────────
 * On phones the breadcrumb, header and stats strip are replaced by a sticky
 * navigation bar, a compact hero and one summary card (specs/DESIGN.md,
 * "Phone layout"). */

/**
 * Phone header of a project page: a sticky bar (back, compact title once the
 * large title has scrolled away, members, actions sheet) above the hero.
 */
export function ProjectPhoneHeader({ icon, title, areaName, chips, description, members, menuItems, onBack, children }: {
  icon: ReactNode; title: string; areaName?: string | null; chips: ReactNode; description?: string;
  /** Members button (avatar stack), placed before the actions. */
  members?: ReactNode;
  menuItems: readonly ContextMenuItem[];
  onBack: () => void;
  /** The summary card. */
  children?: ReactNode;
}) {
  const { t } = useI18n();
  const barRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      const bar = barRef.current;
      const heading = titleRef.current;
      if (bar && heading) setCollapsed(heading.getBoundingClientRect().bottom <= bar.getBoundingClientRect().bottom + 2);
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
    update();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  return <>
    <div ref={barRef} className="project-phone-bar" data-collapsed={collapsed ? "true" : undefined}>
      <button type="button" className="project-phone-back" aria-label={t("common.workhub.backToProjects")} onClick={onBack}>
        <Icon name="chevron-left" /><span>{t("common.views.projects")}</span>
      </button>
      <span className="project-phone-bar-title" aria-hidden="true">{title}</span>
      <div className="project-phone-bar-actions">{members}<ProjectMoreButton items={menuItems} /></div>
    </div>
    <header className="project-phone-hero">
      <div className="project-phone-identity">
        {icon}
        <div className="project-phone-copy">
          {areaName && <span className="project-phone-area">{areaName}</span>}
          <h2 ref={titleRef}>{title}</h2>
        </div>
      </div>
      {description && <p className="project-phone-description">{description}</p>}
      <div className="project-phone-chips">{chips}</div>
      {children}
    </header>
  </>;
}

/** Phone summary card: progress, then due date, cycle and health as rows. */
export function ProjectPhoneSummary({ progress, ...facts }: ProjectFactsInput & { progress: ProjectProgress }) {
  const { t, lang } = useI18n();
  const stats = useProjectFacts(facts);
  return <section className="project-phone-summary" aria-label={t("common.projectHub.statsLabel")}>
    <div className="project-phone-progress">
      <span>{progress.total ? t("common.projectHub.progressDone", { completed: progress.completed, total: progress.total }) : t("common.projectHub.noTasksYet")}</span>
      {progress.total > 0 && <strong>{formatPercent(progress.percent, lang)}</strong>}
    </div>
    <ProgressBar percent={progress.percent} />
    {stats.length > 0 && <dl className="project-phone-facts">
      {stats.map((stat) => <div key={stat.key}>
        <dt><Icon name={stat.icon} />{stat.shortLabel ?? stat.label}</dt>
        <dd className={stat.tone ? `is-${stat.tone}` : undefined}>{stat.value}</dd>
        {stat.sub && <dd className="project-phone-fact-sub">{stat.sub}</dd>}
      </div>)}
    </dl>}
  </section>;
}

export type ProjectGroup<T> = {
  readonly id: string;
  readonly label: string;
  readonly glyph?: ReactNode;
  readonly items: readonly T[];
  /** Starts folded (finished work). */
  readonly folded?: boolean;
};

/** Phone list of a project: one foldable section per status, empty ones hidden. */
export function ProjectPhoneGroups<T extends { readonly id: string }>({ groups, label, renderItem }: {
  groups: readonly ProjectGroup<T>[];
  label: string;
  renderItem: (item: T) => ReactNode;
}) {
  const baseId = useId();
  const [toggled, setToggled] = useState<ReadonlySet<string>>(() => new Set());
  const toggle = (id: string) => setToggled((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  return <div className="project-phone-groups" role="list" aria-label={label}>
    {groups.filter((group) => group.items.length).map((group) => {
      const open = Boolean(group.folded) === toggled.has(group.id);
      const bodyId = `${baseId}-${group.id}`;
      return <section key={group.id} role="listitem" className={`project-phone-group${open ? "" : " is-folded"}`} aria-label={group.label}>
        <button type="button" className="project-phone-group-heading" aria-expanded={open} aria-controls={bodyId} onClick={() => toggle(group.id)}>
          {group.glyph}
          <span className="project-phone-group-label">{group.label}</span>
          <span className="project-phone-group-count">{group.items.length}</span>
          <Icon name="chevron-down" className="project-phone-group-chevron" />
        </button>
        {open && <div id={bodyId} className="project-phone-group-items">{group.items.map((item) => <div key={item.id} className="project-phone-group-item">{renderItem(item)}</div>)}</div>}
      </section>;
    })}
  </div>;
}

export type ProjectTabItem<T extends string> = { id: T; label: string; icon: IconName; count?: number };

export function ProjectTabs<T extends string>({ tabs, active, onChange, label, panelId }: { tabs: readonly ProjectTabItem<T>[]; active: T; onChange: (id: T) => void; label: string; panelId: string }) {
  const baseId = useId();
  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next = index;
    if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
    else if (event.key === "ArrowLeft") next = (index + tabs.length - 1) % tabs.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = tabs.length - 1;
    else return;
    event.preventDefault();
    onChange(tabs[next].id);
    document.getElementById(`${baseId}-${tabs[next].id}`)?.focus();
  }
  return <div className="project-tabs" role="tablist" aria-label={label}>
    {tabs.map((tab, index) => <button key={tab.id} type="button" role="tab" id={`${baseId}-${tab.id}`} aria-controls={panelId} aria-selected={active === tab.id} tabIndex={active === tab.id ? 0 : -1}
      onClick={() => onChange(tab.id)} onKeyDown={(event) => onKeyDown(event, index)}>
      <Icon name={tab.icon} />{tab.label}{tab.count !== undefined && <>{" "}<span className="project-tab-count">{tab.count}</span></>}
    </button>)}
  </div>;
}
