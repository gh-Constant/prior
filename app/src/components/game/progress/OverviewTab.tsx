// Overview: who you are on the boards, your level, streak, pet, chests and a
// few numbers. The left column carries identity and actions; the right one
// the living parts (streak, pet) and stats.
import { useMemo, type CSSProperties } from "react";
import { CATALOG, equippedAccessories } from "../../../lib/gamification/catalog";
import type { GameChest, GameState } from "../../../lib/gamification/state";
import { useI18n } from "../../../lib/i18n";
import { useResolvedTheme } from "../../../lib/theme";
import { Icon } from "../../Icon";
import { ChestSvg } from "../fx/ChestSvg";
import { StreakFlame } from "../fx/StreakFlame";
import { XpBar } from "../fx/XpBar";
import { StardustIcon } from "../identity/glyphs";
import { LeagueEmblem } from "../identity/LeagueEmblem";
import { ProfileCard } from "../identity/ProfileCard";
import { Pet } from "../pet/Pet";
import { FreezeGlyph, PlayerAvatar } from "./ProgressGlyphs";
import {
  chestSource,
  chestTitle,
  displayName,
  equippedFrameId,
  equippedNameEffect,
  equippedTitle,
  petMoodFor,
  pinnedBadges,
  rankName,
} from "./progressModel";

export type OverviewTabProps = {
  readonly state: GameState;
  readonly now?: number;
  readonly onOpenChest: (chest: GameChest) => void;
  readonly onOpenPet: () => void;
};

