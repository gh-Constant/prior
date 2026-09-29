// Client mirror of server/internal/gamification, used only to show XP and
// progress optimistically. The server stays the authority: every value shown
// here is reconciled with the profile it returns.
import type { QuadrantKey } from "../../types";
import { NAME_EFFECTS, NAME_EFFECT_LEVELS, RANKS, type NameEffectId, type PetStage, type RankName } from "./types";

const CURVE_SCALE = 30;
const CURVE_EXPONENT = 1.9;

export const QUADRANT_XP: Readonly<Record<QuadrantKey, number>> = { focus: 30, plan: 25, quick: 10, later: 5 };
export const MIN_TASK_AGE_MS = 60_000;
export const FARMED_TASK_XP = 1;
export const DAILY_FULL_XP = 300;
export const DAILY_HALF_XP = 600;
export const DAILY_CAP_XP = 800;
export const HABIT_XP = 10;
export const MAX_HABIT_BONUS_XP = 10;

/** Total XP needed to reach a level (level 1 needs none). */
export function xpToReach(level: number): number {
  if (level <= 1) return 0;
  return Math.floor(CURVE_SCALE * Math.pow(level - 1, CURVE_EXPONENT));
}

export type LevelProgress = { readonly level: number; readonly xpInLevel: number; readonly xpForLevel: number };

export function progressFor(totalXp: number): LevelProgress {
  const total = Math.max(0, Math.floor(totalXp));
  let level = 1 + Math.floor(Math.pow(total / CURVE_SCALE, 1 / CURVE_EXPONENT));
  while (level > 1 && xpToReach(level) > total) level--;
  while (xpToReach(level + 1) <= total) level++;
  const floor = xpToReach(level);
  return { level, xpInLevel: total - floor, xpForLevel: xpToReach(level + 1) - floor };
}

export function rankFor(level: number): RankName {
  return RANKS[Math.min(Math.floor(Math.max(level, 1) / 10), RANKS.length - 1)];
}

export function nameEffectsUnlocked(level: number): NameEffectId[] {
  return NAME_EFFECTS.filter((effect) => level >= NAME_EFFECT_LEVELS[effect]);
}

export function petStageFor(level: number, hatched: boolean): PetStage {
  if (!hatched) return "egg";
  if (level >= 50) return "radiant";
  if (level >= 25) return "adult";
  if (level >= 10) return "young";
  return "baby";
}

export type TaskCompletionInput = {
  readonly quadrant: QuadrantKey;
  /** "YYYY-MM-DD" in the user's calendar. */
  readonly dueDate?: string | null;
  readonly createdAt: Date;
  readonly completedAt: Date;
};

function localDay(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/** Raw XP of one completion, before the daily curve. */
export function taskXp({ quadrant, dueDate, createdAt, completedAt }: TaskCompletionInput): number {
  if (completedAt.getTime() - createdAt.getTime() < MIN_TASK_AGE_MS) return FARMED_TASK_XP;
  const base = QUADRANT_XP[quadrant];
  const onTime = Boolean(dueDate && /^\d{4}-\d{2}-\d{2}$/.test(dueDate) && localDay(completedAt) <= dueDate);
  return onTime ? base + Math.round(base * 0.2) : base;
}

/** What raw task XP is worth once earnedToday task XP was already awarded today; nothing past the daily cap. */
export function applyDailyCurve(earnedToday: number, raw: number): number {
  if (raw <= 0 || earnedToday >= DAILY_CAP_XP) return 0;
  let awarded = 0;
  let position = earnedToday;
  let remaining = raw;
  while (remaining > 0) {
    let rate = 0.2;
    let room = Number.POSITIVE_INFINITY;
    if (position < DAILY_FULL_XP) { rate = 1; room = DAILY_FULL_XP - position; }
    else if (position < DAILY_HALF_XP) { rate = 0.5; room = (DAILY_HALF_XP - position) / 0.5; }
    const spent = Math.min(remaining, room);
    awarded += spent * rate;
    position += spent * rate;
    remaining -= spent;
  }
  return Math.min(Math.max(1, Math.floor(awarded + 1e-9)), DAILY_CAP_XP - earnedToday);
}
