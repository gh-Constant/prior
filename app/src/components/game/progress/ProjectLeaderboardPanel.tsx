// A project's leaderboard (specs/GAMIFICATION.md §7): the owner picks Off,
// Competitive or Team (with a weekly goal); each member opts in once, silently
// and reversibly. Real names are fine here: it is among teammates.
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { api } from "../../../lib/api";
import { getToken } from "../../../lib/auth";
import { useGame } from "../../../lib/gamification/gameStore";
import type { ProjectLeaderboard as ProjectBoard, ProjectLeaderboardMode } from "../../../lib/gamification/state";
import { useI18n } from "../../../lib/i18n";
import { useResolvedTheme } from "../../../lib/theme";
import { Icon } from "../../Icon";
import { ProjectLeaderboard, TeamProgress, type LeaderboardPlayer, type ProjectBoardPeriod } from "../identity/Leaderboard";
import { formatCountdown } from "../identity/rules";
import { IdentityToneProvider } from "../identity/tone";
import { PlayerAvatar } from "./ProgressGlyphs";
import { equippedFrameId, equippedNameEffect, equippedTitle, isOffline, suggestedTeamGoal, teamGoal, weekEnd, type Translate } from "./progressModel";
import "./ProjectLeaderboardPanel.css";

const MODES: readonly ProjectLeaderboardMode[] = ["off", "competitive", "team"];

export function projectBoardPlayers(board: ProjectBoard, period: ProjectBoardPeriod, t: Translate): LeaderboardPlayer[] {
  return board.members.map((member) => ({
    id: member.userId,
    name: member.displayName,
    nameEffect: equippedNameEffect(member.equipped),
    frame: equippedFrameId(member.equipped),
    avatar: <PlayerAvatar pet={member.pet} equipped={member.equipped} name={member.displayName} photoUrl={member.avatarUrl || undefined} />,
    level: member.level,
    xp: period === "week" ? member.weeklyXp : member.totalXp,
    title: equippedTitle(member.equipped, t),
  }));
}

export type ProjectLeaderboardCardProps = {
  readonly board: ProjectBoard;
  /** The viewer chose the gamified experience (calm owners only see the controls). */
  readonly viewerEnabled: boolean;
  readonly onModeChange: (mode: ProjectLeaderboardMode, teamGoalXp: number) => Promise<unknown> | void;
  readonly onChoice: (joined: boolean) => Promise<unknown> | void;
  readonly busy?: boolean;
  readonly error?: string | null;
  /** Fixed clock for tests and previews. */
  readonly now?: number;
  readonly className?: string;
};

