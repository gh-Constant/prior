// Leagues: this week's cohort with its zones and countdown, last week's
// result, and the all-time Level and Streak boards. Hidden players and players
// not placed yet get a friendly explanation instead of an empty board.
import { useEffect, useMemo, useState } from "react";
import type { GameBoard, GameLeague, GamePlayer, GameProfile } from "../../../lib/gamification/state";
import { useI18n } from "../../../lib/i18n";
import { Icon } from "../../Icon";
import { LeaderboardRow, LeagueBoard, type LeaderboardPlayer } from "../identity/Leaderboard";
import { LeagueEmblem } from "../identity/LeagueEmblem";
import { formatCountdown } from "../identity/rules";
import { cx, identityClass, useIdentityFx, useIdentityTone } from "../identity/tone";
import type { LeagueData } from "./ProgressPage";
import { PlayerAvatar } from "./ProgressGlyphs";
import { boardEntries, displayName, equippedFrameId, equippedNameEffect, equippedTitle, playerId, type Translate } from "./progressModel";

export type LeaguesTabProps = {
  readonly profile: GameProfile;
  readonly data: LeagueData;
  readonly now?: number;
  readonly onRetry?: () => void;
  readonly onOpenGameSettings: () => void;
};

function toRow(player: GamePlayer, t: Translate, xp: number): LeaderboardPlayer {
  const name = displayName(player, t);
  return {
    id: playerId(player),
    name,
    nameEffect: equippedNameEffect(player.equipped),
    frame: equippedFrameId(player.equipped),
    avatar: <PlayerAvatar pet={player.pet} equipped={player.equipped} name={player.handle ?? t(`game.animals.${player.anonymous ?? "otter"}`)} />,
    level: player.level,
    xp,
    title: equippedTitle(player.equipped, t),
  };
}

