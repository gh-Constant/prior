// Pure planning for XP bar animations: how the fill travels between two states.

export type XpBarState = { readonly level: number; readonly xpInLevel: number; readonly xpForLevel: number };

export type XpBarSegment = {
  readonly level: number;
  readonly xpForLevel: number;
  readonly fromXp: number;
  readonly toXp: number;
  /** The segment ends with the bar filling up: flash and reset before the next segment. */
  readonly levelUp: boolean;
  /** Jump without tweening (for example after XP was removed across a level boundary). */
  readonly instant: boolean;
};

export function xpRatio(xp: number, xpForLevel: number): number {
  if (!(xpForLevel > 0) || !Number.isFinite(xp)) return 0;
  return Math.min(1, Math.max(0, xp / xpForLevel));
}

/**
 * Segments that take the bar from `prev` to `next`.
 * - Same level: one tween.
 * - Level gained: fill to the top (level-up flash), then fill the new level from zero.
 *   Several levels at once still play a single flash; the badge jumps to the final level.
 * - Level lost (un-completing a task): jump straight to the new state.
 */
export function planXpSegments(prev: XpBarState, next: XpBarState): XpBarSegment[] {
  const clampXp = (state: XpBarState, xp: number) => Math.min(Math.max(0, xp), Math.max(0, state.xpForLevel));
  if (next.level === prev.level) {
    const fromXp = clampXp(prev, prev.xpInLevel);
    const toXp = clampXp(next, next.xpInLevel);
    if (fromXp === toXp && prev.xpForLevel === next.xpForLevel) return [];
    return [{ level: next.level, xpForLevel: next.xpForLevel, fromXp, toXp, levelUp: false, instant: false }];
  }
  if (next.level < prev.level) {
    const toXp = clampXp(next, next.xpInLevel);
    return [{ level: next.level, xpForLevel: next.xpForLevel, fromXp: toXp, toXp, levelUp: false, instant: true }];
  }
  return [
    { level: prev.level, xpForLevel: prev.xpForLevel, fromXp: clampXp(prev, prev.xpInLevel), toXp: Math.max(0, prev.xpForLevel), levelUp: true, instant: false },
    { level: next.level, xpForLevel: next.xpForLevel, fromXp: 0, toXp: clampXp(next, next.xpInLevel), levelUp: false, instant: false },
  ];
}

/** Tween length for a segment: proportional to the distance travelled, within bounds. */
export function segmentDuration(segment: XpBarSegment, baseMs = 900): number {
  if (segment.instant) return 0;
  const distance = Math.abs(xpRatio(segment.toXp, segment.xpForLevel) - xpRatio(segment.fromXp, segment.xpForLevel));
  return Math.round(Math.min(baseMs, Math.max(baseMs * 0.4, baseMs * (0.35 + distance))));
}
