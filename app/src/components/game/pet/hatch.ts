import type { PetSpecies } from "../../../lib/gamification/types";

/** Hatch odds in percent (integers keep band edges exact). Ember is the rare one. */
export const PET_SPECIES_WEIGHTS: Readonly<Record<PetSpecies, number>> = {
  mochi: 35,
  fern: 30,
  nova: 25,
  ember: 10,
};

/** Species considered rare enough to celebrate with a callout. */
export const RARE_PET_SPECIES: readonly PetSpecies[] = ["ember"];

export function isRareSpecies(species: PetSpecies): boolean {
  return RARE_PET_SPECIES.includes(species);
}

/**
 * Picks a species with the given weights. `random` must return a number in [0, 1)
 * like Math.random; it is injectable so the pick is deterministic in tests.
 * Weights do not need to sum to 1; non-positive weights never win.
 */
export function pickWeightedSpecies(
  random: () => number = Math.random,
  weights: Readonly<Record<PetSpecies, number>> = PET_SPECIES_WEIGHTS,
): PetSpecies {
  const entries = (Object.keys(weights) as PetSpecies[])
    .map((species) => [species, Math.max(0, weights[species])] as const)
    .filter(([, weight]) => weight > 0);
  if (entries.length === 0) throw new Error("pickWeightedSpecies needs at least one positive weight");
  const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
  const roll = Math.min(Math.max(random(), 0), 1) * total;
  let cumulative = 0;
  for (const [species, weight] of entries) {
    cumulative += weight;
    if (roll < cumulative) return species;
  }
  return entries[entries.length - 1][0];
}
