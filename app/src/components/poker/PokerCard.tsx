import type { CSSProperties } from "react";
import { Icon } from "../Icon";
import { cardFace } from "../../lib/poker";

/** The face of a card: a number or size, "?" and a coffee cup for a break. */
export function CardFace({ value }: { readonly value: string }) {
  if (value === "coffee") return <Icon name="coffee" aria-hidden="true" />;
  const face = cardFace(value);
  return <span className="poker-face-text" data-long={face.length > 2 ? "true" : undefined}>{face}</span>;
}

/** Name read aloud for a card ("½", "Not sure", "Coffee break"). */
export function cardName(value: string, t: (key: string) => string): string {
  if (value === "?") return t("poker.card.unsure");
  if (value === "coffee") return t("poker.card.coffee");
  return cardFace(value);
}

export type CardState = "empty" | "down" | "up";

/**
 * A card on the table. It exists in two layers, the back and the face, and
 * turning over is a 3D rotation of the pair (a plain swap under
 * prefers-reduced-motion; see Poker.css).
 */
export function PokerCard({ state, value, label, delay = 0, tone }: {
  readonly state: CardState;
  readonly value?: string | null;
  readonly label: string;
  /** Stagger of the flip, so a reveal ripples across the table. */
  readonly delay?: number;
  readonly tone?: "low" | "high" | "agreed";
}) {
  if (state === "empty") return <div className="poker-card is-empty" role="img" aria-label={label}><span aria-hidden="true">·</span></div>;
  return (
    <div className="poker-card" data-state={state} data-tone={tone} role="img" aria-label={label} style={{ "--flip-delay": `${delay}ms` } as CSSProperties}>
      <div className="poker-card-inner" aria-hidden="true">
        <div className="poker-card-back"><span /></div>
        <div className="poker-card-front">{state === "up" && value ? <CardFace value={value} /> : null}</div>
      </div>
    </div>
  );
}
