import type { Translator } from "../../lib/i18n";

/** "5 points", "1 point", "½ point": the poker namespace carries its own wording. */
export function pointsLabel(t: Translator["t"], tp: Translator["tp"], points: number): string {
  if (points === 0.5) return t("poker.halfPoint");
  return tp("poker.points", points, { count: String(points) });
}
