// Turns the server's game events into the moments the player sees: level-up,
// hatching, the first-activation welcome and toasts. Each event is shown once
// and acknowledged so other devices don't replay it.
import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "../../lib/i18n";
import { achievementIcon, equippedConfetti } from "../../lib/gamification/catalog";
import { emitPetReaction, gameSound } from "../../lib/gamification/celebrations";
import { gameStore, useGame } from "../../lib/gamification/gameStore";
import type { GameEvent } from "../../lib/gamification/state";
import type { PetSpecies, Rarity } from "../../lib/gamification/types";
import { RARITY_ORDER } from "../../lib/gamification/types";
import { Icon, type IconName } from "../Icon";
import { Modal } from "../Modal";
import { AchievementToastStack, useAchievementToasts } from "./fx/AchievementToast";
import { LevelUpOverlay } from "./fx/LevelUpOverlay";
import { PetHatchScene } from "./pet";
import "./GameCelebrations.css";

type Moment =
  | { readonly kind: "level"; readonly from: number; readonly level: number; readonly chestId: string | null; readonly chestTier: Rarity | null }
  | { readonly kind: "hatch"; readonly species: PetSpecies }
  | { readonly kind: "backfill"; readonly tasks: number; readonly level: number };

type Props = {
  /** Opens a chest the player chose to open from the level-up screen. */
  readonly onOpenChest: (chestId: string) => void;
};

const MOMENT_ORDER: Record<Moment["kind"], number> = { backfill: 0, hatch: 1, level: 2 };

