// Shared vocabulary for Prior's gamified experience. See specs/GAMIFICATION.md.
import type { QuadrantKey } from "../../types";

export type Rarity = "common" | "rare" | "epic" | "legendary";

export const RARITY_ORDER: readonly Rarity[] = ["common", "rare", "epic", "legendary"];

export type NameEffectId = "plain" | "copper" | "silver" | "gold" | "emerald" | "sapphire" | "diamond" | "aurora" | "mythic";

/** Level at which each name effect unlocks. */
export const NAME_EFFECT_LEVELS: Readonly<Record<NameEffectId, number>> = {
  plain: 1,
  copper: 5,
  silver: 10,
  gold: 20,
  emerald: 30,
  sapphire: 40,
  diamond: 50,
  aurora: 75,
  mythic: 100,
};

export const NAME_EFFECTS: readonly NameEffectId[] = ["plain", "copper", "silver", "gold", "emerald", "sapphire", "diamond", "aurora", "mythic"];

/** Rank names, one per block of ten levels (1–9 Spark, 10–19 Ember, …). */
export const RANKS = ["Spark", "Ember", "Flame", "Blaze", "Nova", "Comet", "Star", "Nebula", "Galaxy", "Infinity"] as const;
export type RankName = (typeof RANKS)[number];

export type LeagueTier = "pebble" | "bronze" | "silver" | "gold" | "sapphire" | "ruby" | "emerald" | "amethyst" | "obsidian" | "diamond";

export const LEAGUE_TIERS: readonly LeagueTier[] = ["pebble", "bronze", "silver", "gold", "sapphire", "ruby", "emerald", "amethyst", "obsidian", "diamond"];

export type PetSpecies = "mochi" | "fern" | "nova" | "ember";

/** Ember is the rare species. */
export const PET_SPECIES: readonly PetSpecies[] = ["mochi", "fern", "nova", "ember"];

export type PetStage = "egg" | "baby" | "young" | "adult" | "radiant";

/** Level at which each hatched stage is reached. */
export const PET_STAGE_LEVELS: Readonly<Record<Exclude<PetStage, "egg">, number>> = { baby: 1, young: 10, adult: 25, radiant: 50 };

export type PetMood = "happy" | "content" | "sleepy" | "asleep" | "excited";

/** One-shot animations played on top of the current mood. */
export type PetReaction = "hop" | "dance" | "purr" | "yawn" | "hatch" | "wiggle";

export type PetAccessorySlot = "hat" | "face" | "neck";

export type CosmeticKind = "name-effect" | "border" | "title" | "pet-hat" | "pet-face" | "pet-neck" | "pet-room" | "confetti";

export type ChestTier = Rarity;

/** Value tier of a completion, which scales its celebration. */
export type CompletionQuadrant = QuadrantKey;

/** How much motion the user asked for. "off" is also forced by prefers-reduced-motion. */
export type EffectsIntensity = "full" | "subtle" | "off";
