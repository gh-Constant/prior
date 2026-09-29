// Opens one chest: asks the server for its contents (rolled when the chest
// was granted), then plays the fx ChestOpening with those rewards. Keyboard
// first: focus starts on the chest, stays inside the dialog, Escape closes and
// focus returns to whatever opened it. Reused by the level-up "Open chest".
import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { catalogEntry, equippedConfetti } from "../../../lib/gamification/catalog";
import { gameStore, useGame } from "../../../lib/gamification/gameStore";
import type { ChestDrop, GameChest } from "../../../lib/gamification/state";
import { useI18n } from "../../../lib/i18n";
import { Icon } from "../../Icon";
import { ChestOpening, type ChestReward } from "../fx/ChestOpening";
import { ChestSvg } from "../fx/ChestSvg";
import { RewardIcon } from "./ProgressGlyphs";
import { chestRewards, chestSource, chestTitle, type ChestRewardData } from "./progressModel";
import "./ChestDialog.css";

export type ChestDialogProps = {
  readonly chest: GameChest;
  readonly onClose: () => void;
  /** Opens the chest on the server; gameStore.openChest by default (tests and the lab pass fixtures). */
  readonly openChest?: (chestId: string) => Promise<ChestDrop[]>;
  /** Stardust before opening; read from the game state by default. */
  readonly stardust?: number;
};

type Phase = { readonly status: "loading" } | { readonly status: "ready"; readonly rewards: readonly ChestRewardData[] } | { readonly status: "error" };

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';

export function toChestRewards(rewards: readonly ChestRewardData[]): ChestReward[] {
  return rewards.map((reward) => ({
    id: reward.id,
    label: reward.label,
    rarity: reward.rarity,
    kind: reward.kindLabel,
    icon: <RewardIcon entry={catalogEntry(reward.itemId)} />,
    duplicate: reward.duplicate,
    stardust: reward.stardust,
  }));
}

export function ChestDialog({ chest, onClose, openChest = gameStore.openChest, stardust }: ChestDialogProps) {
  const { t } = useI18n();
  const { profile } = useGame();
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<Element | null>(typeof document !== "undefined" ? document.activeElement : null);
  // Captured before opening: the store refreshes (and adds the dust) as soon as the server answers.
  const [startDust] = useState(() => stardust ?? profile?.stardust ?? 0);
  const [theme] = useState(() => equippedConfetti(profile?.equipped));
  const [phase, setPhase] = useState<Phase>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [opened, setOpened] = useState(false);
  const started = useRef(-1);
  const mounted = useRef(true);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // One request per attempt, even under StrictMode's double effects.
  useEffect(() => {
    if (started.current === attempt) return;
    started.current = attempt;
    setPhase({ status: "loading" });
    openChest(chest.id).then(
      (drops) => {
        if (mounted.current) setPhase({ status: "ready", rewards: chestRewards(drops, t) });
      },
      () => {
        if (mounted.current) setPhase({ status: "error" });
      },
    );
  }, [attempt, chest.id, openChest, t]);

  // Focus the chest (or the retry button) whenever the stage changes.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const target =
      phase.status === "ready"
        ? dialog.querySelector<HTMLElement>(".fx-chestopen-chest")
        : phase.status === "error"
          ? dialog.querySelector<HTMLElement>("[data-autofocus]")
          : dialog;
    target?.focus({ preventScroll: true });
  }, [phase.status]);

  // Once the rewards are in, hand focus to "Collect" as soon as it appears.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!opened || !dialog || typeof MutationObserver === "undefined") return;
    const focusCollect = () => {
      const collect = dialog.querySelector<HTMLElement>(".fx-chestopen-collect");
      if (!collect) return false;
      collect.focus({ preventScroll: true });
      return true;
    };
    if (focusCollect()) return;
    const observer = new MutationObserver(() => {
      if (focusCollect()) observer.disconnect();
    });
    observer.observe(dialog, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [opened]);

  // Return focus to the opener; when it left with the chest, to the next chest or the chest list.
  useEffect(
    () => () => {
      const opener = openerRef.current;
      const target = opener instanceof HTMLElement && document.contains(opener) ? opener : document.querySelector<HTMLElement>("[data-chest-open], [data-chest-return]");
      target?.focus({ preventScroll: true });
    },
    [],
  );

  // Escape closes from anywhere, before other global shortcuts see it.
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      closeRef.current();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  const onKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Tab") return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const focusable = [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((node) => !node.closest("[aria-hidden='true']"));
    if (focusable.length === 0) {
      event.preventDefault();
      dialog.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }, []);

  const title = chestTitle(chest.tier, t);
  const rarityLabels = {
    common: t("game.rarity.common"),
    rare: t("game.rarity.rare"),
    epic: t("game.rarity.epic"),
    legendary: t("game.rarity.legendary"),
  };

  const dialog = (
    <div
      className="gp-chestdlg-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className="gp-chestdlg"
        data-rarity={chest.tier}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={onKeyDown}
      >
        <header className="gp-chestdlg-head">
          <div>
            <h2 id={titleId}>{title}</h2>
            <p>{chestSource(chest, t)}</p>
          </div>
          <button type="button" className="gp-chestdlg-close" aria-label={t("progress.chests.close")} onClick={onClose}>
            <Icon name="close" width={16} height={16} />
          </button>
        </header>

        {phase.status === "ready" ? (
          <ChestOpening
            tier={chest.tier}
            items={toChestRewards(phase.rewards)}
            stardust={startDust}
            theme={theme}
            openLabel={t("progress.chests.openLabel")}
            chestLabel={t("progress.chests.chestLabel", { tier: title })}
            duplicateLabel={t("game.chest.duplicate")}
            stardustLabel={t("game.chest.stardust")}
            collectLabel={t("game.chest.collect")}
            rarityLabels={rarityLabels}
            onOpened={() => setOpened(true)}
            onDone={onClose}
          />
        ) : phase.status === "error" ? (
          <div className="gp-chestdlg-state" role="alert">
            <span className="gp-chestdlg-stage" aria-hidden="true">
              <span className="gp-chestdlg-chest is-dim">
                <ChestSvg tier={chest.tier} />
              </span>
            </span>
            <p>{t("game.chest.failed")}</p>
            <div className="gp-chestdlg-actions">
              <button type="button" className="gp-chestdlg-button" onClick={onClose}>
                {t("progress.chests.close")}
              </button>
              <button type="button" className="gp-chestdlg-button gp-chestdlg-button--primary" data-autofocus onClick={() => setAttempt((count) => count + 1)}>
                <Icon name="refresh" width={14} height={14} />
                {t("progress.retry")}
              </button>
            </div>
          </div>
        ) : (
          <div className="gp-chestdlg-state" aria-busy="true">
            <span className="gp-chestdlg-stage" aria-hidden="true">
              <span className="gp-chestdlg-chest is-waiting">
                <ChestSvg tier={chest.tier} />
              </span>
            </span>
            <p role="status">{t("progress.chests.opening")}</p>
          </div>
        )}
      </div>
    </div>
  );

  return typeof document === "undefined" ? dialog : createPortal(dialog, document.body);
}
