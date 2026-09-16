import type { SessionUser } from "../lib/auth";
import { BrandMark } from "./BrandMark";
import { Icon } from "./Icon";
import "./AppSidebar.css";

export type WorkspaceView = "eisenhower" | "all" | "habits";

type AppSidebarProps = {
  readonly activeView: WorkspaceView;
  readonly user: SessionUser | null;
  readonly collapsed: boolean;
  readonly inert?: boolean;
  readonly onViewChange: (view: WorkspaceView) => void;
  readonly onAccount: () => void;
  readonly onToggle: () => void;
};

const NAV_ITEMS: Array<{ view: WorkspaceView; label: string; icon: "inbox" | "grid" | "calendar-check" }> = [
  { view: "all", label: "All tasks", icon: "inbox" },
  { view: "eisenhower", label: "Eisenhower", icon: "grid" },
  { view: "habits", label: "Habits", icon: "calendar-check" },
];

export function AppSidebar({ activeView, user, collapsed, inert, onViewChange, onAccount, onToggle }: AppSidebarProps) {
  return (
    <aside className={`sidebar ${collapsed ? "is-collapsed" : ""}`} inert={inert}>
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
      </div>

      <nav className="sidebar-nav" aria-label="Task views">
        {NAV_ITEMS.map((item) => (
          <button
            key={item.view}
            type="button"
            className={`nav-item ${activeView === item.view ? "active" : ""}`}
            aria-current={activeView === item.view ? "page" : undefined}
            title={item.label}
            onClick={() => onViewChange(item.view)}
          >
            <Icon name={item.icon} />
            <span>{item.label}</span>
          </button>
        ))}
      </nav>

      <div className="sidebar-bottom">
        <button className="account-trigger" type="button" aria-label="Account" title="Account" onClick={onAccount}>
          <span className="account-trigger-avatar">{user?.avatarUrl ? <img src={user.avatarUrl} alt="" /> : <Icon name="user" />}</span>
          <span className="account-trigger-label">{user?.displayName || "Account"}</span>
        </button>
      </div>
    </aside>
  );
}
