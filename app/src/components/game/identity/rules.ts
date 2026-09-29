// Pure display rules for identity cosmetics: which name effects a level unlocks,
// rank names, league zones, medals, countdowns and deterministic decoration
// layouts. No React here so everything is unit-testable.
import {
  LEAGUE_TIERS,
  NAME_EFFECT_LEVELS,
  NAME_EFFECTS,
  RANKS,
  type LeagueTier,
  type NameEffectId,
  type RankName,
  type Rarity,
} from "../../../lib/gamification/types";

export function isNameEffectUnlocked(effect: NameEffectId, level: number): boolean {
  return level >= NAME_EFFECT_LEVELS[effect];
}

/** Effects unlocked at `level`, weakest first. "plain" is always included. */
export function unlockedNameEffects(level: number): NameEffectId[] {
  return NAME_EFFECTS.filter((effect) => effect === "plain" || isNameEffectUnlocked(effect, level));
}

/** The most prestigious effect unlocked at `level`. */
export function bestNameEffect(level: number): NameEffectId {
  const unlocked = unlockedNameEffects(level);
  return unlocked[unlocked.length - 1] ?? "plain";
}

/** The next effect to unlock after `level`, or undefined once everything is unlocked. */
export function nextNameEffect(level: number): { readonly effect: NameEffectId; readonly level: number } | undefined {
  const effect = NAME_EFFECTS.find((candidate) => !isNameEffectUnlocked(candidate, level));
  return effect ? { effect, level: NAME_EFFECT_LEVELS[effect] } : undefined;
}

const NAME_EFFECT_RARITY: Readonly<Record<NameEffectId, Rarity>> = {
  plain: "common",
  copper: "common",
  silver: "rare",
  gold: "rare",
  emerald: "epic",
  sapphire: "epic",
  diamond: "legendary",
  aurora: "legendary",
  mythic: "legendary",
};

/** Rarity used to frame a name effect in the inventory. */
export function nameEffectRarity(effect: NameEffectId): Rarity {
  return NAME_EFFECT_RARITY[effect];
}

/** Rank index, one per block of ten levels: 1–9 → 0 (Spark), 10–19 → 1 (Ember), … 90+ → 9 (Infinity). */
export function rankIndexForLevel(level: number): number {
  if (!Number.isFinite(level) || level < 10) return 0;
  return Math.min(RANKS.length - 1, Math.floor(level / 10));
}

export function rankForLevel(level: number): RankName {
  return RANKS[rankIndexForLevel(level)];
}

export function leagueTierIndex(tier: LeagueTier): number {
  return LEAGUE_TIERS.indexOf(tier);
}

export type LeagueZone = "promotion" | "safe" | "demotion";

export type LeagueZoneRules = { readonly promote: number; readonly demote: number };

/** Spec: the top 7 move up and the bottom 5 move down (never from the lowest tier, never up from the highest). */
export const DEFAULT_LEAGUE_RULES: LeagueZoneRules = { promote: 7, demote: 5 };

/**
 * Zone of a 1-based `position` in a cohort of `total` players. Promotion wins
 * when the cohort is too small for both zones to fit.
 */
export function leagueZone(position: number, total: number, tier: LeagueTier, rules: LeagueZoneRules = DEFAULT_LEAGUE_RULES): LeagueZone {
  const index = leagueTierIndex(tier);
  const canPromote = index < LEAGUE_TIERS.length - 1;
  const canDemote = index > 0;
  if (canPromote && position <= rules.promote) return "promotion";
  const firstDemoted = Math.max(total - rules.demote + 1, (canPromote ? rules.promote : 0) + 1);
  if (canDemote && position >= firstDemoted) return "demotion";
  return "safe";
}

export type RankedEntry<T> = T & { readonly position: number };

/** Orders players by XP, highest first. Ties keep the server's order (stable sort). */
export function rankByXp<T extends { readonly xp: number }>(players: readonly T[]): RankedEntry<T>[] {
  return [...players]
    .sort((a, b) => b.xp - a.xp)
    .map((player, index) => ({ ...player, position: index + 1 }));
}

export type Medal = "gold" | "silver" | "bronze";

export function medalForPosition(position: number): Medal | undefined {
  return position === 1 ? "gold" : position === 2 ? "silver" : position === 3 ? "bronze" : undefined;
}

export type CountdownUnits = { readonly d: string; readonly h: string; readonly m: string };

const DEFAULT_UNITS: CountdownUnits = { d: "d", h: "h", m: "m" };

/** "2d 14h", "5h 3m", "12m". Never negative; under a minute reads as "1m" so the week never looks over early. */
export function formatCountdown(ms: number, units: CountdownUnits = DEFAULT_UNITS): string {
  const totalMinutes = Math.max(0, Math.ceil(ms / 60_000));
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `${days}${units.d} ${hours}${units.h}`;
  if (hours > 0) return `${hours}${units.h} ${minutes}${units.m}`;
  return `${totalMinutes}${units.m}`;
}

/** Share of a goal reached, clamped to 0–1. */
export function goalProgress(current: number, goal: number): number {
  if (!(goal > 0)) return 0;
  return Math.min(1, Math.max(0, current / goal));
}

/**
 * Deterministic pseudo-random generator seeded from a string (FNV-1a + mulberry32),
 * so sparkle layouts are stable across renders, devices and the server.
 */
export function seededRandom(seed: string): () => number {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  let state = hash >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

/** Stable hue (0–359) for placeholders and team colors. */
export function hueForSeed(seed: string): number {
  return Math.floor(seededRandom(seed)() * 360);
}
