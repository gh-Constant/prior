import { Icon } from "./Icon";
import type { WorkspaceView } from "./AppSidebar";

type Props = {
  readonly activeView: WorkspaceView;
  readonly projectName?: string;
  readonly menuOpen: boolean;
  readonly onMenu: () => void;
};

function titleFor(view: WorkspaceView, projectName?: string): string {
  switch (view) {
    case "today": return "Today";
    case "inbox": return "Inbox";
    case "projects": return "Projects";
    case "project": return projectName || "Project";
    case "all": return "All tasks";
    case "waiting": return "Waiting";
    case "eisenhower": return "Priority lens";
    case "habits": return "Habits";
    case "notes": return "Notes";
    case "settings": return "Settings";
  }
}

function todaySubtitle(): string {
  const now = new Date();
  const date = now.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" }).toUpperCase();
  const time = now.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  return `${date} · ${time}`;
}

export function MobileTopBar({ activeView, projectName, menuOpen, onMenu }: Props) {
  return (
    <div className="mobile-topbar">
      <div className="mobile-topbar-titles">
        <h1>{titleFor(activeView, projectName)}</h1>
        {activeView === "today" && <p>{todaySubtitle()}</p>}
      </div>
      <button
        type="button"
        className="mobile-menu-button"
        aria-label={menuOpen ? "Close menu" : "Open menu"}
        aria-expanded={menuOpen}
        aria-controls="prior-sidebar"
        onClick={onMenu}
      >
        <Icon name="menu" />
      </button>
    </div>
  );
}