export function OverviewTab({ state, now, onOpenChest, onOpenPet }: OverviewTabProps) {
  const { t, tp, lang } = useI18n();
  const theme = useResolvedTheme();
  const { profile, achievements, inventory, chests } = state;
  const number = useMemo(() => new Intl.NumberFormat(lang), [lang]);
  const name = displayName(profile, t);
  const rank = rankName(profile.rank, t);
  const tierName = t(`game.leagues.${profile.leagueTier}`);
  const pet = profile.pet;
  const hatched = Boolean(pet?.species && pet.hatchedAt);
  const mood = petMoodFor(profile, now === undefined ? new Date() : new Date(now));
  const unlocked = achievements.filter((achievement) => achievement.unlockedAt).length;
  const owned = new Set(inventory.map((item) => item.itemId)).size;
  const { progress, streak } = profile;
  const remaining = Math.max(0, progress.xpForLevel - progress.xpInLevel);
  const daily = profile.dailyCapXp > 0 ? Math.min(1, profile.todayTaskXp / profile.dailyCapXp) : 0;

  return (
    <div className="gp-overview">
      <div className="gp-col">
        <ProfileCard
          className="gp-profile"
          name={name}
          nameEffect={equippedNameEffect(profile.equipped)}
          frame={equippedFrameId(profile.equipped)}
          avatar={<PlayerAvatar pet={hatched && pet?.species ? { species: pet.species, stage: pet.stage } : null} equipped={profile.equipped} name={name} />}
          level={progress.level}
          rank={rank}
          title={equippedTitle(profile.equipped, t)}
          badges={pinnedBadges(profile.pinnedAchievements, achievements, t)}
          league={profile.leagueTier}
          leagueName={tierName}
          labels={{
            level: (level) => t("game.xp.level", { level }),
            pinned: t("progress.achievements.pinnedList"),
            league: (tier) => t("game.leagueName", { tier }),
          }}
        />

        <section className="gp-card gp-level" aria-labelledby="gp-level-title">
          <header className="gp-card-head">
            <h2 id="gp-level-title">{t("progress.overview.levelTitle")}</h2>
            <span className="gp-card-meta">{t("game.xp.toNext", { xp: number.format(remaining), level: progress.level + 1 })}</span>
          </header>
          <XpBar
            level={progress.level}
            xpInLevel={progress.xpInLevel}
            xpForLevel={progress.xpForLevel}
            rank={rank}
            unitLabel={t("game.xp.unit")}
            ariaLabel={t("game.xp.level", { level: progress.level })}
          />
          <div className="gp-daily">
            <div className="gp-daily-row">
              <span>{t("progress.overview.maxDaily")}</span>
              <b>{t("progress.overview.todayXp", { xp: number.format(profile.todayTaskXp), cap: number.format(profile.dailyCapXp) })}</b>
            </div>
            <span
              className="gp-meter"
              role="progressbar"
              aria-label={t("progress.overview.maxDaily")}
              aria-valuemin={0}
              aria-valuemax={profile.dailyCapXp}
              aria-valuenow={Math.min(profile.todayTaskXp, profile.dailyCapXp)}
            >
              <i style={{ "--gp-fill": daily } as CSSProperties} />
              <span className="gp-meter-mark" style={{ left: `${(300 / Math.max(1, profile.dailyCapXp)) * 100}%` }} aria-hidden="true" />
            </span>
            <p className="gp-hint">{daily >= 1 ? t("game.xp.dailyCap") : t("progress.overview.dailyHint")}</p>
          </div>
        </section>

        <section className="gp-card gp-chests" aria-labelledby="gp-chests-title">
          <header className="gp-card-head">
            <h2 id="gp-chests-title" tabIndex={-1} data-chest-return="">
              {t("progress.overview.chestsTitle")}
            </h2>
            {chests.length > 0 && <span className="gp-count">{chests.length}</span>}
          </header>
          {chests.length === 0 ? (
            <p className="gp-empty">{t("progress.overview.chestsEmpty")}</p>
          ) : (
            <ul className="gp-chest-list">
              {chests.map((chest) => (
                <li key={chest.id} className="gp-chest" data-rarity={chest.tier}>
                  <span className="gp-chest-art" aria-hidden="true">
                    <ChestSvg tier={chest.tier} />
                  </span>
                  <span className="gp-chest-text">
                    <b>{chestTitle(chest.tier, t)}</b>
                    <span>{chestSource(chest, t)}</span>
                  </span>
                  <button type="button" className="gp-button gp-button--primary gp-button--sm" data-chest-open="" onClick={() => onOpenChest(chest)} aria-label={`${t("game.chest.open")}: ${chestTitle(chest.tier, t)}`}>
                    {t("game.chest.open")}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <div className="gp-col">
        <section className="gp-card gp-streak" aria-labelledby="gp-streak-title">
          <header className="gp-card-head">
            <h2 id="gp-streak-title">{t("progress.overview.streakTitle")}</h2>
            {streak.best > 0 && <span className="gp-card-meta">{tp("progress.overview.best", streak.best, { count: number.format(streak.best) })}</span>}
          </header>
          <div className="gp-streak-body">
            <StreakFlame
              days={streak.current}
              freeze={streak.freezes > 0 ? "held" : "none"}
              freezes={streak.freezes}
              size={72}
              label={tp("progress.overview.streakCaption", streak.current)}
              ariaLabel={t("game.streak.days", { count: streak.current })}
            />
          </div>
          {streak.current === 0 && <p className="gp-hint">{t("progress.overview.streakEmpty")}</p>}
          <p className="gp-freeze">
            <span className="gp-freeze-icon" aria-hidden="true">
              <FreezeGlyph size={14} />
            </span>
            <span>{streak.freezes > 0 ? tp("progress.overview.freezes", streak.freezes) : t("progress.overview.noFreezes")}</span>
          </p>
          <p className="gp-hint">{t("progress.overview.freezeHint")}</p>
        </section>

        <section className="gp-card gp-petcard" aria-labelledby="gp-pet-title">
          <header className="gp-card-head">
            <h2 id="gp-pet-title">{t("progress.overview.petTitle")}</h2>
          </header>
          <button type="button" className="gp-petcard-link" onClick={onOpenPet}>
            <span className="gp-petcard-art" aria-hidden="true">
              {hatched && pet?.species ? (
                <Pet species={pet.species} stage={pet.stage} mood={mood} accessories={equippedAccessories(profile.equipped)} size={104} zoom={1.05} backdrop={theme} decorative />
              ) : (
                <Pet species="mochi" stage="egg" mysteryEgg mood="content" size={96} backdrop={theme} decorative />
              )}
            </span>
            <span className="gp-petcard-text">
              {hatched && pet?.species ? (
                <>
                  <b>{pet.name || t(`game.species.${pet.species}`)}</b>
                  <span>
                    {t(`game.species.${pet.species}`)} · {t(`game.stages.${pet.stage}`)}
                  </span>
                  <span className="gp-mood" data-mood={mood}>
                    {t(`game.moods.${mood}`)}
                  </span>
                </>
              ) : (
                <>
                  <b>{t("progress.overview.eggTitle")}</b>
                  <span>{t("progress.overview.eggHint")}</span>
                </>
              )}
              <span className="gp-link">
                {t("progress.overview.visitDen")}
                <Icon name="chevron-right" width={14} height={14} strokeWidth={2} />
              </span>
            </span>
          </button>
        </section>

        <section className="gp-card gp-stats" aria-labelledby="gp-stats-title">
          <header className="gp-card-head">
            <h2 id="gp-stats-title">{t("progress.overview.statsTitle")}</h2>
          </header>
          <dl className="gp-stat-grid">
            <div className="gp-stat">
              <dt>{t("progress.overview.stats.totalXp")}</dt>
              <dd>{number.format(profile.xp)}</dd>
            </div>
            <div className="gp-stat">
              <dt>{t("progress.overview.stats.bestStreak")}</dt>
              <dd>{tp("progress.overview.days", streak.best, { count: number.format(streak.best) })}</dd>
            </div>
            <div className="gp-stat">
              <dt>{t("progress.overview.stats.achievements")}</dt>
              <dd>{t("progress.overview.ofTotal", { count: unlocked, total: achievements.length })}</dd>
            </div>
            <div className="gp-stat">
              <dt>{t("progress.overview.stats.items")}</dt>
              <dd>{t("progress.overview.ofTotal", { count: owned, total: CATALOG.size })}</dd>
            </div>
            <div className="gp-stat">
              <dt>{t("progress.overview.stats.stardust")}</dt>
              <dd className="gp-stat-icon">
                <StardustIcon size={14} />
                {number.format(profile.stardust)}
              </dd>
            </div>
            <div className="gp-stat">
              <dt>{t("progress.overview.stats.league")}</dt>
              <dd className="gp-stat-icon">
                <LeagueEmblem tier={profile.leagueTier} size={18} intensity="off" />
                {tierName}
              </dd>
            </div>
          </dl>
        </section>
      </div>
    </div>
  );
}
