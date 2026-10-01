import { useEffect, useRef } from "react";
import type { SessionUser } from "../lib/auth";
import { useI18n } from "../lib/i18n";
import { formatSyncedAgo, useLastSyncedAt, useNow } from "../lib/syncStatus";
import { AgentIdentity } from "./AgentIdentity";
import type { WorkspaceView } from "./AppSidebar";
import { Icon, type IconName } from "./Icon";
import "./MobileMoreScreen.css";

type Tone = "blue" | "green" | "amber" | "violet" | "red" | "accent" | "neutral";
type Destination = { readonly view: WorkspaceView; readonly labelKey: string; readonly icon: IconName; readonly tone: Tone };

/** Everything the tab bar does not reach directly (Calendar first), as large tiles. */
export const MORE_DESTINATIONS: readonly Destination[] = [
  { view: "calendar", labelKey: "common.nav.items.calendar", icon: "calendar-check", tone: "red" },
  { view: "inbox", labelKey: "common.nav.items.inbox", icon: "inbox", tone: "blue" },
  { view: "mine", labelKey: "common.nav.items.myTasks", icon: "user", tone: "green" },
  { view: "waiting", labelKey: "common.nav.items.waiting", icon: "clock", tone: "violet" },
  { view: "eisenhower", labelKey: "common.nav.items.priorityLens", icon: "grid", tone: "amber" },
  { view: "habits", labelKey: "common.nav.items.habits", icon: "sun", tone: "accent" },
  { view: "notes", labelKey: "common.nav.items.notes", icon: "file-text", tone: "blue" },
  { view: "progress", labelKey: "game.nav.progress", icon: "trending-up", tone: "green" },
  { view: "plans", labelKey: "common.nav.items.plans", icon: "award", tone: "violet" },
  { view: "admin", labelKey: "common.nav.items.admin", icon: "bar-chart", tone: "neutral" },
];

type Props = {
  readonly activeView: WorkspaceView;
  readonly user: SessionUser | null;
  readonly badges?: Partial<Record<WorkspaceView, string>>;
  readonly agentOpen: boolean;
  readonly syncing?: boolean;
  readonly syncIssue?: boolean;
  readonly onSync?: () => void;
  readonly onNavigate: (view: WorkspaceView) => void;
  readonly showAdmin?: boolean;
  /** Shows the Progress entry: only in the gamified experience. */
  readonly showProgress?: boolean;
  readonly onAgent: () => void;
  readonly onAccount: () => void;
  readonly onClose: () => void;
};

function initials(user: SessionUser): string {
  const source = (user.displayName || user.email || "").trim();
  return source ? source[0].toUpperCase() : "";
}

/**
 * The "More" tab on phones: a full screen above the tab bar listing the
 * remaining views, the account and settings. Closes on navigation, Escape
 * (handled by App), or when the window grows past the phone breakpoint.
 */
export function MobileMoreScreen({ activeView, user, badges, agentOpen, syncing, syncIssue, onSync, onNavigate, showAdmin, showProgress, onAgent, onAccount, onClose }: Props) {
  const { t, lang } = useI18n();
  const titleRef = useRef<HTMLHeadingElement>(null);
  const lastSyncedAt = useLastSyncedAt();
  const now = useNow();

  useEffect(() => {
    titleRef.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return undefined;
    const desktop = window.matchMedia("(min-width: 761px)");
    const onChange = () => { if (desktop.matches) onClose(); };
    desktop.addEventListener?.("change", onChange);
    return () => desktop.removeEventListener?.("change", onChange);
  }, [onClose]);

  const accountDetail = syncIssue ? t("common.sidebar.syncIssue") : lastSyncedAt !== null
    ? t("common.shell.syncedAgo", { time: formatSyncedAgo(lastSyncedAt, now, lang, t("common.shell.justNow")) })
    : user?.email ?? "";

  return (
    <section id="prior-mobile-more" className="mobile-more" aria-labelledby="prior-mobile-more-title">
      <header className="mobile-more-header">
        <h1 id="prior-mobile-more-title" ref={titleRef} tabIndex={-1}>{t("common.shell.more.title")}</h1>
        <button
          type="button"
          className="mobile-icon-button mobile-agent-button"
          aria-label={t("common.shell.more.openAgent")}
          aria-expanded={agentOpen}
          aria-controls="prior-ai-assistant"
          onClick={onAgent}
        >
          <AgentIdentity size="small" />
        </button>
      </header>

      <nav className="mobile-more-grid" aria-label={t("common.shell.more.destinations")}>
        <ul>
          {MORE_DESTINATIONS.filter((item) => (item.view !== "admin" || showAdmin) && (item.view !== "progress" || showProgress) && (item.view !== "mine" || user)).map((item) => {
            const current = activeView === item.view;
            const badge = badges?.[item.view];
            return (
              <li key={item.view}>
                <button type="button" className="mobile-more-tile" data-view={item.view} data-tone={item.tone} aria-current={current ? "page" : undefined} onClick={() => onNavigate(item.view)}>
                  <span className="mobile-more-icon"><Icon name={item.icon} /></span>
                  <span className="mobile-more-label">{t(item.labelKey)}</span>
                  {badge && <span className="mobile-more-badge">{badge}</span>}
                </button>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="mobile-more-card">
        {onSync && <button type="button" className={`mobile-more-row mobile-more-sync ${syncIssue ? "has-issue" : ""}`} onClick={onSync} disabled={syncing} aria-label={syncing ? t("common.sidebar.syncing") : syncIssue ? t("common.sidebar.syncIssueHint") : t("common.sidebar.sync")}><Icon name="refresh" /><span className="mobile-more-label">{syncing ? t("common.sidebar.syncing") : syncIssue ? t("common.sidebar.syncIssue") : t("common.sidebar.sync")}</span></button>}
        <button type="button" className="mobile-more-account" onClick={onAccount}>
          <span className="mobile-more-avatar" aria-hidden="true">
            {user?.avatarUrl ? <img src={user.avatarUrl} alt="" /> : user && initials(user) ? initials(user) : <Icon name="user" />}
          </span>
          <span className="mobile-more-account-text">
            <strong>{user?.displayName || t("common.sidebar.account")}</strong>
            {accountDetail && <small>{accountDetail}</small>}
          </span>
          <Icon name="chevron-right" className="mobile-more-chevron" />
        </button>
        <button type="button" className="mobile-more-row mobile-more-settings" aria-current={activeView === "settings" ? "page" : undefined} onClick={() => onNavigate("settings")}>
          <Icon name="sliders" className="mobile-more-settings-icon" />
          <span className="mobile-more-label">{t("common.views.settings")}</span>
          <Icon name="chevron-right" className="mobile-more-chevron" />
        </button>
      </div>
    </section>
  );
}
