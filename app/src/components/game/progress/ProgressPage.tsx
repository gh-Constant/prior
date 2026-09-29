// The Progress page: overview, leagues, achievements, inventory and the pet's
// den. Presentational: every piece of data and every action comes in through
// props (see ProgressView for the live wiring), so tests and the Game Lab can
// render it from fixtures.
import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import type { GameBoard, GameChest, GameLeague, GameState } from "../../../lib/gamification/state";
import { useI18n } from "../../../lib/i18n";
import { useResolvedTheme } from "../../../lib/theme";
import { Icon, type IconName } from "../../Icon";
import { IdentityToneProvider } from "../identity/tone";
import { Pet } from "../pet/Pet";
import { AchievementsTab } from "./AchievementsTab";
import { InventoryTab } from "./InventoryTab";
import { LeaguesTab } from "./LeaguesTab";
import { OverviewTab } from "./OverviewTab";
import { PetTab } from "./PetTab";
import type { EquipSlot } from "./progressModel";
import "./ProgressPage.css";

export type ProgressTab = "overview" | "leagues" | "achievements" | "inventory" | "pet";

export const PROGRESS_TABS: readonly ProgressTab[] = ["overview", "leagues", "achievements", "inventory", "pet"];

const TAB_ICONS: Readonly<Record<ProgressTab, IconName>> = {
  overview: "activity",
  leagues: "award",
  achievements: "star",
  inventory: "gift",
  pet: "heart",
};

export type LeagueData = {
  readonly status: "idle" | "loading" | "ready" | "error";
  readonly league: GameLeague | null;
  readonly level: GameBoard | null;
  readonly streak: GameBoard | null;
  /** The last failure happened without a network connection. */
  readonly offline?: boolean;
};

export const IDLE_LEAGUES: LeagueData = { status: "idle", league: null, level: null, streak: null };

export type ProgressPageProps = {
  readonly state: GameState | null;
  /** The account chose the gamified experience. */
  readonly enabled: boolean;
  readonly loading?: boolean;
  /** Controlled tab; the page keeps its own when omitted. */
  readonly tab?: ProgressTab;
  readonly defaultTab?: ProgressTab;
  readonly onTabChange?: (tab: ProgressTab) => void;
  readonly leagues: LeagueData;
  readonly onRetryLeagues?: () => void;
  /** Reload the game state when nothing could be shown. */
  readonly onRetry?: () => void;
  readonly onOpenGameSettings: () => void;
  readonly onOpenChest: (chest: GameChest) => void;
  /** Equip an item, or empty the slot with an empty itemId. */
  readonly onEquip: (slot: EquipSlot, itemId: string) => Promise<unknown> | void;
  readonly onPinAchievements: (ids: string[]) => Promise<unknown> | void;
  readonly onRenamePet: (name: string) => Promise<unknown> | void;
  readonly onCraft: (itemId: string) => Promise<unknown>;
  /** Fixed clock (epoch ms) for tests and previews: pet mood and countdowns. */
  readonly now?: number;
  readonly className?: string;
};

function isPromise(value: unknown): value is Promise<unknown> {
  return typeof value === "object" && value !== null && typeof (value as Promise<unknown>).then === "function";
}

