// Leaderboard building blocks: medal, row, the weekly league board with
// promotion/demotion zones, a compact project board, and the Team mode goal.
import { Fragment, useEffect, useId, useState, type CSSProperties, type ReactNode } from "react";
import type { EffectsIntensity, LeagueTier, NameEffectId } from "../../../lib/gamification/types";
import { Icon } from "../../Icon";
import { AvatarFrame, AvatarPlaceholder } from "./AvatarFrame";
import type { AvatarFrameId } from "./frames";
import { LeagueEmblem } from "./LeagueEmblem";
import { Nameplate } from "./Nameplate";
import type { EquippedTitle } from "./ProfileCard";
import {
  DEFAULT_LEAGUE_RULES,
  formatCountdown,
  goalProgress,
  hueForSeed,
  leagueZone,
  medalForPosition,
  rankByXp,
  type CountdownUnits,
  type LeagueZone,
  type LeagueZoneRules,
  type Medal,
} from "./rules";
import { TitleChip } from "./TitleChip";
import { cx, identityClass, useIdentityFx, useIdentityTone, type IdentityTone } from "./tone";
import "./Leaderboard.css";

export type LeaderboardPlayer = {
  readonly id: string;
  readonly name: string;
  readonly nameEffect?: NameEffectId;
  readonly frame?: AvatarFrameId;
  readonly avatar?: ReactNode;
  readonly level: number;
  /** XP for the board's period (weekly XP on league boards). */
  readonly xp: number;
  readonly title?: EquippedTitle;
};

export type LeaderboardLabels = {
  readonly xp: (xp: number) => string;
  readonly level: (level: number) => string;
  readonly you: string;
};

const DEFAULT_ROW_LABELS: LeaderboardLabels = {
  xp: (xp) => `${xp.toLocaleString("en-US")} XP`,
  level: (level) => `Lv ${level}`,
  you: "You",
};

const MEDAL_COLORS: Readonly<Record<Medal, { readonly metal: readonly string[]; readonly ribbon: readonly [string, string]; readonly ink: string }>> = {
  gold: { metal: ["#fff4c4", "#f6c445", "#b87a06"], ribbon: ["#f35f43", "#c43a22"], ink: "#5a3600" },
  silver: { metal: ["#ffffff", "#c8cfd7", "#7f8a96"], ribbon: ["#4b86f0", "#2451b8"], ink: "#38414b" },
  bronze: { metal: ["#f6cda6", "#c47a42", "#7d4219"], ribbon: ["#3fae6a", "#23784a"], ink: "#4a230a" },
};

export function RankMedal({ medal, position, size = 30 }: { readonly medal: Medal; readonly position: number; readonly size?: number }) {
  const colors = MEDAL_COLORS[medal];
  const gradient = `gi-medal-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  return (
    <svg className="gi-medal" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={gradient} x1="0" y1="0" x2="1" y2="1">
          {colors.metal.map((color, index) => (
            <stop key={index} offset={index / (colors.metal.length - 1)} stopColor={color} />
          ))}
        </linearGradient>
      </defs>
      <path d="M9 1 H14.5 L18 12 L12.5 13 Z" fill={colors.ribbon[1]} />
      <path d="M23 1 H17.5 L14 12 L19.5 13 Z" fill={colors.ribbon[0]} />
      <circle cx="16" cy="19.5" r="10.5" fill={`url(#${gradient})`} stroke="rgb(0 0 0 / 0.28)" strokeWidth="0.8" />
      <circle cx="16" cy="19.5" r="8.2" fill="none" stroke="rgb(255 255 255 / 0.6)" strokeWidth="0.8" />
      <text x="16" y="23.4" textAnchor="middle" fontSize="11" fontWeight="800" fill={colors.ink} fontFamily="inherit">
        {position}
      </text>
    </svg>
  );
}

