import { useId, type CSSProperties, type HTMLAttributes, type KeyboardEvent, type ReactNode } from "react";
import type { ProjectHealth } from "../types";
import { useI18n } from "../lib/i18n";
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

export function ProjectTypeChip({ software, cycleName }: { software: boolean; cycleName?: string | null }) {
  const { t } = useI18n();
  const type = t(software ? "common.workhub.badgeSoftware" : "common.workhub.badgeStandard");
  return <span className="project-chip project-type-chip"><Icon name={software ? "refresh" : "list-todo"} />{cycleName ? `${type} · ${cycleName}` : type}</span>;
}

export function ProjectDetailHeader({ icon, title, chips, description, aside, actions, headerProps }: {
  icon: ReactNode; title: string; chips: ReactNode; description?: string; aside?: ReactNode; actions: ReactNode;
  /** Context-menu and long-press handlers for the header. */
  headerProps?: HTMLAttributes<HTMLElement>;
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
    <div className="project-page-actions">{aside}{actions}</div>
  </header>;
}

export type ProjectStat = { key: string; label: string; value: ReactNode; tone?: "danger" | "warning" | "good" };

export function ProjectStatsStrip({ progress, targetDate, cycle, health, completed }: {
  progress: ProjectProgress;
  targetDate?: string | null;
  cycle?: { name: string; endsOn: string } | null;
  health?: ProjectHealth | null;
  completed?: boolean;
}) {
  const { t, tp, lang } = useI18n();
  const today = localDateKey();
  const stats: ProjectStat[] = [];
  if (targetDate) {
    const days = daysBetween(today, targetDate.slice(0, 10));
    stats.push({
      key: "due",
      label: t("common.projectHub.statDue"),
      value: <>{formatShortDate(targetDate, lang)}{!completed && <span className="project-stat-sub"> · {formatRelativeDays(days, lang)}</span>}</>,
      tone: !completed && days < 0 ? "danger" : undefined,
    });
  }
  if (cycle) {
    const left = Math.max(0, daysBetween(today, cycle.endsOn.slice(0, 10)));
    stats.push({ key: "cycle", label: t("common.projectHub.statCycle"), value: <>{cycle.name}<span className="project-stat-sub"> · {tp("common.projectHub.daysLeft", left)}</span></> });
  }
  if (health) {
    const key = health === "On track" ? "healthOnTrack" : health === "At risk" ? "healthAtRisk" : "healthOffTrack";
    stats.push({ key: "health", label: t("common.projectHub.statHealth"), value: t(`collab.editor.${key}`), tone: health === "On track" ? "good" : health === "At risk" ? "warning" : "danger" });
  }
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
      <strong className={`project-stat-value${stat.tone ? ` is-${stat.tone}` : ""}`}>{stat.value}</strong>
    </div>)}
  </section>;
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