/** Presentational card: owner controls, opt-in prompt and the board itself. */
export function ProjectLeaderboardCard({ board, viewerEnabled, onModeChange, onChoice, busy = false, error, now, className }: ProjectLeaderboardCardProps) {
  const { t, lang } = useI18n();
  const theme = useResolvedTheme();
  const number = useMemo(() => new Intl.NumberFormat(lang), [lang]);
  const [period, setPeriod] = useState<ProjectBoardPeriod>("week");
  const goal = teamGoal(board);
  const [goalDraft, setGoalDraft] = useState(String(goal));
  const goalId = useId();
  const headingId = useId();
  const clock = now ?? Date.now();
  const units = { d: t("progress.leagues.units.d"), h: t("progress.leagues.units.h"), m: t("progress.leagues.units.m") };
  const resetsIn = t("progress.project.resetsIn", { time: formatCountdown(weekEnd(board.weekStart) - clock, units) });
  const me = board.members.find((member) => member.isMe);
  const canChoose = viewerEnabled && board.mode !== "off";

  useEffect(() => setGoalDraft(String(goal)), [goal]);

  const parsedGoal = Math.round(Number(goalDraft));
  const goalValid = Number.isFinite(parsedGoal) && parsedGoal >= 50 && parsedGoal <= 1_000_000;

  const xp = (value: number) => `${number.format(value)} ${t("game.xp.unit")}`;
  const rowLabels = { xp, level: (level: number) => t("game.xp.levelShort", { level }), you: t("progress.leagues.you") };

  return (
    <IdentityToneProvider tone={theme}>
      <section className={["gp-plb", className].filter(Boolean).join(" ")} aria-labelledby={headingId}>
        <header className="gp-plb-head">
          <span className="gp-plb-icon" aria-hidden="true">
            <Icon name="award" width={16} height={16} strokeWidth={1.8} />
          </span>
          <div>
            <h3 id={headingId}>{t("progress.project.title")}</h3>
            <p>{t(`progress.project.modeHints.${board.mode}`)}</p>
          </div>
        </header>

        {board.isOwner && (
          <div className="gp-plb-owner">
            <div className="gp-plb-modes" role="radiogroup" aria-label={t("progress.project.modeLabel")}>
              {MODES.map((mode) => (
                <button
                  key={mode}
                  type="button"
                  role="radio"
                  aria-checked={board.mode === mode}
                  disabled={busy}
                  onClick={() => board.mode !== mode && onModeChange(mode, mode === "team" ? goal : board.teamGoalXp)}
                >
                  {t(`progress.project.modes.${mode}`)}
                  {mode === "team" && board.mode === "off" && <span className="gp-plb-suggested">{t("progress.project.suggested")}</span>}
                </button>
              ))}
            </div>
            {board.mode === "team" && (
              <form
                className="gp-plb-goal"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (goalValid && parsedGoal !== board.teamGoalXp) void onModeChange("team", parsedGoal);
                }}
              >
                <label htmlFor={goalId}>{t("progress.project.goalLabel")}</label>
                <span className="gp-plb-goal-field">
                  <input
                    id={goalId}
                    type="number"
                    inputMode="numeric"
                    min={50}
                    max={1_000_000}
                    step={50}
                    value={goalDraft}
                    placeholder={String(suggestedTeamGoal(board.members.length))}
                    onChange={(event) => setGoalDraft(event.target.value)}
                  />
                  <span aria-hidden="true">{t("game.xp.unit")}</span>
                </span>
                <button type="submit" className="gp-plb-button" disabled={busy || !goalValid || parsedGoal === board.teamGoalXp}>
                  {t("progress.project.goalSave")}
                </button>
              </form>
            )}
            <p className="gp-plb-note">{viewerEnabled ? t("progress.project.ownerHint") : t("progress.project.calmOwner")}</p>
          </div>
        )}

        {canChoose && board.myChoice === null && (
          <div className="gp-plb-optin" role="group" aria-label={t("progress.project.optInTitle")}>
            <b>{t("progress.project.optInTitle")}</b>
            <p>{t("progress.project.optInBody")}</p>
            <div className="gp-plb-actions">
              <button type="button" className="gp-plb-button" disabled={busy} onClick={() => onChoice(false)}>
                {t("progress.project.notNow")}
              </button>
              <button type="button" className="gp-plb-button gp-plb-button--primary" disabled={busy} onClick={() => onChoice(true)}>
                {t("progress.project.join")}
              </button>
            </div>
          </div>
        )}

        {error && (
          <p className="gp-plb-error" role="alert">
            {error}
          </p>
        )}

        {board.mode === "competitive" && (
          board.members.length === 0 ? (
            <p className="gp-plb-empty">{t("progress.project.empty")}</p>
          ) : (
            <ProjectLeaderboard
              className="gp-plb-board"
              title={resetsIn}
              members={projectBoardPlayers(board, period, t)}
              currentUserId={me?.userId}
              period={period}
              onPeriodChange={setPeriod}
              labels={{ ...rowLabels, week: t("progress.project.week"), allTime: t("progress.project.allTime") }}
            />
          )
        )}

        {board.mode === "team" && (
          <TeamProgress
            className="gp-plb-board"
            goal={goal}
            members={projectBoardPlayers(board, "week", t)}
            currentUserId={me?.userId}
            aside={
              <span className="gi-lb-countdown">
                <Icon name="clock" width={13} height={13} strokeWidth={2} />
                {resetsIn}
              </span>
            }
            labels={{
              title: t("progress.project.teamTitle"),
              progress: (current, target) => t("progress.project.teamProgress", { current, goal: target }),
              remaining: (value) => t("progress.project.teamRemaining", { xp: value }),
              reached: t("progress.project.teamReached"),
              contribution: (value) => `+${xp(value)}`,
              contributions: t("progress.project.contributions"),
              formatXp: (value) => number.format(value),
              you: t("progress.leagues.you"),
            }}
          />
        )}

        {canChoose && board.myChoice !== null && (
          <p className="gp-plb-choice">
            <Icon name={board.myChoice ? "check-circle" : "eye"} width={14} height={14} />
            <span>{board.myChoice ? t("progress.project.joined") : t("progress.project.declined")}</span>
            <button type="button" className="gp-plb-link" disabled={busy} onClick={() => onChoice(!board.myChoice)}>
              {board.myChoice ? t("progress.project.leave") : t("progress.project.join")}
            </button>
          </p>
        )}
      </section>
    </IdentityToneProvider>
  );
}