export type LeaderboardRowProps = {
  readonly position: number;
  readonly player: LeaderboardPlayer;
  readonly zone?: LeagueZone;
  readonly isCurrentUser?: boolean;
  /** Hide the rank column (Team mode lists contributions without ranks). */
  readonly hideRank?: boolean;
  /** Denser row without the level line; for project boards. */
  readonly compact?: boolean;
  /** Replaces the XP value, e.g. "+320 XP" for contributions. */
  readonly valueText?: string;
  readonly labels?: Partial<LeaderboardLabels>;
  /** Extra leading element, e.g. a color swatch. */
  readonly leading?: ReactNode;
  readonly tone?: IdentityTone;
  readonly intensity?: EffectsIntensity;
};

export function LeaderboardRow({ position, player, zone, isCurrentUser = false, hideRank = false, compact = false, valueText, labels, leading, tone, intensity }: LeaderboardRowProps) {
  const resolvedTone = useIdentityTone(tone);
  const fx = useIdentityFx(intensity);
  const text = { ...DEFAULT_ROW_LABELS, ...labels };
  const medal = hideRank ? undefined : medalForPosition(position);
  return (
    <li
      className={cx("gi-lb-row", compact && "gi-lb-row--compact", zone && `gi-lb-row--${zone}`, isCurrentUser && "gi-lb-row--me", identityClass(resolvedTone, fx))}
      aria-current={isCurrentUser ? "true" : undefined}
    >
      {!hideRank && <span className="gi-lb-pos">{medal ? <RankMedal medal={medal} position={position} size={compact ? 26 : 30} /> : position}</span>}
      {leading}
      <AvatarFrame frame={player.frame ?? "none"} size={compact ? 32 : 40} tone={resolvedTone} intensity={intensity}>
        {player.avatar ?? <AvatarPlaceholder name={player.name} />}
      </AvatarFrame>
      <span className="gi-lb-who">
        <span className="gi-lb-name">
          <Nameplate name={player.name} effect={player.nameEffect ?? "plain"} size="sm" tone={resolvedTone} intensity={intensity} />
          {isCurrentUser && <span className="gi-lb-you">{text.you}</span>}
        </span>
        {!compact && (
          <span className="gi-lb-sub">
            <span>{text.level(player.level)}</span>
            {player.title && <TitleChip title={player.title.text} rarity={player.title.rarity} size="sm" tone={resolvedTone} intensity={intensity} />}
          </span>
        )}
      </span>
      <span className="gi-lb-xp">{valueText ?? text.xp(player.xp)}</span>
    </li>
  );
}

function useClock(intervalMs: number, fixed?: number): number {
  const [now, setNow] = useState(() => fixed ?? Date.now());
  useEffect(() => {
    if (fixed !== undefined) return;
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs, fixed]);
  return fixed ?? now;
}

export type LeagueBoardLabels = LeaderboardLabels & {
  readonly title: (tierName: string) => string;
  readonly endsIn: (time: string) => string;
  readonly promotion: string;
  readonly demotion: string;
  readonly advance: (count: number) => string;
  readonly units: CountdownUnits;
};

const DEFAULT_BOARD_LABELS: LeagueBoardLabels = {
  ...DEFAULT_ROW_LABELS,
  title: (tierName) => `${tierName} League`,
  endsIn: (time) => `Ends in ${time}`,
  promotion: "Promotion zone",
  demotion: "Demotion zone",
  advance: (count) => `Top ${count} advance to the next league`,
  units: { d: "d", h: "h", m: "m" },
};

export type LeagueBoardProps = {
  readonly tier: LeagueTier;
  readonly tierName?: string;
  readonly players: readonly LeaderboardPlayer[];
  readonly currentUserId?: string;
  /** Epoch ms when the week closes (Monday 00:00 UTC). */
  readonly endsAt: number;
  /** Fixed clock for tests and previews; the board ticks every 30s otherwise. */
  readonly now?: number;
  readonly rules?: LeagueZoneRules;
  readonly labels?: Partial<LeagueBoardLabels>;
  readonly tone?: IdentityTone;
  readonly intensity?: EffectsIntensity;
  readonly className?: string;
};