export function ProgressPage({
  state,
  enabled,
  loading = false,
  tab: controlledTab,
  defaultTab = "overview",
  onTabChange,
  leagues,
  onRetryLeagues,
  onRetry,
  onOpenGameSettings,
  onOpenChest,
  onEquip,
  onPinAchievements,
  onRenamePet,
  onCraft,
  now,
  className,
}: ProgressPageProps) {
  const { t } = useI18n();
  const theme = useResolvedTheme();
  const [ownTab, setOwnTab] = useState<ProgressTab>(defaultTab);
  const tab = controlledTab ?? ownTab;
  const [notice, setNotice] = useState<string | null>(null);
  const baseId = useId().replace(/[^a-zA-Z0-9_-]/g, "");

  const selectTab = useCallback(
    (next: ProgressTab) => {
      setOwnTab(next);
      onTabChange?.(next);
    },
    [onTabChange],
  );

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 6000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  // Actions are fire-and-forget for the tabs; a failure surfaces once, here.
  const guard = useCallback(
    <A extends unknown[]>(action: (...args: A) => Promise<unknown> | void) =>
      (...args: A): Promise<void> => {
        try {
          const result = action(...args);
          if (!isPromise(result)) return Promise.resolve();
          return result.then(
            () => undefined,
            () => setNotice(t("progress.saveFailed")),
          );
        } catch {
          setNotice(t("progress.saveFailed"));
          return Promise.resolve();
        }
      },
    [t],
  );

  const equip = useCallback((slot: EquipSlot, itemId: string) => guard(onEquip)(slot, itemId), [guard, onEquip]);
  const pin = useCallback((ids: string[]) => guard(onPinAchievements)(ids), [guard, onPinAchievements]);
  const rename = useCallback((name: string) => guard(onRenamePet)(name), [guard, onRenamePet]);

  let body: ReactNode;
  if (!state) {
    body = loading ? <LoadingState /> : <UnavailableState onRetry={onRetry} />;
  } else if (!enabled) {
    body = <DisabledInvite onOpenGameSettings={onOpenGameSettings} />;
  } else {
    body = (
      <>
        <ProgressTabs baseId={baseId} tab={tab} onSelect={selectTab} chestCount={state.chests.length} />
        <div id={`${baseId}-panel`} role="tabpanel" aria-labelledby={`${baseId}-tab-${tab}`} className="gp-panel" data-tab={tab}>
          {tab === "overview" && <OverviewTab state={state} now={now} onOpenChest={onOpenChest} onOpenPet={() => selectTab("pet")} />}
          {tab === "leagues" && <LeaguesTab profile={state.profile} data={leagues} now={now} onRetry={onRetryLeagues} onOpenGameSettings={onOpenGameSettings} />}
          {tab === "achievements" && <AchievementsTab achievements={state.achievements} pinned={state.profile.pinnedAchievements} onPin={pin} />}
          {tab === "inventory" && <InventoryTab state={state} onEquip={equip} onPin={pin} onCraft={onCraft} />}
          {tab === "pet" && <PetTab state={state} now={now} onEquip={equip} onRename={rename} />}
        </div>
      </>
    );
  }

  return (
    <IdentityToneProvider tone={theme}>
      <div className={["gp", `gi-${theme}`, className].filter(Boolean).join(" ")}>
        <header className="workspace-header gp-header">
          <h1>{t("game.nav.progress")}</h1>
        </header>
        {notice && (
          <div className="gp-notice" role="alert">
            <Icon name="cloud" width={16} height={16} />
            <span>{notice}</span>
            <button type="button" className="gp-icon-button" aria-label={t("progress.dismiss")} onClick={() => setNotice(null)}>
              <Icon name="close" width={14} height={14} />
            </button>
          </div>
        )}
        {body}
      </div>
    </IdentityToneProvider>
  );
}

