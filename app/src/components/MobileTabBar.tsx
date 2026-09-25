import { useI18n } from "../lib/i18n";
import type { WorkspaceView } from "./AppSidebar";
import { Icon } from "./Icon";
import "./MobileTabBar.css";

export type MobileTab = "today" | "tasks" | "calendar" | "more";

/** Tab that owns a view on phones: the three direct tabs, everything else lives under "More". */
export function mobileTabFor(view: WorkspaceView, moreOpen: boolean): MobileTab {
  if (moreOpen) return "more";
  if (view === "today") return "today";
  if (view === "all") return "tasks";
  if (view === "calendar") return "calendar";
  return "more";
}

type Props = {
  readonly activeView: WorkspaceView;
  readonly moreOpen: boolean;
  readonly createLabel: string;
  readonly inert?: boolean;
  readonly onNavigate: (view: WorkspaceView) => void;
  readonly onCreate: () => void;
  readonly onToggleMore: () => void;
};

function MoreGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <circle cx="12" cy="12" r="8.5" />
      <path d="M8.5 12h.01M12 12h.01M15.5 12h.01" strokeWidth="2.2" />
    </svg>
  );
}

/**
 * Phone navigation: four destinations around a central create button.
 * Hidden above 760px, where the sidebar takes over.
 */
export function MobileTabBar({ activeView, moreOpen, createLabel, inert, onNavigate, onCreate, onToggleMore }: Props) {
  const { t } = useI18n();
  const active = mobileTabFor(activeView, moreOpen);
  const tab = (id: Exclude<MobileTab, "more">, view: WorkspaceView, icon: "home" | "list" | "calendar-check") => (
    <button
      type="button"
      className={`mobile-tab ${active === id ? "active" : ""}`}
      aria-current={active === id ? "page" : undefined}
      data-tab={id}
      onClick={() => onNavigate(view)}
    >
      <Icon name={icon} aria-hidden="true" />
      <span>{t(`common.shell.tabs.${id}`)}</span>
    </button>
  );

  return (
    <nav className="mobile-tabbar" aria-label={t("common.shell.tabBar")} inert={inert}>
      {tab("today", "today", "home")}
      {tab("tasks", "all", "list")}
      <div className="mobile-tab-fab-slot">
        <button type="button" className="mobile-tab-fab" aria-label={createLabel} title={createLabel} onClick={onCreate}>
          <Icon name="plus" aria-hidden="true" />
        </button>
      </div>
      {tab("calendar", "calendar", "calendar-check")}
      <button
        type="button"
        className={`mobile-tab ${active === "more" ? "active" : ""}`}
        aria-current={active === "more" && !moreOpen ? "true" : undefined}
        aria-expanded={moreOpen}
        aria-controls="prior-mobile-more"
        data-tab="more"
        onClick={onToggleMore}
      >
        <MoreGlyph />
        <span>{t("common.shell.tabs.more")}</span>
      </button>
    </nav>
  );
}
