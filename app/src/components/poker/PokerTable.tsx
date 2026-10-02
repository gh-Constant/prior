import { useI18n } from "../../lib/i18n";
import { cardPoints, type PokerSummary } from "../../lib/poker";
import type { PokerDeckId, PokerParticipant, PokerSession } from "../../lib/api";
import { presenceFromApi } from "../../lib/presence";
import { PersonAvatar } from "../collaboration/PersonAvatar";
import { PokerCard, cardName, type CardState } from "./PokerCard";

function seatState(participant: PokerParticipant, revealed: boolean, mine: boolean, myVote: string | null): { state: CardState; value: string | null } {
  const value = mine ? myVote : participant.vote;
  if (revealed) return value ? { state: "up", value } : { state: "empty", value: null };
  return participant.voted || (mine && myVote !== null) ? { state: "down", value: null } : { state: "empty", value: null };
}

/**
 * The felt: every voter sits with a card in front of them. Cards are face
 * down until the controller reveals them; after that the lowest and highest
 * estimates are tagged so the team knows who to ask.
 */
export function PokerTable({ session, meId, summary }: {
  readonly session: PokerSession;
  readonly meId: string | null;
  readonly summary: PokerSummary | null;
}) {
  const { t } = useI18n();
  const voters = session.participants.filter((participant) => participant.role !== "viewer");
  const watchers = session.participants.filter((participant) => participant.role === "viewer");
  const voted = voters.filter((participant) => participant.userId === meId ? session.myVote !== null || participant.voted : participant.voted).length;
  const deck: PokerDeckId = session.deck;
  const facilitator = session.facilitatorId;

  return (
    <div className="poker-table" data-revealed={session.revealed ? "true" : "false"} data-agreed={summary?.consensus ? "true" : undefined}>
      <div className="poker-felt">
        <ul className="poker-seats" aria-label={t("poker.table.seats")}>
          {voters.map((participant, index) => {
            const mine = participant.userId === meId;
            const presence = mine ? "online" as const : presenceFromApi(participant);
            const { state, value } = seatState(participant, session.revealed, mine, session.myVote);
            const points = value ? cardPoints(value, deck) : null;
            const tone = state !== "up" || !summary ? undefined
              : summary.consensus ? "agreed" as const
              : summary.divided && points !== null && points === summary.max ? "high" as const
              : summary.divided && points !== null && points === summary.min ? "low" as const
              : undefined;
            const name = mine ? t("poker.table.you", { name: participant.displayName }) : participant.displayName;
            const tag = tone === "low" ? t("poker.table.lowest") : tone === "high" ? t("poker.table.highest") : participant.userId === facilitator ? t("poker.table.host") : "";
            const status = state === "up" ? cardName(value ?? "", t) : state === "down" ? t("poker.table.voted") : t("poker.table.thinking");
            return (
              <li key={participant.userId} className="poker-seat" data-mine={mine ? "true" : undefined} data-away={presence === "offline" ? "true" : undefined}>
                <span className="poker-seat-avatar">
                  <PersonAvatar person={{ id: participant.userId, name: participant.displayName, avatarUrl: participant.avatarUrl ?? undefined, presence, lastSeenAt: mine ? undefined : participant.lastSeenAt }} className="collab-avatar poker-avatar" />
                </span>
                <PokerCard state={state} value={value} tone={tone} delay={Math.min(index, 6) * 80} label={`${name}: ${status}`} />
                <span className="poker-seat-name" title={participant.displayName}>{name}</span>
                {tag && <span className="poker-seat-tag" data-tone={tone}>{tag}</span>}
              </li>
            );
          })}
        </ul>
        {!session.revealed && (
          <p className="poker-felt-status" role="status" aria-live="polite">
            <strong>{t("poker.table.progress", { voted, total: voters.length })}</strong>
            <span className="poker-progress" aria-hidden="true">{voters.map((participant) => <i key={participant.userId} className={(participant.userId === meId ? session.myVote !== null || participant.voted : participant.voted) ? "is-on" : ""} />)}</span>
          </p>
        )}
      </div>
      {watchers.length > 0 && (
        <p className="poker-watchers">
          <span>{t("poker.table.watching")}</span>
          {watchers.map((participant) => <PersonAvatar key={participant.userId} person={{ id: participant.userId, name: participant.displayName, avatarUrl: participant.avatarUrl ?? undefined, presence: participant.userId === meId ? "online" : presenceFromApi(participant), lastSeenAt: participant.userId === meId ? undefined : participant.lastSeenAt }} className="collab-avatar collab-avatar-xs" />)}
        </p>
      )}
    </div>
  );
}