export function GameCelebrations({ onOpenChest }: Props) {
  const { t } = useI18n();
  const game = useGame();
  const { toasts, push, dismiss } = useAchievementToasts();
  const [queue, setQueue] = useState<readonly Moment[]>([]);
  const [petName, setPetName] = useState("");
  // The hatch scene plays when its key changes after mount: start it once
  // the dialog has had a moment to appear.
  const [hatchKey, setHatchKey] = useState(0);
  const toastCounter = useRef(0);
  const moment = queue[0] ?? null;

  const toast = useCallback((title: string, description: string | undefined, rarity: Rarity, icon: IconName, extra?: { eyebrow?: string; reward?: string }) => {
    push({ id: `game-toast-${++toastCounter.current}`, title, description, rarity, icon: <Icon name={icon} />, ...extra });
  }, [push]);

  // Events are acknowledged only once every moment they queued was shown, so
  // a reload mid-celebration replays what was missed instead of losing it.
  const pendingAck = useRef(0);
  const queueLength = useRef(0);
  queueLength.current = queue.length;
  const flushAck = useCallback(() => {
    const upTo = pendingAck.current;
    if (upTo <= 0) return;
    pendingAck.current = 0;
    void gameStore.ackEvents(upTo);
  }, []);

  const handle = useCallback((events: readonly GameEvent[]): number => {
    const moments: Moment[] = [];
    const levels: { reached: number; chestId: string | null; chestTier: Rarity | null }[] = [];
    for (const event of events) {
      const payload = event.payload;
      switch (event.kind) {
        case "level_up": {
          const reached = Number(payload.level) || 0;
          const chestId = typeof payload.chestId === "string" && payload.chestId ? payload.chestId : null;
          const chestTier = (payload.chestTier as Rarity | undefined) ?? null;
          levels.push({ reached, chestId, chestTier });
          break;
        }
        case "pet_hatched":
          moments.push({ kind: "hatch", species: payload.species as PetSpecies });
          break;
        case "backfill":
          moments.push({ kind: "backfill", tasks: Number(payload.tasks) || 0, level: Number(payload.level) || 1 });
          break;
        case "achievement_unlocked": {
          const id = String(payload.id);
          const rarity = (payload.rarity as Rarity) ?? "common";
          toast(t(`game.achievements.${id}.name`), t(`game.achievements.${id}.description`), rarity, achievementIcon(id), {
            eyebrow: `${t("game.toasts.achievement")} · ${t(`game.rarity.${rarity}`)}`,
            reward: payload.xp ? t("game.xp.gained", { xp: Number(payload.xp) }) : undefined,
          });
          gameSound("achievement");
          break;
        }
        case "streak_milestone":
          toast(t("game.toasts.streakMilestone", { days: Number(payload.days) }), t("game.toasts.streakMilestoneBody", { tier: t(`game.rarity.${String(payload.chestTier ?? "rare")}`).toLowerCase() }), (payload.chestTier as Rarity) ?? "rare", "flame");
          break;
        case "freeze_used":
          toast(t("game.toasts.freezeUsed"), t("game.toasts.freezeUsedBody", { days: Number(payload.streak) }), "rare", "shield");
          break;
        case "kudos_received":
          toast(t("game.toasts.kudos", { name: String(payload.from ?? "") }), t("game.toasts.kudosBody", { task: String(payload.task ?? "") }), "common", "heart", {
            reward: payload.xp ? t("game.xp.gained", { xp: Number(payload.xp) }) : undefined,
          });
          break;
        case "pet_evolved": {
          const name = gameStore.getSnapshot().profile?.pet?.name || t("game.sidebar.yourPet");
          toast(t("game.toasts.petEvolved", { name }), t("game.toasts.petEvolvedBody", { stage: t(`game.stages.${String(payload.stage)}`).toLowerCase() }), "epic", "sparkles");
          break;
        }
        case "league_result": {
          const outcome = String(payload.outcome);
          const tier = t(`game.leagues.${String(payload.to)}`);
          const title = outcome === "promoted" ? t("game.toasts.leaguePromoted", { tier }) : outcome === "demoted" ? t("game.toasts.leagueDemoted", { tier }) : t("game.toasts.leagueStayed", { tier });
          toast(title, t("game.toasts.leagueBody", { rank: Number(payload.rank) }), outcome === "promoted" ? "epic" : "common", outcome === "promoted" ? "trending-up" : "award");
          break;
        }
      }
    }
    // Several levels at once play one overlay counting up through them; the
    // rarest chest among them is the one offered.
    if (levels.length) {
      const rank = (tier: Rarity | null) => (tier ? RARITY_ORDER.indexOf(tier) : -1);
      const chest = levels.filter((entry) => entry.chestId).sort((a, b) => rank(b.chestTier) - rank(a.chestTier))[0];
      moments.push({
        kind: "level",
        from: Math.min(...levels.map((entry) => entry.reached)) - 1,
        level: Math.max(...levels.map((entry) => entry.reached)),
        chestId: chest?.chestId ?? null,
        chestTier: chest?.chestTier ?? null,
      });
    }
    if (moments.length) setQueue((current) => [...current, ...moments].sort((a, b) => MOMENT_ORDER[a.kind] - MOMENT_ORDER[b.kind]));
    return moments.length;
  }, [t, toast]);

  // New events arrive with each refresh of the game state (after a sync).
  useEffect(() => {
    if (!game.enabled) return;
    const events = gameStore.takeNewEvents();
    if (!events.length) return;
    pendingAck.current = Math.max(pendingAck.current, ...events.map((event) => event.id));
    if (handle(events) === 0 && queueLength.current === 0) flushAck();
  }, [game.state, game.enabled, handle, flushAck]);

  useEffect(() => {
    if (queue.length === 0) flushAck();
  }, [queue, flushAck]);

  useEffect(() => {
    if (moment?.kind === "hatch") {
      const timer = window.setTimeout(() => setHatchKey((key) => key + 1), 600);
      return () => window.clearTimeout(timer);
    }
    if (moment?.kind !== "level") return undefined;
    emitPetReaction("dance");
    gameSound("levelUp");
    return undefined;
  }, [moment]);

  const next = useCallback(() => {
    setPetName("");
    setQueue((current) => current.slice(1));
  }, []);

  const confetti = equippedConfetti(game.profile?.equipped);

  return (
    <>
      <AchievementToastStack toasts={toasts} onDismiss={dismiss} dismissLabel={t("game.toasts.dismiss")} regionLabel={t("game.toasts.region")} defaultEyebrow={t("game.toasts.achievement")} />
      {moment?.kind === "level" && (
        <LevelUpOverlay
          open
          level={moment.level}
          fromLevel={moment.from}
          rank={t(`game.ranks.${rankId(moment.level)}`)}
          rankIsNew={Math.floor(moment.level / 10) > Math.floor(moment.from / 10)}
          chest={moment.chestId ? moment.chestTier : null}
          theme={confetti}
          title={t("game.levelUp.title")}
          newRankLabel={t("game.levelUp.newRank")}
          rankLabel={t("game.levelUp.rank")}
          chestTitle={t("game.levelUp.chestTitle")}
          chestLabel={moment.chestTier ? t("game.levelUp.chestLabel", { tier: t(`game.rarity.${moment.chestTier}`) }) : undefined}
          openChestLabel={t("game.levelUp.openChest")}
          laterLabel={t("game.levelUp.later")}
          skipHint={t("game.levelUp.skipHint")}
          announcement={t("game.levelUp.announcement", { level: moment.level })}
          onClose={next}
          onOpenChest={moment.chestId ? () => { const chestId = moment.chestId; next(); if (chestId) onOpenChest(chestId); } : undefined}
        />
      )}
      {moment?.kind === "hatch" && (
        <Modal title={t("game.hatch.title")} onClose={next} className="game-moment" maxWidth={420}>
          <div className="game-moment-body">
            <PetHatchScene
              species={moment.species}
              hatchKey={hatchKey || undefined}
              onHatched={() => gameSound("chest")}
              size={180}
              rareLabel={t("game.hatch.rare")}
              revealContent={<span className="game-moment-species">{t("game.hatch.meet", { species: t(`game.species.${moment.species}`) })}</span>}
            />
            <p className="game-moment-text">{t(`game.speciesDescriptions.${moment.species}`)}</p>
            <form className="game-moment-name" onSubmit={(event) => { event.preventDefault(); const name = petName.trim(); if (name) void gameStore.setPetName(name).catch(() => undefined); next(); }}>
              <label htmlFor="game-pet-name">{t("game.hatch.nameLabel")}</label>
              <div className="game-moment-name-row">
                <input id="game-pet-name" className="prior-modal-input" value={petName} maxLength={24} placeholder={t("game.hatch.namePlaceholder")} onChange={(event) => setPetName(event.target.value)} autoComplete="off" />
                <button type="submit" className="prior-modal-button-primary" disabled={!petName.trim()}>{t("game.hatch.keep")}</button>
              </div>
              <button type="button" className="game-moment-skip" onClick={next}>{t("game.hatch.skip")}</button>
            </form>
          </div>
        </Modal>
      )}
      {moment?.kind === "backfill" && (
        <Modal title={t("game.backfill.title")} onClose={next} className="game-moment" maxWidth={420}>
          <div className="game-moment-body">
            <div className="game-moment-level" aria-hidden="true">{moment.level}</div>
            <p className="game-moment-text">{t("game.backfill.body", { tasks: moment.tasks, level: moment.level })}</p>
            <button type="button" className="prior-modal-button-primary" onClick={next} autoFocus>{t("game.backfill.cta")}</button>
          </div>
        </Modal>
      )}
    </>
  );
}

const RANK_IDS = ["spark", "ember", "flame", "blaze", "nova", "comet", "star", "nebula", "galaxy", "infinity"] as const;

function rankId(level: number): (typeof RANK_IDS)[number] {
  return RANK_IDS[Math.min(Math.floor(Math.max(level, 1) / 10), RANK_IDS.length - 1)];
}
