import type { SessionUser } from "../lib/auth";
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

const NAV_GROUPS: Array<{ label: string; items: Array<{ view: WorkspaceView; label: string; icon: "inbox" | "grid" | "calendar-check" | "file-text" | "folder" | "focus" | "later" }> }> = [
  { label: "Focus", items: [{ view: "today", label: "Today", icon: "focus" }, { view: "inbox", label: "Inbox", icon: "inbox" }] },
  { label: "Organize", items: [{ view: "projects", label: "Projects", icon: "folder" }, { view: "all", label: "All tasks", icon: "inbox" }] },
  { label: "Review", items: [{ view: "waiting", label: "Waiting", icon: "later" }, { view: "eisenhower", label: "Priority lens", icon: "grid" }, { view: "habits", label: "Habits", icon: "calendar-check" }, { view: "notes", label: "Notes", icon: "file-text" }] },
];

export function AppSidebar({ activeView, user, collapsed, mobileOpen, agentOpen, aiShortcut, inert, updateAvailable, onViewChange, onAccount, onToggle, onToggleAgent, onCloseMobile }: AppSidebarProps) {
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
      {mobileOpen && <button type="button" className="sidebar-backdrop" aria-label="Close menu" onClick={onCloseMobile} tabIndex={-1} />}
      <aside id="prior-sidebar" className={`sidebar ${collapsed ? "is-collapsed" : ""} ${mobileOpen ? "is-mobile-open" : ""}`} inert={inert} aria-label="Primary">
        <div className="sidebar-top">
          <div className="sidebar-brand" title="Prior">
            <BrandMark withTitle />
          </div>
          <button
            type="button"
            className="sidebar-collapse-button"
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-pressed={collapsed}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            onClick={onToggle}
          >
            <Icon name={collapsed ? "chevron-right" : "chevron-left"} />
          </button>
          <button
            type="button"
            className="sidebar-close-button"
            aria-label="Close menu"
            title="Close menu"
            onClick={onCloseMobile}
          >
            <Icon name="close" />
          </button>
        </div>

        <nav className="sidebar-nav" aria-label="Workspace views">
          {NAV_GROUPS.map((group) => <div className="sidebar-nav-group" key={group.label}><span className="sidebar-nav-label">{group.label}</span>{group.items.map((item) => (
            <button key={item.view} type="button" className={`nav-item ${activeView === item.view ? "active" : ""}`} data-view={item.view} aria-current={activeView === item.view ? "page" : undefined} title={item.label} onClick={() => go(item.view)}>
              <Icon name={item.icon} /><span>{item.label}</span>
            </button>
          ))}</div>)}
        </nav>

        <div className="sidebar-bottom">
          <button
            type="button"
            className={`prior-agent-button ${agentOpen ? "active" : ""}`}
            aria-expanded={agentOpen}
            aria-controls="prior-ai-assistant"
            title={`Prior Agent (${aiShortcut})`}
            onClick={toggleAgent}
          >
            <AgentIdentity size="tiny" />
            <span className="prior-agent-label">Prior Agent</span>
            <kbd>{aiShortcut}</kbd>
          </button>
          <button
            type="button"
            className={`nav-item settings-nav-item ${activeView === "settings" ? "active" : ""}`}
            data-view="settings"
            aria-current={activeView === "settings" ? "page" : undefined}
            title="Settings"
            onClick={() => go("settings")}
          >
            <Icon name="folder" /><span>Settings</span>
            {updateAvailable && <span className="update-badge-dot" aria-label="Update available" title="Update available" style={{ width: 8, height: 8, borderRadius: 999, background: "#fa654a", display: "inline-block", marginLeft: 6 }} />}
          </button>
          <button
            className="account-trigger"
            type="button"
            aria-label="Account"
            title="Account"
            onClick={openAccount}
          >
            <span className="account-trigger-avatar">{user?.avatarUrl ? <img src={user.avatarUrl} alt="" /> : <Icon name="user" />}</span>
            <span className="account-trigger-label">{user?.displayName || "Account"}</span>
          </button>
        </div>
      </aside>
    </>
  );
}
