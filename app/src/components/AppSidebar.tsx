import type { SessionUser } from "../lib/auth";
import { useI18n } from "../lib/i18n";
import { AgentIdentity } from "./AgentIdentity";
import { BrandMark } from "./BrandMark";
import { Icon } from "./Icon";
import "./AppSidebar.css";

export type WorkspaceView = "today" | "inbox" | "projects" | "project" | "all" | "waiting" | "eisenhower" | "habits" | "notes" | "settings";

type AppSidebarProps = {
  readonly activeView: WorkspaceView;
  readonly user: SessionUser | null;
  readonly collapsed: boolean;
  readonly mobileOpen: boolean;
  readonly agentOpen: boolean;
  readonly aiShortcut: string;
  readonly inert?: boolean;
  readonly updateAvailable?: boolean;
  readonly onViewChange: (view: WorkspaceView) => void;
  readonly onAccount: () => void;
  readonly onToggle: () => void;
  readonly onToggleAgent: () => void;
  readonly onCloseMobile: () => void;
};

const NAV_GROUPS: Array<{ labelKey: string; items: Array<{ view: WorkspaceView; labelKey: string; icon: "inbox" | "grid" | "calendar-check" | "file-text" | "folder" | "focus" | "later" }> }> = [
  { labelKey: "common.nav.groups.focus", items: [{ view: "today", labelKey: "common.nav.items.today", icon: "focus" }, { view: "inbox", labelKey: "common.nav.items.inbox", icon: "inbox" }] },
  { labelKey: "common.nav.groups.organize", items: [{ view: "projects", labelKey: "common.nav.items.projects", icon: "folder" }, { view: "all", labelKey: "common.nav.items.allTasks", icon: "inbox" }] },
  { labelKey: "common.nav.groups.review", items: [{ view: "waiting", labelKey: "common.nav.items.waiting", icon: "later" }, { view: "eisenhower", labelKey: "common.nav.items.priorityLens", icon: "grid" }, { view: "habits", labelKey: "common.nav.items.habits", icon: "calendar-check" }, { view: "notes", labelKey: "common.nav.items.notes", icon: "file-text" }] },
];

export function AppSidebar({ activeView, user, collapsed, mobileOpen, agentOpen, aiShortcut, inert, updateAvailable, onViewChange, onAccount, onToggle, onToggleAgent, onCloseMobile }: AppSidebarProps) {
  const { t } = useI18n();
  function go(view: WorkspaceView): void {
    onCloseMobile();
    onViewChange(view);
  }

  function toggleAgent(): void {
    onCloseMobile();
    onToggleAgent();
  }

  function openAccount(): void {
    onCloseMobile();
    onAccount();
  }

  return (
    <>
      {mobileOpen && <button type="button" className="sidebar-backdrop" aria-label={t("common.actions.closeMenu")} onClick={onCloseMobile} tabIndex={-1} />}
      <aside id="prior-sidebar" className={`sidebar ${collapsed ? "is-collapsed" : ""} ${mobileOpen ? "is-mobile-open" : ""}`} inert={inert} aria-label={t("common.sidebar.primary")}>
        <div className="sidebar-top">
          <div className="sidebar-brand" title="Prior">
            <BrandMark withTitle />
          </div>
          <button
            type="button"
            className="sidebar-collapse-button"
            aria-label={collapsed ? t("common.sidebar.expand") : t("common.sidebar.collapse")}
            aria-pressed={collapsed}
            title={collapsed ? t("common.sidebar.expand") : t("common.sidebar.collapse")}
            onClick={onToggle}
          >
            <Icon name={collapsed ? "chevron-right" : "chevron-left"} />
          </button>
          <button
            type="button"
            className="sidebar-close-button"
            aria-label={t("common.actions.closeMenu")}
            title={t("common.actions.closeMenu")}
            onClick={onCloseMobile}
          >
            <Icon name="close" />
          </button>
        </div>

        <nav className="sidebar-nav" aria-label={t("common.sidebar.workspaceViews")}>
          {NAV_GROUPS.map((group) => <div className="sidebar-nav-group" key={group.labelKey}><span className="sidebar-nav-label">{t(group.labelKey)}</span>{group.items.map((item) => (
            <button key={item.view} type="button" className={`nav-item ${activeView === item.view ? "active" : ""}`} data-view={item.view} aria-current={activeView === item.view ? "page" : undefined} title={t(item.labelKey)} onClick={() => go(item.view)}>
              <Icon name={item.icon} /><span>{t(item.labelKey)}</span>
            </button>
          ))}</div>)}
        </nav>

        <div className="sidebar-bottom">
          <button
            type="button"
            className={`prior-agent-button ${agentOpen ? "active" : ""}`}
            aria-expanded={agentOpen}
            aria-controls="prior-ai-assistant"
            title={t("common.sidebar.agentShortcut", { shortcut: aiShortcut })}
            onClick={toggleAgent}
          >
            <AgentIdentity size="tiny" />
            <span className="prior-agent-label">{t("common.sidebar.agent")}</span>
            <kbd>{aiShortcut}</kbd>
          </button>
          <button
            className="account-trigger"
            type="button"
            aria-label={updateAvailable ? t("common.sidebar.accountUpdate") : t("common.sidebar.account")}
            title={t("common.sidebar.account")}
            onClick={openAccount}
          >
            <span className="account-trigger-avatar">{user?.avatarUrl ? <img src={user.avatarUrl} alt="" /> : <Icon name="user" />}</span>
            <span className="account-trigger-label">{user?.displayName || t("common.sidebar.account")}</span>
            {updateAvailable && <span className="update-badge-dot" aria-label={t("common.sidebar.updateAvailable")} title={t("common.sidebar.updateAvailable")} style={{ width: 8, height: 8, borderRadius: 999, background: "#fa654a", display: "inline-block", marginLeft: "auto" }} />}
          </button>
        </div>
      </aside>
    </>
  );
}