type PanelState = { readonly status: "loading" | "ready" | "error"; readonly board: ProjectBoard | null };

/** Live panel: fetches the project's board and sends owner and member choices. */
export function ProjectLeaderboardPanel({ projectId, className }: { readonly projectId: string; readonly className?: string }) {
  const { t } = useI18n();
  const { enabled } = useGame();
  const [state, setState] = useState<PanelState>({ status: "loading", board: null });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const request = useRef(0);

  const load = useCallback(async () => {
    const id = ++request.current;
    try {
      const token = await getToken();
      if (!token) throw new Error("signed out");
      const board = await api.getProjectLeaderboard(projectId, token);
      if (id === request.current) setState({ status: "ready", board });
    } catch {
      if (id === request.current) setState((current) => ({ status: current.board ? "ready" : "error", board: current.board }));
    }
  }, [projectId]);

  useEffect(() => {
    setState({ status: "loading", board: null });
    setError(null);
    void load();
  }, [load]);

  const run = useCallback(
    async (action: (token: string) => Promise<unknown>) => {
      setBusy(true);
      setError(null);
      try {
        const token = await getToken();
        if (!token) throw new Error("signed out");
        await action(token);
        await load();
      } catch {
        setError(isOffline() ? t("progress.leagues.offline") : t("progress.project.saveFailed"));
      } finally {
        setBusy(false);
      }
    },
    [load, t],
  );

  const board = state.board;
  // Calm members never see it; a calm owner still manages it for the team.
  if (!enabled && !board?.isOwner) return null;
  if (!board) {
    if (state.status === "loading") return <div className={["gp-plb gp-plb--loading", className].filter(Boolean).join(" ")} aria-hidden="true" />;
    return (
      <section className={["gp-plb", className].filter(Boolean).join(" ")}>
        <p className="gp-plb-error" role="alert">
          {isOffline() ? t("progress.leagues.offline") : t("progress.project.loadFailed")}
          <button type="button" className="gp-plb-link" onClick={() => void load()}>
            {t("progress.retry")}
          </button>
        </p>
      </section>
    );
  }
  // Nothing to show a member while the owner keeps it off.
  if (board.mode === "off" && !board.isOwner) return null;

  return (
    <ProjectLeaderboardCard
      className={className}
      board={board}
      viewerEnabled={enabled}
      busy={busy}
      error={error}
      onModeChange={(mode, goal) => run((token) => api.setProjectLeaderboard(projectId, mode, goal, token))}
      onChoice={(joined) => run((token) => api.setProjectLeaderboardChoice(projectId, joined, token))}
    />
  );
}