export function LeagueBoard({ tier, tierName, players, currentUserId, endsAt, now, rules = DEFAULT_LEAGUE_RULES, labels, tone, intensity, className }: LeagueBoardProps) {
  const resolvedTone = useIdentityTone(tone);
  const fx = useIdentityFx(intensity);
  const text = { ...DEFAULT_BOARD_LABELS, ...labels };
  const clock = useClock(30_000, now);
  const name = tierName ?? tier.charAt(0).toUpperCase() + tier.slice(1);
  const ranked = rankByXp(players);
  const zones = ranked.map((player) => leagueZone(player.position, ranked.length, tier, rules));
  const canPromote = zones.includes("promotion");

  return (
    <section className={cx("gi-lb", "gi-lb--league", identityClass(resolvedTone, fx), className)} data-tier={tier} aria-label={text.title(name)}>
      <header className="gi-lb-head">
        <LeagueEmblem tier={tier} size={52} label={text.title(name)} tone={resolvedTone} intensity={intensity} />
        <div className="gi-lb-head-text">
          <h3>{text.title(name)}</h3>
          {canPromote && <p>{text.advance(rules.promote)}</p>}
        </div>
        <span className="gi-lb-countdown">
          <Icon name="clock" width={13} height={13} strokeWidth={2} />
          {text.endsIn(formatCountdown(endsAt - clock, text.units))}
        </span>
      </header>
      <ol className="gi-lb-list">
        {ranked.map((player, index) => {
          const zone = zones[index];
          const previous = zones[index - 1];
          return (
            <Fragment key={player.id}>
              {previous === "promotion" && zone !== "promotion" && (
                <li className="gi-lb-divider gi-lb-divider--up" aria-hidden="true">
                  <span>
                    <Icon name="chevron-down" width={12} height={12} strokeWidth={2.4} style={{ rotate: "180deg" }} />
                    {text.promotion}
                  </span>
                </li>
              )}
              {zone === "demotion" && previous !== "demotion" && index > 0 && (
                <li className="gi-lb-divider gi-lb-divider--down" aria-hidden="true">
                  <span>
                    <Icon name="chevron-down" width={12} height={12} strokeWidth={2.4} />
                    {text.demotion}
                  </span>
                </li>
              )}
              <LeaderboardRow
                position={player.position}
                player={player}
                zone={zone}
                isCurrentUser={player.id === currentUserId}
                labels={text}
                tone={resolvedTone}
                intensity={intensity}
              />
            </Fragment>
          );
        })}
      </ol>
    </section>
  );
}

export type ProjectBoardPeriod = "week" | "all";

export type ProjectLeaderboardProps = {
  readonly title: string;
  readonly members: readonly LeaderboardPlayer[];
  readonly currentUserId?: string;
  readonly period: ProjectBoardPeriod;
  readonly onPeriodChange?: (period: ProjectBoardPeriod) => void;
  readonly labels?: Partial<LeaderboardLabels & { readonly week: string; readonly allTime: string }>;
  readonly tone?: IdentityTone;
  readonly intensity?: EffectsIntensity;
  readonly className?: string;
};

export function ProjectLeaderboard({ title, members, currentUserId, period, onPeriodChange, labels, tone, intensity, className }: ProjectLeaderboardProps) {
  const resolvedTone = useIdentityTone(tone);
  const fx = useIdentityFx(intensity);
  const text = { week: "This week", allTime: "All time", ...DEFAULT_ROW_LABELS, ...labels };
  const ranked = rankByXp(members);
  return (
    <section className={cx("gi-lb", "gi-lb--project", identityClass(resolvedTone, fx), className)} aria-label={title}>
      <header className="gi-lb-head gi-lb-head--compact">
        <h3>{title}</h3>
        <div className="gi-lb-seg" role="group">
          {(["week", "all"] as const).map((option) => (
            <button key={option} type="button" aria-pressed={period === option} onClick={() => onPeriodChange?.(option)}>
              {option === "week" ? text.week : text.allTime}
            </button>
          ))}
        </div>
      </header>
      <ol className="gi-lb-list">
        {ranked.map((member) => (
          <LeaderboardRow
            key={member.id}
            position={member.position}
            player={member}
            isCurrentUser={member.id === currentUserId}
            compact
            labels={text}
            tone={resolvedTone}
            intensity={intensity}
          />
        ))}
      </ol>
    </section>
  );
}

