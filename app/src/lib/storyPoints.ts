// Story points (specs/SCRUM.md): the size of a task for agile projects.
// A value is a multiple of 0.5 from 0 to 999, or null when not estimated.
// The Go server validates the same range (server/internal/tasks/story_points.go).
import type { Translator } from "./i18n/translate";

export const MAX_STORY_POINTS = 999;
/** Smallest step between two valid values. */
export const STORY_POINTS_STEP = 0.5;

/**
 * Coerces anything (a number, a numeric string from SQLite/CSV, null) into a
 * valid story-points value. Out-of-range, non-finite or unparsable input gives
 * null (not estimated); other values are rounded to the nearest 0.5.
 */
export function normalizeStoryPoints(value: unknown): number | null {
  if (value === null || value === undefined || typeof value === "boolean") return null;
  if (typeof value === "string" && !value.trim()) return null;
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value.trim().replace(",", ".")) : Number.NaN;
  if (!Number.isFinite(parsed)) return null;
  const rounded = Math.round(parsed * 2) / 2;
  if (rounded < 0 || rounded > MAX_STORY_POINTS) return null;
  // Avoid -0 leaking into JSON / SQLite.
  return rounded === 0 ? 0 : rounded;
}

/** Number without a unit: "5", "2.5", and "½" for one half (the planning-poker card face). */
export function formatStoryPointsValue(points: number): string {
  return points === 0.5 ? "½" : String(points);
}

function translated(t: Translator | undefined, key: string, count: number | null, fallback: string): string {
  if (!t) return fallback;
  const text = count === null ? t.t(key) : t.tp(key, count);
  // A missing key makes the translator return the key itself.
  return text === key || text === `${key}_plural` ? fallback : text;
}

/**
 * Human label of a task size: "5 pts", "1 pt", "½ pt", "0 pts"; null/undefined
 * (not estimated) gives "–". Keys, all in the `scrum` namespace: `scrum.points`
 * ("{count} pt") + `scrum.points_plural` ("{count} pts"), `scrum.halfPoint`
 * ("½ pt"). Without a translator (or while a key is missing) English is used.
 */
export function formatStoryPoints(points: number | null | undefined, t?: Translator): string {
  const value = normalizeStoryPoints(points);
  if (value === null) return "–";
  if (value === 0.5) return translated(t, "scrum.halfPoint", null, "½ pt");
  const label = formatStoryPointsValue(value);
  const fallback = value === 1 ? `${label} pt` : `${label} pts`;
  if (!t) return fallback;
  const text = t.tp("scrum.points", value, { count: label });
  return text === "scrum.points" || text === "scrum.points_plural" ? fallback : text;
}

/** Sum of the estimated tasks, ignoring null/undefined. */
export function totalStoryPoints(items: ReadonlyArray<{ storyPoints?: number | null }>): number {
  return items.reduce((sum, item) => sum + (normalizeStoryPoints(item.storyPoints) ?? 0), 0);
}
