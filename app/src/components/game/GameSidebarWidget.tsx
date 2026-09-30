// The gamified mode's home in the sidebar: the pet, the streak and the XP bar
// that completion labels fly into. Renders nothing in Calm mode.
import { useEffect, useState } from "react";
import { useI18n } from "../../lib/i18n";
import { equippedAccessories } from "../../lib/gamification/catalog";
import { registerXpTarget, usePetReaction } from "../../lib/gamification/celebrations";
import { useGame } from "../../lib/gamification/gameStore";
import type { GameProfile } from "../../lib/gamification/state";
import type { PetMood, PetReaction } from "../../lib/gamification/types";
import { StreakFlame } from "./fx/StreakFlame";
import { XpBar } from "./fx/XpBar";
import { PetCompanion, PetHeadshot } from "./pet";
import { petMoodFor } from "./progress/progressModel";
import "./GameSidebarWidget.css";

type Props = {
  readonly collapsed: boolean;
  readonly onOpenProgress: () => void;
};

const HAPPY_MS = 15 * 60_000;
const EXCITED_MS = 5 * 60_000;

/**
 * The pet never suffers: it naps when you're away and perks up when you're
 * back. A completion or level-up a moment ago shows first; otherwise the
 * shared rules of the Progress page decide.
 */
export function petMood(profile: Pick<GameProfile, "streak" | "timeZone">, now: Date, lastReaction: { reaction: PetReaction; at: number } | null): PetMood {
  const since = lastReaction ? now.getTime() - lastReaction.at : Number.POSITIVE_INFINITY;
  if (lastReaction?.reaction === "dance" && since < EXCITED_MS) return "excited";
  if (since < HAPPY_MS) return "happy";
  return petMoodFor(profile, now);
}

export function GameSidebarWidget({ collapsed, onOpenProgress }: Props) {
  const { enabled, profile } = useGame();
  if (!enabled || !profile) return null;
  return <GameSidebarPanel profile={profile} collapsed={collapsed} onOpenProgress={onOpenProgress} />;
}

/** The widget for a given profile, without the store (the Game Lab renders it from fixtures). */
export function GameSidebarPanel({ profile, collapsed, onOpenProgress }: Props & { readonly profile: GameProfile }) {
  const { t } = useI18n();
  const { reaction, key } = usePetReaction();
  const [lastReaction, setLastReaction] = useState<{ reaction: PetReaction; at: number } | null>(null);
  const [now, setNow] = useState(() => new Date());
  const [xpBar, setXpBar] = useState<HTMLDivElement | null>(null);

  useEffect(() => registerXpTarget(xpBar), [xpBar]);
  useEffect(() => {
    if (reaction) setLastReaction({ reaction, at: Date.now() });
  }, [reaction, key]);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const pet = profile.pet;
  const hatched = Boolean(pet && pet.stage !== "egg" && pet.species);
  const species = pet?.species ?? "mochi";
  const name = pet?.name || (pet?.species ? t(`game.species.${pet.species}`) : t("game.sidebar.yourPet"));
  const mood = petMood(profile, now, lastReaction);
  const accessories = equippedAccessories(profile.equipped);
  const rank = t(`game.ranks.${profile.rank}`);
  const level = profile.progress.level;

  if (collapsed) {
    return (
      <button type="button" className="game-sidebar-mini" onClick={onOpenProgress} title={`${t("game.xp.level", { level })} · ${rank}`} aria-label={t("game.sidebar.openProgress")}>
        {pet && <PetHeadshot species={species} stage={hatched ? pet.stage : "egg"} mysteryEgg={!hatched} accessories={accessories} size={30} background="tint" decorative />}
        <span className="game-sidebar-mini-level">{level}</span>
      </button>
    );
  }

  return (
    <section className="game-sidebar" aria-label={t("game.nav.progress")}>
      <div className="game-sidebar-row">
        {pet && (
          <PetCompanion
            species={species}
            stage={pet.stage}
            mood={hatched ? mood : "content"}
            name={hatched ? name : t("game.stages.egg")}
            moodLabel={hatched ? t(`game.moods.${mood}`) : t("game.sidebar.waitingToHatch")}
            actionLabel={t("game.sidebar.petAction", { name })}
            accessories={accessories}
            mysteryEgg={!hatched}
            reaction={reaction}
            reactionKey={key}
            size={48}
            backdrop="dark"
            className="game-sidebar-pet"
          />
        )}
        <button type="button" className="game-sidebar-open" onClick={onOpenProgress} title={t("game.sidebar.openProgress")}>
          <StreakFlame days={profile.streak.current} freeze={profile.streak.freezes > 0 ? "held" : "none"} freezes={profile.streak.freezes} size={24} countPosition="beside" ariaLabel={t("game.streak.days", { count: profile.streak.current })} />
        </button>
      </div>
      <button type="button" className="game-sidebar-xp" onClick={onOpenProgress} aria-label={t("game.sidebar.openProgress")}>
        <XpBar
          ref={setXpBar}
          compact
          level={level}
          xpInLevel={profile.progress.xpInLevel}
          xpForLevel={profile.progress.xpForLevel}
          rank={rank}
          unitLabel={t("game.xp.unit")}
          ariaLabel={t("game.xp.level", { level })}
        />
      </button>
    </section>
  );
}
