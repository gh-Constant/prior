import { useI18n } from "../lib/i18n";
import { Icon } from "./Icon";
import type { WorkspaceView } from "./AppSidebar";

type Props = {
  readonly activeView: WorkspaceView;
  readonly projectName?: string;
  readonly menuOpen: boolean;
  readonly onMenu: () => void;
};

function titleFor(view: WorkspaceView, projectName: string | undefined, t: (key: string) => string): string {
  switch (view) {
    case "today": return t("common.views.today");
    case "inbox": return t("common.views.inbox");
    case "projects": return t("common.views.projects");
    case "project": return projectName || t("common.views.project");
    case "all": return t("common.views.allTasks");
    case "waiting": return t("common.views.waiting");
    case "eisenhower": return t("common.nav.items.priorityLens");
    case "habits": return t("common.views.habits");
    case "notes": return t("common.views.notes");
    case "settings": return t("common.views.settings");
  }
}

function todaySubtitle(lang: string): string {
  const now = new Date();
  const date = now.toLocaleDateString(lang, { weekday: "short", day: "numeric", month: "short" }).toUpperCase();
  const time = now.toLocaleTimeString(lang, { hour: "2-digit", minute: "2-digit" });
  return `${date} · ${time}`;
}

export function MobileTopBar({ activeView, projectName, menuOpen, onMenu }: Props) {
  const { t, lang } = useI18n();
  return (
    <div className="mobile-topbar">
      <div className="mobile-topbar-titles">
        <h1>{titleFor(activeView, projectName, t)}</h1>
        {activeView === "today" && <p>{todaySubtitle(lang)}</p>}
      </div>
      <button
        type="button"
        className="mobile-menu-button"
        aria-label={menuOpen ? t("common.actions.closeMenu") : t("common.actions.openMenu")}
        aria-expanded={menuOpen}
        aria-controls="prior-sidebar"
        onClick={onMenu}
      >
        <Icon name="menu" />
      </button>
    </div>
  );
}
