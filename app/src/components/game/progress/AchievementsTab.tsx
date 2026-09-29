// Achievements by category: progress toward locked ones, secret ones kept
// anonymous until earned, rewards they unlock, and pinning (three at most) for
// the profile card.
import { useMemo, type CSSProperties } from "react";
import { achievementIcon } from "../../../lib/gamification/catalog";
import type { GameAchievement } from "../../../lib/gamification/state";
import { useI18n } from "../../../lib/i18n";
import { Icon } from "../../Icon";
import { AchievementBadge } from "../identity/AchievementBadge";
import { achievementGroups, achievementProgress, isHiddenSecret, togglePin } from "./progressModel";

export type AchievementsTabProps = {
  readonly achievements: readonly GameAchievement[];
  readonly pinned: readonly string[];
  readonly onPin: (ids: string[]) => void;
};

export function AchievementsTab({ achievements, pinned, onPin }: AchievementsTabProps) {
  const { t, lang } = useI18n();
  const groups = useMemo(() => achievementGroups(achievements), [achievements]);
  const unlocked = achievements.filter((achievement) => achievement.unlockedAt).length;
  const date = useMemo(() => new Intl.DateTimeFormat(lang, { day: "numeric", month: "short", year: "numeric" }), [lang]);
  const number = useMemo(() => new Intl.NumberFormat(lang), [lang]);
  const share = achievements.length > 0 ? unlocked / achievements.length : 0;

  return (
    <div className="gp-achievements">
      <section className="gp-card gp-ach-summary">
        <div className="gp-ach-summary-text">
          <b>{t("progress.achievements.summary", { count: unlocked, total: achievements.length })}</b>
          <span className="gp-meter gp-meter--wide" aria-hidden="true">
            <i style={{ "--gp-fill": share } as CSSProperties} />
          </span>
        </div>
        <p className="gp-hint">
          <span className="gp-pill gp-pill--quiet">
            <Icon name="bookmark" width={12} height={12} strokeWidth={2} />
            {t("progress.achievements.pinned", { count: pinned.length })}
          </span>
          {t("progress.achievements.pinHint")}
        </p>
      </section>

      {groups.map((group) => (
        <section key={group.category} className="gp-ach-group" aria-labelledby={`gp-ach-${group.category}`}>
          <header className="gp-section-head">
            <h2 id={`gp-ach-${group.category}`}>{t(`game.achievementCategories.${group.category}`)}</h2>
            <span className="gp-card-meta">{t("progress.achievements.category", { count: group.unlocked, total: group.items.length })}</span>
          </header>
          <ul className="gp-ach-grid">
            {group.items.map((achievement) => (
              <AchievementTile
                key={achievement.id}
                achievement={achievement}
                pinned={pinned.includes(achievement.id)}
                onTogglePin={() => onPin(togglePin(pinned, achievement.id))}
                formatDate={(value) => date.format(new Date(value))}
                formatNumber={(value) => number.format(value)}
              />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function AchievementTile({
  achievement,
  pinned,
  onTogglePin,
  formatDate,
  formatNumber,
}: {
  readonly achievement: GameAchievement;
  readonly pinned: boolean;
  readonly onTogglePin: () => void;
  readonly formatDate: (value: string) => string;
  readonly formatNumber: (value: number) => string;
}) {
  const { t } = useI18n();
  const hidden = isHiddenSecret(achievement);
  const unlocked = Boolean(achievement.unlockedAt);
  const progress = achievementProgress(achievement);
  const target = achievement.target ?? 0;
  const name = hidden ? t("game.secretAchievement") : t(`game.achievements.${achievement.id}.name`);
  const description = hidden ? t("progress.achievements.secretHint") : t(`game.achievements.${achievement.id}.description`);
  const rewards = [achievement.border, achievement.title].filter((id): id is string => Boolean(id)).map((id) => t(`game.items.${id}`));
  const rarity = t(`game.rarity.${achievement.rarity}`);

  return (
    <li className={["gp-ach", unlocked ? "is-unlocked" : "is-locked", hidden ? "is-secret" : "", pinned ? "is-pinned" : ""].filter(Boolean).join(" ")} data-rarity={hidden ? undefined : achievement.rarity}>
      <AchievementBadge
        icon={hidden ? "sparkles" : achievementIcon(achievement.id)}
        rarity={hidden ? "common" : achievement.rarity}
        label={unlocked ? `${name}, ${rarity}` : name}
        locked={!unlocked}
        progress={!unlocked && !hidden ? progress : undefined}
        size={56}
      />
      <div className="gp-ach-body">
        <div className="gp-ach-top">
          <h3>{name}</h3>
          {!hidden && <span className="gp-rarity">{rarity}</span>}
        </div>
        <p className="gp-ach-desc">{description}</p>
        {!unlocked && !hidden && target > 0 && (
          <div className="gp-ach-progress">
            <span className="gp-meter" aria-hidden="true">
              <i style={{ "--gp-fill": progress ?? 0 } as CSSProperties} />
            </span>
            <span className="gp-ach-count">
              {formatNumber(Math.min(achievement.progress, target))}/{formatNumber(target)}
            </span>
          </div>
        )}
        {!hidden && rewards.length > 0 && (
          <p className="gp-ach-reward">
            <Icon name="gift" width={12} height={12} strokeWidth={2} />
            {t("progress.achievements.unlocks", { items: rewards.join(" · ") })}
          </p>
        )}
        {unlocked && achievement.unlockedAt && <p className="gp-ach-date">{t("progress.achievements.unlockedOn", { date: formatDate(achievement.unlockedAt) })}</p>}
      </div>
      {unlocked && (
        <button
          type="button"
          className="gp-pin"
          aria-pressed={pinned}
          aria-label={pinned ? t("progress.achievements.unpinLabel", { name }) : t("progress.achievements.pinLabel", { name })}
          title={pinned ? t("progress.achievements.unpinLabel", { name }) : t("progress.achievements.pinLabel", { name })}
          onClick={onTogglePin}
        >
          <Icon name="bookmark" width={13} height={13} strokeWidth={2} fill={pinned ? "currentColor" : "none"} />
          <span>{pinned ? t("progress.achievements.unpin") : t("progress.achievements.pin")}</span>
        </button>
      )}
    </li>
  );
}