function ProgressTabs({ baseId, tab, onSelect, chestCount }: { readonly baseId: string; readonly tab: ProgressTab; readonly onSelect: (tab: ProgressTab) => void; readonly chestCount: number }) {
  const { t } = useI18n();
  const listRef = useRef<HTMLDivElement>(null);

  // Keep the selected tab in view on narrow screens, where the strip scrolls
  // sideways. Horizontal only: the page itself never moves.
  useEffect(() => {
    const list = listRef.current;
    const selected = list?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!list || !selected || list.scrollWidth <= list.clientWidth) return;
    const bounds = list.getBoundingClientRect();
    const rect = selected.getBoundingClientRect();
    if (rect.left < bounds.left) list.scrollLeft -= bounds.left - rect.left + 16;
    else if (rect.right > bounds.right) list.scrollLeft += rect.right - bounds.right + 16;
  }, [tab]);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const index = PROGRESS_TABS.indexOf(tab);
    let next: ProgressTab | undefined;
    if (event.key === "ArrowRight") next = PROGRESS_TABS[(index + 1) % PROGRESS_TABS.length];
    else if (event.key === "ArrowLeft") next = PROGRESS_TABS[(index + PROGRESS_TABS.length - 1) % PROGRESS_TABS.length];
    else if (event.key === "Home") next = PROGRESS_TABS[0];
    else if (event.key === "End") next = PROGRESS_TABS[PROGRESS_TABS.length - 1];
    if (!next) return;
    event.preventDefault();
    onSelect(next);
    document.getElementById(`${baseId}-tab-${next}`)?.focus();
  }

  return (
    <div ref={listRef} className="gp-tabs" role="tablist" aria-label={t("progress.tabsLabel")} onKeyDown={onKeyDown}>
      {PROGRESS_TABS.map((option) => (
        <button
          key={option}
          id={`${baseId}-tab-${option}`}
          type="button"
          role="tab"
          aria-selected={tab === option}
          aria-controls={`${baseId}-panel`}
          tabIndex={tab === option ? 0 : -1}
          className="gp-tab"
          onClick={() => onSelect(option)}
        >
          <Icon name={TAB_ICONS[option]} width={15} height={15} strokeWidth={1.8} />
          <span>{t(`progress.tabs.${option}`)}</span>
          {option === "overview" && chestCount > 0 && <span className="gp-tab-dot" aria-hidden="true">{chestCount}</span>}
        </button>
      ))}
    </div>
  );
}

function DisabledInvite({ onOpenGameSettings }: { readonly onOpenGameSettings: () => void }) {
  const { t } = useI18n();
  const features: readonly { readonly key: string; readonly icon: IconName }[] = [
    { key: "levels", icon: "trending-up" },
    { key: "pet", icon: "heart" },
    { key: "chests", icon: "gift" },
    { key: "leagues", icon: "award" },
  ];
  return (
    <section className="gp-card gp-invite" aria-labelledby="gp-invite-title">
      <div className="gp-invite-art" aria-hidden="true">
        <Pet species="mochi" stage="egg" mysteryEgg mood="content" size={132} decorative />
      </div>
      <div className="gp-invite-text">
        <span className="gp-eyebrow">{t("progress.disabled.eyebrow")}</span>
        <h2 id="gp-invite-title">{t("progress.disabled.title")}</h2>
        <p>{t("progress.disabled.body")}</p>
        <ul className="gp-invite-features">
          {features.map((feature) => (
            <li key={feature.key}>
              <Icon name={feature.icon} width={15} height={15} strokeWidth={1.8} />
              {t(`progress.disabled.features.${feature.key}`)}
            </li>
          ))}
        </ul>
        <button type="button" className="gp-button gp-button--primary" onClick={onOpenGameSettings}>
          <Icon name="sparkles" width={15} height={15} strokeWidth={1.8} />
          {t("progress.disabled.cta")}
        </button>
      </div>
    </section>
  );
}

function LoadingState() {
  const { t } = useI18n();
  return (
    <div className="gp-loading" role="status" aria-live="polite">
      <span className="gp-sr">{t("progress.loading")}</span>
      <div className="gp-skeleton gp-skeleton--tabs" />
      <div className="gp-loading-grid" aria-hidden="true">
        <div className="gp-skeleton gp-skeleton--hero" />
        <div className="gp-skeleton gp-skeleton--side" />
        <div className="gp-skeleton gp-skeleton--bar" />
      </div>
    </div>
  );
}

function UnavailableState({ onRetry }: { readonly onRetry?: () => void }) {
  const { t } = useI18n();
  return (
    <section className="gp-card gp-empty-state">
      <span className="gp-empty-icon" aria-hidden="true">
        <Icon name="cloud" width={22} height={22} />
      </span>
      <h2>{t("progress.unavailable.title")}</h2>
      <p>{t("progress.unavailable.body")}</p>
      {onRetry && (
        <button type="button" className="gp-button" onClick={onRetry}>
          <Icon name="refresh" width={14} height={14} />
          {t("progress.retry")}
        </button>
      )}
    </section>
  );
}
