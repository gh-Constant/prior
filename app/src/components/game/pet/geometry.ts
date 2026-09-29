// Pure rig geometry for the pet. Every species shares one rig in a 120×120
// viewBox (ground at y=108); stages change proportions, species nudge them.
import { PET_STAGE_LEVELS, type PetAccessorySlot, type PetSpecies, type PetStage } from "../../../lib/gamification/types";

export type HatchedPetStage = Exclude<PetStage, "egg">;

export const HATCHED_STAGES: readonly HatchedPetStage[] = ["baby", "young", "adult", "radiant"];

export const PET_VIEWBOX = 120;
export const PET_GROUND_Y = 108;
export const PET_CENTER_X = 60;

export type Ellipse = { readonly cx: number; readonly cy: number; readonly rx: number; readonly ry: number };
export type PairedEllipse = { readonly dx: number; readonly y: number; readonly rx: number; readonly ry: number };

export type PetGeometry = {
  readonly species: PetSpecies;
  readonly stage: HatchedPetStage;
  readonly head: Ellipse;
  readonly body: Ellipse;
  /** Eyes are mirrored around the head centre. */
  readonly eye: PairedEllipse;
  readonly cheek: PairedEllipse;
  readonly paw: PairedEllipse;
  readonly foot: PairedEllipse;
  readonly mouthY: number;
  /** Mouth scale (babies have tiny mouths). */
  readonly mouthScale: number;
  /** Growth of ears, leaves, tails, wings and horns: 0.6 (baby) → 1 (adult). */
  readonly feature: number;
  /** Adult markings (stripes, star, belly scales, moss spots). */
  readonly markings: boolean;
  readonly radiant: boolean;
  /** How far the eyes may travel when following the pointer, in viewBox units. */
  readonly lookRadius: number;
};

type StageShape = {
  readonly headCy: number; readonly headRx: number; readonly headRy: number;
  readonly bodyCy: number; readonly bodyRx: number; readonly bodyRy: number;
  readonly eyeDx: number; readonly eyeDy: number; readonly eyeRx: number; readonly eyeRy: number;
  readonly feature: number; readonly mouthScale: number;
};

// Baby: big head, big eyes, tiny body. Young: taller, features growing. Adult: defined.
const STAGE_SHAPES: Readonly<Record<HatchedPetStage, StageShape>> = {
  baby: { headCy: 69, headRx: 29, headRy: 25, bodyCy: 95, bodyRx: 19, bodyRy: 13, eyeDx: 11.5, eyeDy: 3, eyeRx: 4.9, eyeRy: 6.1, feature: 0.6, mouthScale: 0.85 },
  young: { headCy: 60, headRx: 27.5, headRy: 24, bodyCy: 91, bodyRx: 21, bodyRy: 17, eyeDx: 11.2, eyeDy: 3, eyeRx: 4.5, eyeRy: 5.6, feature: 0.82, mouthScale: 0.95 },
  adult: { headCy: 53, headRx: 27, headRy: 23.5, bodyCy: 87.5, bodyRx: 23, bodyRy: 20.5, eyeDx: 11, eyeDy: 3, eyeRx: 4.2, eyeRy: 5.2, feature: 1, mouthScale: 1 },
  radiant: { headCy: 53, headRx: 27, headRy: 23.5, bodyCy: 87.5, bodyRx: 23, bodyRy: 20.5, eyeDx: 11, eyeDy: 3, eyeRx: 4.2, eyeRy: 5.2, feature: 1, mouthScale: 1 },
};

// Small per-species nudges so silhouettes differ while sharing the rig.
const SPECIES_TWEAKS: Readonly<Record<PetSpecies, { readonly headRx: number; readonly headRy: number; readonly bodyRx: number }>> = {
  mochi: { headRx: 1.5, headRy: -0.5, bodyRx: 1.5 },
  fern: { headRx: -0.5, headRy: 1, bodyRx: -0.5 },
  nova: { headRx: 0, headRy: 0, bodyRx: -1 },
  ember: { headRx: 0.5, headRy: 0, bodyRx: 0.5 },
};

