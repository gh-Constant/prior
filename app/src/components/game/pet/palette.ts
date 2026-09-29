// Species palettes. One art direction: soft same-hue outlines (never black),
// a lit top-left, warm shade bottom-right, glossy dark eyes tinted by the species.
import type { PetSpecies } from "../../../lib/gamification/types";

export type PetPalette = {
  /** Fur/skin: highlight, base, shade and the soft same-hue outline. */
  readonly light: string;
  readonly base: string;
  readonly shade: string;
  readonly outline: string;
  /** Belly, chest or muzzle. */
  readonly belly: string;
  readonly bellyShade: string;
  /** Ears inside, leaves, wing membrane. */
  readonly accent: string;
  readonly accentShade: string;
  /** Horns, sprout, tail tip, star specks. */
  readonly feature: string;
  readonly featureShade: string;
  readonly cheek: string;
  readonly eye: string;
  readonly eyeTint: string;
  readonly mouth: string;
  readonly tongue: string;
  readonly nose: string;
  /** Adult markings and their radiant glow. */
  readonly marking: string;
  readonly glow: string;
  /** Egg speckles hinting at the species. */
  readonly eggSpots: readonly [string, string];
};

export const PET_PALETTES: Readonly<Record<PetSpecies, PetPalette>> = {
  mochi: {
    light: "#fffefb",
    base: "#fbf0e1",
    shade: "#ecd5bb",
    outline: "#b48a70",
    belly: "#fffaf2",
    bellyShade: "#f6e7d4",
    accent: "#f9b3a8",
    accentShade: "#ee968a",
    feature: "#fffaf2",
    featureShade: "#efdcc6",
    cheek: "#ff9c90",
    eye: "#3b2824",
    eyeTint: "#8b5b4c",
    mouth: "#7a4a3f",
    tongue: "#ff8e8a",
    nose: "#f08a7f",
    marking: "#e6c6a4",
    glow: "#ffd98f",
    eggSpots: ["#f9b3a8", "#eccfb2"],
  },
  fern: {
    light: "#d2f0a8",
    base: "#9bd576",
    shade: "#62a654",
    outline: "#3c7a3c",
    belly: "#f1f9d9",
    bellyShade: "#d8edb2",
    accent: "#62b955",
    accentShade: "#3a8a40",
    feature: "#7ccb62",
    featureShade: "#4f9e4c",
    cheek: "#ffa590",
    eye: "#20301d",
    eyeTint: "#4f7a3c",
    mouth: "#2f5a2c",
    tongue: "#ff9a8f",
    nose: "#2f5a2c",
    marking: "#c9ec9e",
    glow: "#e3ff9e",
    eggSpots: ["#8fcf6e", "#c8e8a2"],
  },
  nova: {
    light: "#8990ea",
    base: "#5e63cf",
    shade: "#3d3f9e",
    outline: "#28296e",
    belly: "#fff4e2",
    bellyShade: "#f1dfc6",
    accent: "#ffd6d0",
    accentShade: "#f3b3ad",
    feature: "#ffe38d",
    featureShade: "#f4c25a",
    cheek: "#ff9ec4",
    eye: "#1c1a3f",
    eyeTint: "#5e5bc0",
    mouth: "#2d2e78",
    tongue: "#ff94a8",
    nose: "#2d2e78",
    marking: "#ffe9a8",
    glow: "#c3c6ff",
    eggSpots: ["#6a70d8", "#ffd978"],
  },
  ember: {
    light: "#ffc592",
    base: "#ff9a62",
    shade: "#ec6b43",
    outline: "#b4452b",
    belly: "#ffe9bd",
    bellyShade: "#ffd18c",
    accent: "#ffd08e",
    accentShade: "#f8a75d",
    feature: "#fff0cc",
    featureShade: "#ecc98f",
    cheek: "#ff7c80",
    eye: "#3a1c15",
    eyeTint: "#a24b2e",
    mouth: "#7a2d1c",
    tongue: "#ff8a8a",
    nose: "#b4452b",
    marking: "#ffc46a",
    glow: "#ffc76e",
    eggSpots: ["#ff9a62", "#ffd166"],
  },
};

/** Flame colours for Ember's tail (outer → core). */
export const FLAME = { outer: "#ff7a3d", mid: "#ffb23f", core: "#fff2ae" } as const;

/** Eggs share one shell; speckles hint at the species inside. */
export const EGG_SHELL = { light: "#fffcf5", base: "#fbf0dd", shade: "#ead3b3", outline: "#c29d78", crack: "#8a6647" } as const;

/** Speckles for an egg whose species is not known yet. */
export const MYSTERY_EGG_SPOTS: readonly string[] = ["#f7876c", "#9bd576", "#7d83e0", "#ffd166"];

/** Silhouette fill for locked evolutions. */
export const PET_SILHOUETTE = { light: "#dcd7cf", dark: "#34332f" } as const;
