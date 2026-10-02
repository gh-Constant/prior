import { useEffect, useRef } from "react";
import { useI18n } from "../../lib/i18n";
import { POKER_DECKS, cardFace } from "../../lib/poker";
import type { PokerDeckId } from "../../lib/api";
import { CardFace, cardName } from "./PokerCard";

/**
 * Your cards. The picked one rises out of the hand. On phones the hand is a
 * sticky strip above the tab bar that scrolls sideways (see Poker.css).
 */
export function PokerHand({ deck, value, locked, pendingKeys, onPick }: {
  readonly deck: PokerDeckId;
  readonly value: string | null;
  /** The cards are already on the table: the pick is shown but cannot change. */
  readonly locked: boolean;
  /** Keys typed so far while a shortcut is still ambiguous ("1" could become "13"). */
  readonly pendingKeys?: string;
  readonly onPick: (value: string | null) => void;
}) {
  const { t } = useI18n();
  const selected = useRef<HTMLButtonElement>(null);

  // Keep the picked card in view when it was chosen with the keyboard.
  useEffect(() => {
    if (value) selected.current?.scrollIntoView?.({ block: "nearest", inline: "center", behavior: "auto" });
  }, [value]);

  return (
    <section className="poker-hand" data-locked={locked ? "true" : undefined} aria-label={t("poker.hand.label")}>
      <div className="poker-hand-cards" role="group" aria-label={t("poker.hand.cards")}>
        {POKER_DECKS[deck].map((card) => {
          const picked = value === card;
          return (
            <button
              key={card}
              ref={picked ? selected : undefined}
              type="button"
              className="poker-hand-card"
              data-special={card === "?" || card === "coffee" ? "true" : undefined}
              aria-pressed={picked}
              aria-label={cardName(card, t)}
              title={cardName(card, t)}
              disabled={locked && !picked}
              aria-disabled={locked ? true : undefined}
              onClick={() => { if (!locked) onPick(picked ? null : card); }}
            >
              <span className="poker-hand-corner" aria-hidden="true">{card === "coffee" ? "" : cardFace(card)}</span>
              <CardFace value={card} />
            </button>
          );
        })}
      </div>
      <p className="poker-hand-hint" aria-hidden="true">
        {pendingKeys ? <kbd>{pendingKeys}…</kbd> : t("poker.hand.hint")}
      </p>
    </section>
  );
}