export function getPetGeometry(species: PetSpecies, stage: HatchedPetStage): PetGeometry {
  const shape = STAGE_SHAPES[stage];
  const tweak = SPECIES_TWEAKS[species];
  const head = { cx: PET_CENTER_X, cy: shape.headCy, rx: shape.headRx + tweak.headRx, ry: shape.headRy + tweak.headRy };
  const body = { cx: PET_CENTER_X, cy: shape.bodyCy, rx: shape.bodyRx + tweak.bodyRx, ry: shape.bodyRy };
  const eyeY = head.cy + shape.eyeDy;
  const chin = head.cy + head.ry;
  const bodyBottom = body.cy + body.ry;
  return {
    species,
    stage,
    head,
    body,
    eye: { dx: shape.eyeDx, y: eyeY, rx: shape.eyeRx, ry: shape.eyeRy },
    cheek: { dx: shape.eyeDx + shape.eyeRx * 1.05, y: eyeY + shape.eyeRy + 1.6, rx: 4.2, ry: 2.6 },
    paw: { dx: body.rx - 3.2 - shape.feature * 0.8, y: chin + (bodyBottom - chin) * 0.3, rx: 3.3 + shape.feature * 0.7, ry: 4.4 + shape.feature * 1.4 },
    foot: { dx: body.rx * 0.5, y: PET_GROUND_Y - 2.6, rx: 6 + shape.feature * 0.8, ry: 3.8 },
    mouthY: eyeY + shape.eyeRy + 3.2,
    mouthScale: shape.mouthScale,
    feature: shape.feature,
    markings: stage === "adult" || stage === "radiant",
    radiant: stage === "radiant",
    lookRadius: Math.min(2.6, shape.eyeRx * 0.55),
  };
}

/** Hatched stage reached at a given level (level 1 is always at least a baby). */
export function stageForLevel(level: number): HatchedPetStage {
  const safe = Number.isFinite(level) ? level : 1;
  if (safe >= PET_STAGE_LEVELS.radiant) return "radiant";
  if (safe >= PET_STAGE_LEVELS.adult) return "adult";
  if (safe >= PET_STAGE_LEVELS.young) return "young";
  return "baby";
}

/** The next evolution after `stage` and the level that unlocks it, or null at the top. */
export function nextStage(stage: PetStage): { readonly stage: HatchedPetStage; readonly level: number } | null {
  if (stage === "egg") return { stage: "baby", level: PET_STAGE_LEVELS.baby };
  const index = HATCHED_STAGES.indexOf(stage);
  const next = HATCHED_STAGES[index + 1];
  return next ? { stage: next, level: PET_STAGE_LEVELS[next] } : null;
}

/** Where an accessory is drawn. Accessory art is authored around (0,0) at scale 1. */
export type AccessoryAnchor = { readonly x: number; readonly y: number; readonly scale: number; readonly rotate: number };

// How deep a hat sinks into the head, and how wide it may be between ears/horns.
const HAT_FIT: Readonly<Record<PetSpecies, { readonly sink: number; readonly width: number }>> = {
  mochi: { sink: 2.2, width: 1 },
  fern: { sink: 2, width: 0.96 },
  nova: { sink: 2.4, width: 0.9 },
  ember: { sink: 2.4, width: 0.94 },
};

/** Anchor for an accessory slot on a species at a stage. Hat art sits on its bottom centre, face art on the eye line, neck art under the chin. */
export function getAccessoryAnchor(species: PetSpecies, stage: HatchedPetStage, slot: PetAccessorySlot): AccessoryAnchor {
  const geometry = getPetGeometry(species, stage);
  const { head } = geometry;
  if (slot === "hat") {
    const fit = HAT_FIT[species];
    return { x: head.cx, y: head.cy - head.ry + fit.sink, scale: round((head.rx / 27) * fit.width), rotate: 0 };
  }
  if (slot === "face") {
    return { x: head.cx, y: geometry.eye.y, scale: round(geometry.eye.dx / 10), rotate: 0 };
  }
  return { x: head.cx, y: head.cy + head.ry - 1.2, scale: round(head.rx / 27), rotate: 0 };
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/** Approximate top of the head including ears, horns or sprout (for framing). */
export function headFeaturesTop(geometry: PetGeometry): number {
  const { head: h, feature: f, species } = geometry;
  switch (species) {
    case "mochi":
      return h.cy - h.ry * 0.74 - 14.8 * (0.72 + 0.28 * f);
    case "nova":
      return h.cy - h.ry * 0.68 - 22.4 * (0.8 + 0.2 * f);
    case "fern":
      return h.cy - h.ry + 3 - (geometry.radiant ? 20 : geometry.markings ? 16 : 14) * (0.72 + 0.28 * f);
    case "ember":
      return h.cy - h.ry * 0.8 - 13 * (0.62 + 0.5 * f);
  }
}
