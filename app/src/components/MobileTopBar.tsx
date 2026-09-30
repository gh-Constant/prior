import { useI18n } from "../lib/i18n";
import { AgentIdentity } from "./AgentIdentity";
import { Icon } from "./Icon";
import type { WorkspaceView } from "./AppSidebar";

/**
 * Views whose desktop title lives in the shared workspace header (hidden on
 * phones) and therefore take their phone title from this bar. Every other
 * view renders its own heading on phones.
 */
export const SHELL_TITLED_VIEWS: ReadonlySet<WorkspaceView> = new Set<WorkspaceView>(["all", "eisenhower", "habits", "inbox", "settings"]);

type Props = {
  readonly view: WorkspaceView;
  readonly title: string;
  readonly agentOpen: boolean;
  readonly onAgent: () => void;
  readonly onSearch?: () => void;
};

/** Phone page header: large view title with round-rect actions on the right. */
export function MobileTopBar({ view, title, agentOpen, onAgent, onSearch }: Props) {
  const { t } = useI18n();
  if (!SHELL_TITLED_VIEWS.has(view)) return null;
  return (
    <header className="mobile-topbar" data-view={view}>
      <h1 className="mobile-topbar-title">{title}</h1>
      <div className="mobile-topbar-actions" role="group" aria-label={t("common.shell.pageActions")}>
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
    </header>
  );
}
