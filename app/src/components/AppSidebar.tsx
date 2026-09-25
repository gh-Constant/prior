import type { SessionUser } from "../lib/auth";
import { useI18n } from "../lib/i18n";
import { formatSyncedAgo, useLastSyncedAt, useNow } from "../lib/syncStatus";
import { AgentIdentity } from "./AgentIdentity";
import { BrandMark } from "./BrandMark";
import { Icon, type IconName } from "./Icon";
import "./AppSidebar.css";

export type WorkspaceView = "today" | "inbox" | "calendar" | "projects" | "project" | "all" | "waiting" | "eisenhower" | "habits" | "notes" | "settings";

type AppSidebarProps = {
  readonly activeView: WorkspaceView;
  readonly user: SessionUser | null;
  readonly collapsed: boolean;
  readonly agentOpen: boolean;
  readonly aiShortcut: string;
  readonly inert?: boolean;
  /** Live counts shown next to a destination; zero or missing hides the count. */
  readonly counts?: Partial<Record<WorkspaceView, number>>;
  readonly updateAvailable?: boolean;
  readonly updateInstalling?: boolean;
  readonly onInstallUpdate?: () => void;
  readonly syncing: boolean;
  readonly syncIssue?: boolean;
  readonly onSync: () => void;
  readonly onViewChange: (view: WorkspaceView) => void;
  readonly onAccount: () => void;
  readonly onToggle: () => void;
  readonly onToggleAgent: () => void;
};

const NAV_GROUPS: Array<{ labelKey: string; items: Array<{ view: WorkspaceView; labelKey: string; icon: IconName }> }> = [
  { labelKey: "common.nav.groups.focus", items: [{ view: "today", labelKey: "common.nav.items.today", icon: "focus" }, { view: "inbox", labelKey: "common.nav.items.inbox", icon: "inbox" }, { view: "calendar", labelKey: "common.nav.items.calendar", icon: "calendar-check" }] },
  { labelKey: "common.nav.groups.organize", items: [{ view: "projects", labelKey: "common.nav.items.projects", icon: "folder" }, { view: "all", labelKey: "common.nav.items.allTasks", icon: "list" }] },
  { labelKey: "common.nav.groups.review", items: [{ view: "waiting", labelKey: "common.nav.items.waiting", icon: "clock" }, { view: "eisenhower", labelKey: "common.nav.items.priorityLens", icon: "grid" }, { view: "habits", labelKey: "common.nav.items.habits", icon: "sun" }, { view: "notes", labelKey: "common.nav.items.notes", icon: "file-text" }] },
];

/** Desktop and tablet navigation rail. Phones use MobileTabBar instead. */
export function AppSidebar({
  activeView,
  user,
  collapsed,
  agentOpen,
  aiShortcut,
  inert,
  counts,
  updateAvailable,
  updateInstalling,
  onInstallUpdate,
  syncing,
  syncIssue,
  onSync,
  onViewChange,
  onAccount,
  onToggle,
  onToggleAgent,
}: AppSidebarProps) {
  const { t, lang } = useI18n();
  const lastSyncedAt = useLastSyncedAt();
  const now = useNow();
  const syncedAgo = lastSyncedAt !== null ? formatSyncedAgo(lastSyncedAt, now, lang, t("common.shell.justNow")) : null;
  const syncLabel = syncing ? t("common.sidebar.syncing") : syncIssue ? t("common.sidebar.syncIssue") : syncedAgo ? t("common.shell.synced") : t("common.sidebar.sync");
  const syncTitle = syncing ? t("common.sidebar.syncing") : syncIssue ? t("common.sidebar.syncIssueHint") : syncedAgo ? t("common.shell.syncNowSynced", { time: syncedAgo }) : t("common.sidebar.sync");

  return (
    <aside id="prior-sidebar" className={`sidebar ${collapsed ? "is-collapsed" : ""}`} inert={inert} aria-label={t("common.sidebar.primary")}>
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
      </div>

      <nav className="sidebar-nav" aria-label={t("common.sidebar.workspaceViews")}>
        {NAV_GROUPS.map((group) => <div className="sidebar-nav-group" key={group.labelKey}><span className="sidebar-nav-label">{t(group.labelKey)}</span>{group.items.map((item) => {
          const count = counts?.[item.view] ?? 0;
          const active = activeView === item.view || (item.view === "projects" && activeView === "project");
          return (
            <button key={item.view} type="button" className={`nav-item ${active ? "active" : ""}`} data-view={item.view} aria-current={active ? "page" : undefined} title={t(item.labelKey)} onClick={() => onViewChange(item.view)}>
              <Icon name={item.icon} /><span className="nav-item-label">{t(item.labelKey)}</span>
              {count > 0 && <span className="nav-item-count">{count}</span>}
            </button>
          );
        })}</div>)}
      </nav>

      <div className="sidebar-bottom">
        <button
          type="button"
          className={`sidebar-sync-button ${syncing ? "is-syncing" : ""} ${syncIssue ? "has-issue" : ""}`}
          aria-label={syncTitle}
          title={syncTitle}
          onClick={onSync}
        >
          <Icon name="refresh" aria-hidden="true" />
          <span className="sidebar-sync-label">{syncLabel}</span>
          {!syncing && !syncIssue && syncedAgo && <span className="sidebar-sync-meta" aria-hidden="true">{syncedAgo}</span>}
        </button>
        <button
          type="button"
          className={`prior-agent-button ${agentOpen ? "active" : ""}`}
          aria-expanded={agentOpen}
          aria-controls="prior-ai-assistant"
          title={t("common.sidebar.agentShortcut", { shortcut: aiShortcut })}
          onClick={onToggleAgent}
        >
          <AgentIdentity size="tiny" />
          <span className="prior-agent-label">{t("common.sidebar.agent")}</span>
          <kbd>{aiShortcut}</kbd>
        </button>
        <div className="sidebar-account-row">
          <button
            className="account-trigger"
            type="button"
            aria-label={t("common.sidebar.account")}
            title={t("common.sidebar.account")}
            onClick={onAccount}
          >
            <span className="account-trigger-avatar">{user?.avatarUrl ? <img src={user.avatarUrl} alt="" /> : <Icon name="user" />}</span>
            <span className="account-trigger-label">{user?.displayName || t("common.sidebar.account")}</span>
          </button>
          {updateAvailable && (
            <button
              className={`sidebar-update-ball ${updateInstalling ? "installing" : ""}`}
              type="button"
              aria-label={updateInstalling ? t("common.celebration.installing") : t("common.celebration.updateAvailable")}
              title={updateInstalling ? t("common.celebration.installing") : `${t("common.celebration.updateAvailable")} — click to update`}
              disabled={updateInstalling}
              onClick={(event) => {
                event.stopPropagation();
                onInstallUpdate?.();
              }}
            >
              <Icon name={updateInstalling ? "refresh" : "download"} />
            </button>
          )}
        </div>
      </div>
    </aside>
  );
}