export type TeamProgressLabels = {
  readonly title: string;
  readonly progress: (current: string, goal: string) => string;
  readonly remaining: (xp: string) => string;
  readonly reached: string;
  readonly contribution: (xp: number) => string;
  readonly contributions: string;
  readonly formatXp: (xp: number) => string;
  readonly you: string;
};

const DEFAULT_TEAM_LABELS: TeamProgressLabels = {
  title: "Team goal",
  progress: (current, goal) => `${current} / ${goal} XP`,
  remaining: (xp) => `${xp} XP to go`,
  reached: "Goal reached!",
  contribution: (xp) => `+${xp.toLocaleString("en-US")} XP`,
  contributions: "Contributions this week",
  formatXp: (xp) => xp.toLocaleString("en-US"),
  you: "You",
};

export type TeamProgressProps = {
  readonly goal: number;
  readonly members: readonly LeaderboardPlayer[];
  readonly currentUserId?: string;
  /** Right side of the header, e.g. a countdown. */
  readonly aside?: ReactNode;
  readonly labels?: Partial<TeamProgressLabels>;
  readonly tone?: IdentityTone;
  readonly intensity?: EffectsIntensity;
  readonly className?: string;
};

export function TeamProgress({ goal, members, currentUserId, aside, labels, tone, intensity, className }: TeamProgressProps) {
  const resolvedTone = useIdentityTone(tone);
  const fx = useIdentityFx(intensity);
  const text = { ...DEFAULT_TEAM_LABELS, ...labels };
  const total = members.reduce((sum, member) => sum + member.xp, 0);
  const reached = total >= goal;
  // Contributions are listed alphabetically: Team mode never ranks teammates.
  const listed = [...members].sort((a, b) => a.name.localeCompare(b.name));
  let offset = 0;

  return (
    <section className={cx("gi-lb", "gi-lb--team", reached && "gi-lb--reached", identityClass(resolvedTone, fx), className)} aria-label={text.title}>
      <header className="gi-lb-head gi-lb-head--compact">
        <div className="gi-lb-head-text">
          <h3>{text.title}</h3>
          <p>{reached ? text.reached : text.remaining(text.formatXp(goal - total))}</p>
        </div>
        {aside}
      </header>
      <div className="gi-team-meter">
        <div
          className="gi-team-bar"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={goal}
          aria-valuenow={Math.min(total, goal)}
          aria-valuetext={text.progress(text.formatXp(total), text.formatXp(goal))}
        >
          {listed.map((member) => {
            const share = goalProgress(member.xp, goal);
            const start = offset;
            offset = Math.min(1, offset + share);
            return (
              <i
                key={member.id}
                style={{ left: `${start * 100}%`, width: `${Math.max(0, offset - start) * 100}%`, "--team-h": hueForSeed(member.id) } as CSSProperties}
              />
            );
          })}
          <b className="gi-team-shine" aria-hidden="true" style={{ width: `${goalProgress(total, goal) * 100}%` }} />
        </div>
        <span className="gi-team-count">{text.progress(text.formatXp(total), text.formatXp(goal))}</span>
      </div>
      <h4 className="gi-team-sub">{text.contributions}</h4>
      <ul className="gi-lb-list">
        {listed.map((member) => (
          <LeaderboardRow
            key={member.id}
            position={0}
            player={member}
            hideRank
            compact
            isCurrentUser={member.id === currentUserId}
            valueText={text.contribution(member.xp)}
            labels={{ you: text.you }}
            leading={<span className="gi-team-dot" style={{ "--team-h": hueForSeed(member.id) } as CSSProperties} aria-hidden="true" />}
            tone={resolvedTone}
            intensity={intensity}
          />
        ))}
      </ul>
    </section>
  );
}
