import { useEffect, useState } from "react";
import { Icon } from "../Icon";
import { useI18n } from "../../lib/i18n";
import { deckPoints } from "../../lib/poker";
import type { PokerSession } from "../../lib/api";
import { PokerPointsStepper } from "./PokerPointsStepper";
import { pointsLabel } from "./pointsLabel";

/**
 * What the person running the session does: reveal, then accept (with the
 * suggested estimate prefilled and adjustable) or re-vote; skip or end at any
 * time. Everyone else just sees who the table is waiting for.
 */
export function PokerControls({ session, points, voted, busy, disabled, hostName, onPoints, onReveal, onRevote, onAccept, onSkip, onClose }: {
  readonly session: PokerSession;
  /** The estimate that "Accept" will record (starts at the suggestion). */
  readonly points: number | null;
  readonly onPoints: (points: number) => void;
  readonly voted: number;
  readonly busy: boolean;
  /** Offline: the table is frozen. */
  readonly disabled: boolean;
  readonly hostName: string | null;
  readonly onReveal: () => void;
  readonly onRevote: () => void;
  readonly onAccept: (points: number) => void;
  readonly onSkip: () => void;
  readonly onClose: () => void;
}) {
  const { t, tp } = useI18n();
  const [confirmEnd, setConfirmEnd] = useState(false);
  useEffect(() => { setConfirmEnd(false); }, [session.id, session.currentIndex]);

  if (!session.canControl) {
    return (
      <div className="poker-controls is-waiting" role="status">
        <p>{session.revealed ? t("poker.controls.waitingAccept", { name: hostName ?? t("poker.controls.theHost") }) : t("poker.controls.waitingReveal", { name: hostName ?? t("poker.controls.theHost") })}</p>
      </div>
    );
  }
  const frozen = disabled || busy;
  const options = deckPoints(session.deck);
  return (
    <div className="poker-controls">
      <div className="poker-controls-main">
        {session.revealed ? (
          <>
            <PokerPointsStepper value={points} options={options} onChange={onPoints} disabled={frozen} />
            <button type="button" className="primary-button poker-accept" disabled={frozen || points === null} onClick={() => points !== null && onAccept(points)}>
              <Icon name="check" aria-hidden="true" />
              <span>{points === null ? t("poker.controls.acceptNone") : t("poker.controls.accept", { points: pointsLabel(t, tp, points) })}</span>
              <kbd aria-hidden="true">↵</kbd>
            </button>
            <button type="button" className="secondary-button" disabled={frozen} onClick={onRevote}>
              <Icon name="refresh" aria-hidden="true" />
              <span>{t("poker.controls.revote")}</span>
            </button>
          </>
        ) : (
          <button type="button" className="primary-button poker-reveal" disabled={frozen || voted === 0} onClick={onReveal} title={voted === 0 ? t("poker.controls.revealNeedsVote") : undefined}>
            <Icon name="eye" aria-hidden="true" />
            <span>{t("poker.controls.reveal")}</span>
            <kbd aria-hidden="true">↵</kbd>
          </button>
        )}
      </div>
      <div className="poker-controls-side">
        <button type="button" className="poker-ghost" disabled={frozen} onClick={onSkip}>{t("poker.controls.skip")}</button>
        {confirmEnd ? (
          <span className="poker-end-confirm" role="group" aria-label={t("poker.controls.endAsk")}>
            <button type="button" className="danger-button" disabled={frozen} onClick={onClose}>{t("poker.controls.endYes")}</button>
            <button type="button" className="poker-ghost" onClick={() => setConfirmEnd(false)}>{t("poker.controls.endNo")}</button>
          </span>
        ) : (
          <button type="button" className="poker-ghost" disabled={frozen} onClick={() => setConfirmEnd(true)}>{t("poker.controls.end")}</button>
        )}
      </div>
    </div>
  );
}
