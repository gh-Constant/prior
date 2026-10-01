import { useEffect, useRef, useState, type ReactNode } from "react";
import { useI18n } from "../lib/i18n";
import { AgentIdentity } from "./AgentIdentity";
import { Icon } from "./Icon";
import type { WorkspaceView } from "./AppSidebar";

/**
 * Views whose desktop title lives in the shared workspace header (hidden on
 * phones) and therefore take their phone title from this bar. Every other
 * view renders its own heading on phones.
 */
export const SHELL_TITLED_VIEWS: ReadonlySet<WorkspaceView> = new Set<WorkspaceView>(["all", "mine", "eisenhower", "habits", "inbox", "settings"]);

type Props = {
  readonly view: WorkspaceView;
  readonly title: string;
  readonly agentOpen: boolean;
  readonly onAgent: () => void;
  readonly onSearch?: () => void;
  /** View specific controls (e.g. List | Kanban), placed before search and the assistant. */
  readonly actions?: ReactNode;
  /** Muted text next to the large title (e.g. "12 active"). */
  readonly subtitle?: string;
};

/**
 * Phone page header, iOS style: a sticky bar with the actions that becomes
 * translucent and shows a compact centred title once the large title below it
 * has scrolled away.
 */
export function MobileTopBar({ view, title, agentOpen, onAgent, onSearch, actions, subtitle }: Props) {
  const { t } = useI18n();
  const barRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const [collapsed, setCollapsed] = useState(false);
  const shown = SHELL_TITLED_VIEWS.has(view);

  useEffect(() => {
    if (!shown) return undefined;
    let frame = 0;
    const update = () => {
      frame = 0;
      const bar = barRef.current;
      const heading = titleRef.current;
      if (!bar || !heading) return;
      setCollapsed(heading.getBoundingClientRect().bottom <= bar.getBoundingClientRect().bottom + 2);
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
  }, [shown, view]);

  if (!shown) return null;
  return (
    <header className="mobile-topbar" data-view={view} data-collapsed={collapsed ? "true" : undefined}>
      <div ref={barRef} className="mobile-topbar-bar">
        <span className="mobile-topbar-compact" aria-hidden="true">{title}</span>
        <div className="mobile-topbar-actions" role="group" aria-label={t("common.shell.pageActions")}>
          {actions}
          {onSearch && (
            <button type="button" className="mobile-icon-button mobile-search-button" aria-label={t("palette.search")} aria-haspopup="dialog" onClick={onSearch}>
              <Icon name="search" />
            </button>
          )}
          <button
            type="button"
            className="mobile-icon-button mobile-agent-button"
            aria-label={t("common.sidebar.agent")}
            aria-expanded={agentOpen}
            aria-controls="prior-ai-assistant"
            onClick={onAgent}
          >
            <AgentIdentity size="small" />
          </button>
        </div>
      </div>
      <div className="mobile-topbar-heading">
        <h1 ref={titleRef} className="mobile-topbar-title">{title}</h1>
        {subtitle && <span className="mobile-topbar-subtitle">{subtitle}</span>}
      </div>
    </header>
  );
}
