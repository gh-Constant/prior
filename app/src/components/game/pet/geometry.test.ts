import { describe, expect, it } from "vitest";
import { PET_SPECIES, type PetAccessorySlot } from "../../../lib/gamification/types";
import { accessoriesForSlot, hatCoversCrown, PET_ACCESSORY_IDS, PET_ACCESSORY_SLOT, sanitizeAccessories } from "./accessories";
import { moodExpression, reactionExpression } from "./expressions";
import { getAccessoryAnchor, getPetGeometry, HATCHED_STAGES, nextStage, PET_GROUND_Y, stageForLevel } from "./geometry";

describe("stageForLevel", () => {
  it("evolves at levels 10, 25 and 50", () => {
    expect(stageForLevel(1)).toBe("baby");
    expect(stageForLevel(9)).toBe("baby");
    expect(stageForLevel(10)).toBe("young");
    expect(stageForLevel(24)).toBe("young");
    expect(stageForLevel(25)).toBe("adult");
    expect(stageForLevel(49)).toBe("adult");
    expect(stageForLevel(50)).toBe("radiant");
    expect(stageForLevel(400)).toBe("radiant");
  });

  it("treats missing or odd levels as a baby", () => {
    expect(stageForLevel(0)).toBe("baby");
    expect(stageForLevel(-3)).toBe("baby");
    expect(stageForLevel(Number.NaN)).toBe("baby");
  });

  it("describes the next evolution", () => {
    expect(nextStage("egg")).toEqual({ stage: "baby", level: 1 });
    expect(nextStage("baby")).toEqual({ stage: "young", level: 10 });
    expect(nextStage("young")).toEqual({ stage: "adult", level: 25 });
    expect(nextStage("adult")).toEqual({ stage: "radiant", level: 50 });
    expect(nextStage("radiant")).toBeNull();
  });
});

describe("getPetGeometry", () => {
  it("keeps every species standing on the ground and centred", () => {
    for (const species of PET_SPECIES) {
      for (const stage of HATCHED_STAGES) {
        const geometry = getPetGeometry(species, stage);
        expect(geometry.body.cy + geometry.body.ry).toBeCloseTo(PET_GROUND_Y, 0);
        expect(geometry.head.cx).toBe(60);
        expect(geometry.head.cy).toBeLessThan(geometry.body.cy);
      }
    }
  });

  it("grows the body and shrinks the head-to-body ratio as the pet ages", () => {
    const ratio = (stage: (typeof HATCHED_STAGES)[number]) => {
      const { head, body } = getPetGeometry("mochi", stage);
      return head.rx / body.rx;
    };
    expect(ratio("baby")).toBeGreaterThan(ratio("young"));
    expect(ratio("young")).toBeGreaterThan(ratio("adult"));
    expect(getPetGeometry("fern", "baby").eye.ry).toBeGreaterThan(getPetGeometry("fern", "adult").eye.ry);
    expect(getPetGeometry("nova", "baby").feature).toBeLessThan(getPetGeometry("nova", "adult").feature);
    expect(getPetGeometry("ember", "radiant").radiant).toBe(true);
    expect(getPetGeometry("ember", "adult").markings).toBe(true);
    expect(getPetGeometry("ember", "young").markings).toBe(false);
  });
});

describe("getAccessoryAnchor", () => {
  const slots: PetAccessorySlot[] = ["hat", "face", "neck"];

  it("stacks hat above face above neck for every species and stage", () => {
    for (const species of PET_SPECIES) {
      for (const stage of HATCHED_STAGES) {
        const [hat, face, neck] = slots.map((slot) => getAccessoryAnchor(species, stage, slot));
        const { head, eye } = getPetGeometry(species, stage);
        expect(hat.y).toBeLessThan(face.y);
        expect(face.y).toBeLessThan(neck.y);
        expect(hat.y).toBeGreaterThan(head.cy - head.ry);
        expect(face.y).toBe(eye.y);
        expect(neck.y).toBeLessThan(head.cy + head.ry);
        for (const anchor of [hat, face, neck]) {
          expect(anchor.x).toBe(60);
          expect(anchor.scale).toBeGreaterThan(0.7);
          expect(anchor.scale).toBeLessThan(1.3);
        }
      }
    }
  });

  it("follows the head as it rises with age", () => {
    const babyHat = getAccessoryAnchor("mochi", "baby", "hat");
    const adultHat = getAccessoryAnchor("mochi", "adult", "hat");
    expect(adultHat.y).toBeLessThan(babyHat.y);
    expect(getAccessoryAnchor("nova", "adult", "hat").scale).toBeLessThan(getAccessoryAnchor("mochi", "adult", "hat").scale);
  });
});

describe("accessory catalogue", () => {
  it("offers at least one item per slot and drops mismatched slots", () => {
    for (const slot of ["hat", "face", "neck"] as const) expect(accessoriesForSlot(slot).length).toBeGreaterThan(0);
    expect(PET_ACCESSORY_IDS.length).toBeGreaterThanOrEqual(7);
    expect(PET_ACCESSORY_SLOT.scarf).toBe("neck");
    expect(sanitizeAccessories({ hat: "scarf", face: "round-glasses", neck: null })).toEqual({ face: "round-glasses" });
    expect(sanitizeAccessories(undefined)).toEqual({});
    expect(hatCoversCrown("beanie")).toBe(true);
    expect(hatCoversCrown("flower")).toBe(false);
  });
});

describe("expressions", () => {
  it("gives each mood a distinct face and lets reactions override it", () => {
    expect(moodExpression("happy").eyes).toBe("happy");
    expect(moodExpression("excited").eyes).toBe("star");
    expect(moodExpression("asleep").eyes).toBe("closed");
    expect(moodExpression("sleepy").eyes).toBe("half");
    expect(reactionExpression("yawn", "sleepy")?.mouth).toBe("yawn");
    expect(reactionExpression("purr", "content")?.eyes).toBe("happy");
    expect(reactionExpression("hatch", "content")).toBeNull();
  });
});
