import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../Icon";
import { useI18n } from "../../lib/i18n";
import { nextUndecided, pokerSummary, type PokerController, type PokerCycleLike, type PokerTaskLike } from "../../lib/poker";
import { formatStoryPointsValue } from "../../lib/storyPoints";
import { PokerControls } from "./PokerControls";
import { PokerHand } from "./PokerHand";
import { PokerQueue } from "./PokerQueue";
import { PokerStart } from "./PokerStart";
import { PokerSummary } from "./PokerSummary";
import { PokerTable } from "./PokerTable";
import { pointsLabel } from "./pointsLabel";
import { usePokerKeys } from "./usePokerKeys";

type Props = {
  readonly controller: PokerController;
  readonly meId: string | null;
  readonly solo: boolean;
  /** May start a session and play a card (not a viewer, not read-only). */
  readonly canPlay: boolean;
  /** Shared project without a connection: the table is frozen. */
  readonly offline: boolean;
  readonly tasks: ReadonlyArray<PokerTaskLike & { title: string }>;
  readonly cycles: readonly PokerCycleLike[];
  readonly today: string;
  readonly onShare?: () => void;
  /** A dialog is open on top: the keyboard is not ours. */
  readonly keysEnabled?: boolean;
};

/** The whole table: start screen, then the current task with the cards, the summary and the controls. */
export function PokerRoom({ controller, meId, solo, canPlay, offline, tasks, cycles, today, onShare, keysEnabled = true }: Props) {
  const { t, tp } = useI18n();
  const { session } = controller;
  const [picked, setPicked] = useState<{ key: string; value: number } | null>(null);
  const [reopened, setReopened] = useState(false);

  const voters = session?.participants.filter((participant) => participant.role !== "viewer") ?? [];
  const me = session?.participants.find((participant) => participant.userId === meId);
  const canVote = Boolean(session) && canPlay && me?.role !== "viewer" && !offline;
  const votes = voters.map((participant) => participant.userId === meId ? (participant.vote ?? session?.myVote ?? null) : participant.vote);
  const voted = voters.filter((participant) => participant.userId === meId ? session?.myVote != null || participant.voted : participant.voted).length;
  const summary = useMemo(() => session?.revealed ? pokerSummary(votes, session.deck) : null, [session?.revealed, session?.deck, votes.join("|")]);
  const item = session?.items[session.currentIndex];
  const allDecided = Boolean(session) && session!.items.every((entry) => entry.finalPoints !== null);
  const hostName = session?.participants.find((participant) => participant.userId === session.facilitatorId)?.displayName ?? null;
  const frozen = offline || controller.busy;

  // The accepted estimate starts at the suggestion; a new card, round or task resets it.
  const suggested = summary?.suggested ?? null;
  const pointsKey = `${item?.taskId}:${session?.round}:${session?.revealed}`;
  const points = picked && picked.key === pointsKey ? picked.value : suggested ?? item?.storyPoints ?? null;
  // The "all done" screen comes back each time the last task is accepted.
  const wasDecided = useRef(false);
  useEffect(() => { if (allDecided !== wasDecided.current) { wasDecided.current = allDecided; setReopened(false); } }, [allDecided]);

  function accept(value: number | null) {
    if (!session || value === null) return;
    void controller.estimate(value, true);
  }
  function skip() {
    if (!session) return;
    const next = nextUndecided(session, session.currentIndex);
    void controller.setCurrent(next === null ? (session.currentIndex + 1) % session.items.length : next);
  }

  const pendingKeys = usePokerKeys({
    enabled: Boolean(session) && keysEnabled && !(allDecided && !reopened),
    deck: session?.deck ?? "fibonacci",
    canVote: canVote && !controller.busy,
    canControl: Boolean(session?.canControl) && !frozen,
    revealed: Boolean(session?.revealed),
    onPick: (card) => void controller.vote(card),
    onClear: () => void controller.vote(null),
    onPrimary: () => {
      if (!session) return;
      if (session.revealed) accept(points);
      else if (voted > 0) void controller.reveal();
    },
    onRevote: () => void controller.revote(),
  });

  const banner = (
    <>
      {offline && <p className="poker-banner is-warn" role="status"><Icon name="wifi" aria-hidden="true" />{t("poker.offline")}</p>}
      {controller.error && (
        <p className="poker-banner is-error" role="alert">
          <Icon name="close" aria-hidden="true" />
          <span>{controller.error}</span>
          <button type="button" className="poker-ghost" onClick={() => { controller.dismissError(); controller.refresh(); }}>{t("poker.retry")}</button>
        </p>
      )}
      {solo && (
        <p className="poker-banner is-solo">
          <Icon name="user" aria-hidden="true" />
          <span>{t("poker.solo.note")}</span>
          {onShare && <button type="button" className="secondary-button" onClick={onShare}>{t("poker.solo.share")}</button>}
        </p>
      )}
    </>
  );

  if (!session) {
    if (controller.loading) return <div className="poker-room">{banner}<div className="poker-loading" role="status" aria-busy="true"><span className="poker-spinner" aria-hidden="true" />{t("poker.loading")}</div></div>;
    return (
      <div className="poker-room">
        {banner}
        {canPlay ? (
          <PokerStart tasks={tasks} cycles={cycles} today={today} busy={controller.busy} disabled={offline} solo={solo} onStart={controller.start} />
        ) : (
          <div className="poker-empty" role="status">
            <span className="poker-empty-cards" aria-hidden="true"><i /><i /><i /></span>
            <strong>{t("poker.watch.title")}</strong>
            <p>{t("poker.watch.body")}</p>
          </div>
        )}
      </div>
    );
  }

  const done = allDecided && !reopened;
  const total = session.items.reduce((sum, entry) => sum + (entry.finalPoints ?? 0), 0);

  return (
    <div className="poker-room" data-solo={solo ? "true" : undefined}>
      {banner}
      <div className="poker-layout">
        <div className="poker-main">
          {done ? (
            <section className="poker-done" aria-live="polite">
              <span className="poker-done-icon" aria-hidden="true"><Icon name="award" /></span>
              <h2>{t("poker.done.title")}</h2>
              <p>{tp("poker.done.body", session.items.length, { points: pointsLabel(t, tp, total) })}</p>
              {session.canControl
                ? <button type="button" className="primary-button" disabled={frozen} onClick={() => void controller.close()}><Icon name="check" aria-hidden="true" /><span>{t("poker.done.finish")}</span></button>
                : <p className="poker-muted">{t("poker.done.waiting", { name: hostName ?? t("poker.controls.theHost") })}</p>}
            </section>
          ) : (
            <>
              <header className="poker-head">
                <div>
                  <p className="poker-eyebrow">
                    {t("poker.head.position", { current: session.currentIndex + 1, total: session.items.length })}
                    {session.round > 1 && <span className="poker-round">{t("poker.head.round", { round: session.round })}</span>}
                    {item?.storyPoints != null && <span className="poker-current-points" title={t("poker.head.currentPoints")}>{formatStoryPointsValue(item.storyPoints)}</span>}
                  </p>
                  <h2>{item?.title}</h2>
                </div>
              </header>
              <PokerTable session={session} meId={meId} summary={summary} />
              {summary && <PokerSummary summary={summary} />}
            </>
          )}
          {!done && (
            <div className="poker-dock">
              <PokerControls
                session={session}
                points={points}
                onPoints={(value) => setPicked({ key: pointsKey, value })}
                voted={voted}
                busy={controller.busy}
                disabled={offline}
                hostName={hostName}
                onReveal={() => void controller.reveal()}
                onRevote={() => void controller.revote()}
                onAccept={(value) => accept(value)}
                onSkip={skip}
                onClose={() => void controller.close()}
              />
              {canVote && <PokerHand deck={session.deck} value={session.myVote} locked={session.revealed} pendingKeys={pendingKeys} onPick={(card) => void controller.vote(card)} />}
              {!canVote && !offline && <p className="poker-watching" role="status"><Icon name="eye" aria-hidden="true" />{t("poker.watch.you")}</p>}
            </div>
          )}
        </div>
        <PokerQueue session={session} canJump={session.canControl} disabled={frozen} onJump={(index) => { setReopened(true); void controller.setCurrent(index); }} />
      </div>
      <p className="poker-sr" role="status" aria-live="polite">{session.revealed ? t("poker.summary.announce") : ""}</p>
    </div>
  );
}
