import { Icon } from "../Icon";
import { useI18n } from "../../lib/i18n";
import type { PokerSummary as Summary } from "../../lib/poker";
import { CardFace, cardName } from "./PokerCard";
import { pointsLabel } from "./pointsLabel";

function number(value: number | null): string {
  return value === null ? "–" : value === 0.5 ? "½" : String(Math.round(value * 100) / 100);
}

/** What the revealed cards say: the agreement (or the spread), the maths and a bar per card. */
export function PokerSummary({ summary }: { readonly summary: Summary }) {
  const { t, tp } = useI18n();
  const top = Math.max(1, ...summary.distribution.map((entry) => entry.count));
  const headline = summary.total === 0 ? t("poker.summary.nobody")
    : summary.consensus ? t("poker.summary.agreed", { points: pointsLabel(t, tp, summary.suggested ?? 0) })
    : summary.numeric === 0 ? t("poker.summary.noPoints")
    : summary.total === 1 ? t("poker.summary.single", { points: pointsLabel(t, tp, summary.suggested ?? 0) })
    : summary.divided ? t("poker.summary.split") : t("poker.summary.noPoints");
  return (
    <section className="poker-summary" data-agreed={summary.consensus ? "true" : undefined} aria-label={t("poker.summary.label")}>
      <header>
        <span className="poker-summary-icon" aria-hidden="true"><Icon name={summary.consensus ? "check-circle" : summary.divided ? "activity" : "sparkles"} /></span>
        <strong>{headline}</strong>
      </header>
      {summary.numeric > 0 && (
        <dl className="poker-stats">
          <div><dt>{t("poker.summary.average")}</dt><dd>{number(summary.average)}</dd></div>
          <div><dt>{t("poker.summary.median")}</dt><dd>{number(summary.median)}</dd></div>
          <div><dt>{t("poker.summary.range")}</dt><dd>{summary.min === summary.max ? number(summary.min) : `${number(summary.min)} – ${number(summary.max)}`}</dd></div>
        </dl>
      )}
      <ul className="poker-bars">
        {summary.distribution.map((entry) => (
          <li key={entry.value} aria-label={`${cardName(entry.value, t)}: ${tp("poker.summary.votes", entry.count)}`}>
            <span className="poker-bar-card" aria-hidden="true"><CardFace value={entry.value} /></span>
            <span className="poker-bar-track" aria-hidden="true"><i style={{ width: `${Math.max(8, (entry.count / top) * 100)}%` }} data-top={entry.count === top && summary.distribution.length > 1 ? "true" : undefined} /></span>
            <span className="poker-bar-count" aria-hidden="true">{entry.count}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