function useNow(fixed?: number): number {
  const [now, setNow] = useState(() => fixed ?? Date.now());
  useEffect(() => {
    if (fixed !== undefined) return;
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, [fixed]);
  return fixed ?? now;
}

export function LeaguesTab({ profile, data, now, onRetry, onOpenGameSettings }: LeaguesTabProps) {
  const { t, tp, lang } = useI18n();
  const number = useMemo(() => new Intl.NumberFormat(lang), [lang]);
  const clock = useNow(now);
  const units = { d: t("progress.leagues.units.d"), h: t("progress.leagues.units.h"), m: t("progress.leagues.units.m") };
  const hidden = profile.visibility === "hidden";
  const { league } = data;

  if (data.status === "error" && !league && !data.level && !data.streak) {
    return (
      <section className="gp-card gp-empty-state">
        <span className="gp-empty-icon" aria-hidden="true">
          <Icon name="cloud" width={22} height={22} />
        </span>
        <p>{data.offline ? t("progress.leagues.offline") : t("progress.leagues.failed")}</p>
        {onRetry && (
          <button type="button" className="gp-button" onClick={onRetry}>
            <Icon name="refresh" width={14} height={14} />
            {t("progress.retry")}
          </button>
        )}
      </section>
    );
  }

  const loading = !league && (data.status === "loading" || data.status === "idle");

  return (
    <div className="gp-leagues">
      <div className="gp-col">
        {league?.lastResult && <LastWeek result={league.lastResult} />}
        {hidden ? (
          <section className="gp-card gp-callout" aria-labelledby="gp-hidden-title">
            <span className="gp-callout-icon" aria-hidden="true">
              <Icon name="eye" width={20} height={20} />
            </span>
            <div>
              <h2 id="gp-hidden-title">{t("progress.leagues.hiddenTitle")}</h2>
              <p>{t("progress.leagues.hiddenBody")}</p>
              <button type="button" className="gp-button" onClick={onOpenGameSettings}>
                <Icon name="sliders" width={14} height={14} />
                {t("progress.leagues.hiddenCta")}
              </button>
            </div>
          </section>
        ) : loading ? (
          <div className="gp-skeleton gp-skeleton--board" aria-hidden="true" />
        ) : league && league.joined && league.members.length > 0 ? (
          <LeagueBoard
            tier={league.tier}
            tierName={t(`game.leagues.${league.tier}`)}
            players={league.members.map((member) => toRow(member, t, member.weeklyXp))}
            currentUserId="me"
            endsAt={Date.parse(league.endsAt)}
            now={now}
            rules={{ promote: league.promote, demote: league.demote }}
            labels={{
              title: (tier) => t("game.leagueName", { tier }),
              endsIn: (time) => t("progress.leagues.endsIn", { time }),
              promotion: t("progress.leagues.promotion"),
              demotion: t("progress.leagues.demotion"),
              advance: (count) => tp("progress.leagues.advance", count),
              units,
              xp: (xp) => `${number.format(xp)} ${t("game.xp.unit")}`,
              level: (level) => t("game.xp.levelShort", { level }),
              you: t("progress.leagues.you"),
            }}
          />
        ) : (
          <WaitingLeague tier={league?.tier ?? profile.leagueTier} endsAt={league ? Date.parse(league.endsAt) : undefined} clock={clock} units={units} />
        )}
        {data.status === "error" && (
          <p className="gp-inline-error" role="status">
            {data.offline ? t("progress.leagues.offline") : t("progress.leagues.failed")}
            {onRetry && (
              <button type="button" className="gp-link-button" onClick={onRetry}>
                {t("progress.retry")}
              </button>
            )}
          </p>
        )}
      </div>
      <div className="gp-col">
        <AllTimeBoards level={data.level} streak={data.streak} loading={data.status === "loading" && !data.level && !data.streak} />
      </div>
    </div>
  );
}

function LastWeek({ result }: { readonly result: NonNullable<GameLeague["lastResult"]> }) {
  const { t } = useI18n();
  const tier = t(`game.leagues.${result.tier}`);
  const key = result.outcome === "promoted" ? "leaguePromoted" : result.outcome === "demoted" ? "leagueDemoted" : "leagueStayed";
  return (
    <section className="gp-card gp-lastweek" data-outcome={result.outcome}>
      <LeagueEmblem tier={result.tier} size={40} intensity="off" />
      <div>
        <span className="gp-eyebrow">{t("progress.leagues.lastWeek")}</span>
        <b>{t(`game.toasts.${key}`, { tier })}</b>
        <span>{t("game.toasts.leagueBody", { rank: result.rank })}</span>
      </div>
      <span className="gp-outcome" aria-hidden="true">
        <Icon name={result.outcome === "stayed" ? "anchor" : "chevron-down"} width={16} height={16} strokeWidth={2.2} style={result.outcome === "promoted" ? { rotate: "180deg" } : undefined} />
      </span>
    </section>
  );
}

function WaitingLeague({ tier, endsAt, clock, units }: { readonly tier: GameLeague["tier"]; readonly endsAt?: number; readonly clock: number; readonly units: { d: string; h: string; m: string } }) {
  const { t } = useI18n();
  const tierName = t(`game.leagues.${tier}`);
  return (
    <section className="gp-card gp-waiting" data-tier={tier} aria-labelledby="gp-waiting-title">
      <LeagueEmblem tier={tier} size={72} label={t("game.leagueName", { tier: tierName })} />
      <h2 id="gp-waiting-title">{t("progress.leagues.waitingTitle", { tier: tierName })}</h2>
      <p>{t("progress.leagues.waitingBody")}</p>
      {endsAt !== undefined && Number.isFinite(endsAt) && (
        <span className="gp-pill">
          <Icon name="clock" width={13} height={13} strokeWidth={2} />
          {t("progress.leagues.newWeek", { time: formatCountdown(endsAt - clock, units) })}
        </span>
      )}
    </section>
  );
}

type BoardKind = "level" | "streak";

function AllTimeBoards({ level, streak, loading }: { readonly level: GameBoard | null; readonly streak: GameBoard | null; readonly loading: boolean }) {
  const { t, tp, lang } = useI18n();
  const tone = useIdentityTone();
  const fx = useIdentityFx();
  const [kind, setKind] = useState<BoardKind>("level");
  const number = useMemo(() => new Intl.NumberFormat(lang), [lang]);
  const board = kind === "level" ? level : streak;
  const entries = board ? boardEntries(board) : null;
  const value = (player: GamePlayer) =>
    kind === "level" ? `${number.format(player.xp)} ${t("game.xp.unit")}` : tp("progress.leagues.streakValue", player.streak, { count: number.format(player.streak) });
  const labels = { level: (value: number) => t("game.xp.levelShort", { level: value }), you: t("progress.leagues.you") };

  return (
    <section className={cx("gi-lb", "gp-alltime", identityClass(tone, fx))} aria-labelledby="gp-alltime-title">
      <header className="gi-lb-head gi-lb-head--compact">
        <h3 id="gp-alltime-title">{t("progress.leagues.allTime")}</h3>
        <div className="gi-lb-seg" role="group" aria-label={t("progress.leagues.boardsLabel")}>
          {(["level", "streak"] as const).map((option) => (
            <button key={option} type="button" aria-pressed={kind === option} onClick={() => setKind(option)}>
              {t(`progress.leagues.boards.${option}`)}
            </button>
          ))}
        </div>
      </header>
      {loading ? (
        <div className="gp-rows-skeleton" aria-hidden="true">
          {Array.from({ length: 5 }, (_, index) => (
            <span key={index} className="gp-skeleton gp-skeleton--row" />
          ))}
        </div>
      ) : !entries || entries.rows.length === 0 ? (
        <p className="gp-empty gp-empty--board">{t("progress.leagues.boardEmpty")}</p>
      ) : (
        <ol className="gi-lb-list">
          {entries.rows.map((player) => (
            <LeaderboardRow
              key={playerId(player)}
              position={player.position}
              player={toRow(player, t, player.xp)}
              isCurrentUser={player.isMe}
              valueText={value(player)}
              labels={labels}
            />
          ))}
          {entries.me && (
            <>
              {entries.gap && (
                <li className="gp-board-gap" aria-hidden="true">
                  <span />
                </li>
              )}
              <LeaderboardRow position={entries.me.position} player={toRow(entries.me, t, entries.me.xp)} isCurrentUser valueText={value(entries.me)} labels={labels} />
            </>
          )}
        </ol>
      )}
    </section>
  );
}
