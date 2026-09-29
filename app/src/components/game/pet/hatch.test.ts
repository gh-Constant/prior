import { describe, expect, it } from "vitest";
import type { PetSpecies } from "../../../lib/gamification/types";
import { isRareSpecies, PET_SPECIES_WEIGHTS, pickWeightedSpecies } from "./hatch";

/** Small deterministic PRNG (mulberry32) so the distribution test is stable. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("pickWeightedSpecies", () => {
  it("weights sum to 100% and make Ember the rarest", () => {
    const total = Object.values(PET_SPECIES_WEIGHTS).reduce((sum, weight) => sum + weight, 0);
    expect(total).toBe(100);
    expect(PET_SPECIES_WEIGHTS.ember).toBeLessThan(Math.min(PET_SPECIES_WEIGHTS.mochi, PET_SPECIES_WEIGHTS.fern, PET_SPECIES_WEIGHTS.nova));
    expect(isRareSpecies("ember")).toBe(true);
    expect(isRareSpecies("mochi")).toBe(false);
  });

  it("maps rolls onto cumulative bands (35 / 30 / 25 / 10)", () => {
    const pick = (value: number) => pickWeightedSpecies(() => value);
    expect(pick(0)).toBe("mochi");
    expect(pick(0.3499)).toBe("mochi");
    expect(pick(0.35)).toBe("fern");
    expect(pick(0.6499)).toBe("fern");
    expect(pick(0.65)).toBe("nova");
    expect(pick(0.8999)).toBe("nova");
    expect(pick(0.9)).toBe("ember");
    expect(pick(0.999999)).toBe("ember");
  });

  it("clamps out-of-range rolls instead of failing", () => {
    expect(pickWeightedSpecies(() => -1)).toBe("mochi");
    expect(pickWeightedSpecies(() => 1)).toBe("ember");
  });

  it("skips species with no weight", () => {
    const weights = { mochi: 0, fern: 0, nova: 0, ember: 3 };
    expect(pickWeightedSpecies(() => 0, weights)).toBe("ember");
    expect(() => pickWeightedSpecies(() => 0, { mochi: 0, fern: 0, nova: 0, ember: 0 })).toThrow();
  });

  it("follows the weights over many rolls", () => {
    const random = seeded(42);
    const counts: Record<PetSpecies, number> = { mochi: 0, fern: 0, nova: 0, ember: 0 };
    const rolls = 20000;
    for (let index = 0; index < rolls; index += 1) counts[pickWeightedSpecies(random)] += 1;
    for (const species of Object.keys(counts) as PetSpecies[]) {
      expect(counts[species] / rolls).toBeCloseTo(PET_SPECIES_WEIGHTS[species] / 100, 1);
    }
  });
});
