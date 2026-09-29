// How a player appears on leaderboards and their profile: framed avatar,
// nameplate, title, level and rank, league emblem and up to three pinned badges.
import type { ReactNode } from "react";
import type { EffectsIntensity, LeagueTier, NameEffectId, Rarity } from "../../../lib/gamification/types";
import type { IconName } from "../../Icon";
import { AchievementBadge } from "./AchievementBadge";
import { AvatarFrame, AvatarPlaceholder } from "./AvatarFrame";
import type { AvatarFrameId } from "./frames";
import { LeagueEmblem } from "./LeagueEmblem";
import { Nameplate } from "./Nameplate";
import { rankForLevel } from "./rules";
import { TitleChip } from "./TitleChip";
import { cx, identityClass, useIdentityFx, useIdentityTone, type IdentityTone } from "./tone";
import "./ProfileCard.css";

export type EquippedTitle = { readonly text: string; readonly rarity: Rarity };

export type PinnedBadge = { readonly id: string; readonly icon: IconName; readonly rarity: Rarity; readonly label: string };

export type ProfileCardLabels = {
  readonly level: (level: number) => string;
  readonly pinned: string;
  readonly league: (tierName: string) => string;
};

const DEFAULT_LABELS: ProfileCardLabels = {
  level: (level) => `Level ${level}`,
  pinned: "Pinned achievements",
  league: (tierName) => `${tierName} league`,
};

export type ProfileCardProps = {
  readonly name: string;
  readonly handle?: string;
  readonly nameEffect?: NameEffectId;
  readonly frame?: AvatarFrameId;
  /** Pet headshot or photo; a neutral placeholder is used when omitted. */
  readonly avatar?: ReactNode;
  readonly level: number;
  /** Rank name; derived from the level (English rank names) when omitted. */
  readonly rank?: string;
  /** 0–1 progress toward the next level, shown as a thin bar when provided. */
  readonly levelProgress?: number;
  readonly title?: EquippedTitle;
  /** At most three are shown. */
  readonly badges?: readonly PinnedBadge[];
  readonly league?: LeagueTier;
  /** Display name of the league tier, e.g. "Sapphire". */
  readonly leagueName?: string;
  readonly labels?: Partial<ProfileCardLabels>;
  readonly tone?: IdentityTone;
  readonly intensity?: EffectsIntensity;
  readonly className?: string;
};

export function ProfileCard({
  name,
  handle,
  nameEffect = "plain",
  frame = "common",
  avatar,
  level,
  rank,
  levelProgress,
  title,
  badges = [],
  league,
  leagueName,
  labels,
  tone,
  intensity,
  className,
}: ProfileCardProps) {
  const resolvedTone = useIdentityTone(tone);
  const fx = useIdentityFx(intensity);
  const text = { ...DEFAULT_LABELS, ...labels };
  const pinned = badges.slice(0, 3);
  const tierName = leagueName ?? (league ? league.charAt(0).toUpperCase() + league.slice(1) : "");

  return (
    <article className={cx("gi-pc", identityClass(resolvedTone, fx), className)} data-effect={nameEffect}>
      <div className="gi-pc-hero">
        <AvatarFrame frame={frame} size={76} level={level} levelLabel={text.level(level)} tone={resolvedTone} intensity={intensity}>
          {avatar ?? <AvatarPlaceholder name={name} />}
        </AvatarFrame>
        <div className="gi-pc-id">
          <h3 className="gi-pc-name">
            <Nameplate name={name} effect={nameEffect} size="lg" tone={resolvedTone} intensity={intensity} />
          </h3>
          {handle && <span className="gi-pc-handle">@{handle}</span>}
          <div className="gi-pc-meta">
            {title && <TitleChip title={title.text} rarity={title.rarity} size="sm" tone={resolvedTone} intensity={intensity} />}
            <span className="gi-pc-level">
              {text.level(level)} · <b>{rank ?? rankForLevel(level)}</b>
            </span>
            {league && (
              <span className="gi-pc-league-pill" aria-hidden="true">
                <LeagueEmblem tier={league} size={20} tone={resolvedTone} intensity="off" />
                {tierName}
              </span>
            )}
          </div>
          {levelProgress !== undefined && (
            <span className="gi-pc-progress" aria-hidden="true">
              <i style={{ transform: `scaleX(${Math.min(1, Math.max(0, levelProgress))})` }} />
            </span>
          )}
        </div>
        {league && (
          <div className="gi-pc-league" title={text.league(tierName)}>
            <LeagueEmblem tier={league} size={40} label={text.league(tierName)} tone={resolvedTone} intensity={intensity} />
            <span>{tierName}</span>
          </div>
        )}
      </div>
      {pinned.length > 0 && (
        <ul className="gi-pc-badges" aria-label={text.pinned}>
          {pinned.map((badge) => (
            <li key={badge.id}>
              <AchievementBadge icon={badge.icon} rarity={badge.rarity} label={badge.label} size={40} tone={resolvedTone} intensity={intensity} />
              <span>{badge.label}</span>
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}
