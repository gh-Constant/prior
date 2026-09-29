// Color vocabulary for celebrations: confetti themes (awarded by chests), quadrant tones and rarity tones.
import type { Rarity } from "../gamification/types";
import type { QuadrantKey } from "../../types";

export type ConfettiTheme = "classic" | "gold" | "pastel" | "neon" | "sakura" | "ocean";

export const CONFETTI_THEMES: readonly ConfettiTheme[] = ["classic", "gold", "pastel", "neon", "sakura", "ocean"];

export type ConfettiThemeSpec = {
  readonly colors: readonly string[];
  /** Color of the four-point glints mixed into bursts. */
  readonly glint: string;
  /** Sakura swaps most paper rectangles for petals. */
  readonly petals?: boolean;
};

export const CONFETTI_THEME_SPECS: Readonly<Record<ConfettiTheme, ConfettiThemeSpec>> = {
  // Prior coral plus the matrix tones: focus, plan, quick, and a violet/green to keep it festive.
  classic: { colors: ["#f35f43", "#ff8a6b", "#e0a01a", "#f5c542", "#2e67d1", "#6f9cf0", "#5f55c4", "#2f9e6a"], glint: "#ffd66b" },
  gold: { colors: ["#f5c542", "#e0a01a", "#ffd978", "#c98a0c", "#fff0b8", "#eab308"], glint: "#fff3c4" },
  pastel: { colors: ["#ffb3c1", "#ffd6a5", "#f9f3a1", "#b9f2b0", "#9bf6ff", "#a0c4ff", "#c8b6ff"], glint: "#ffe3f1" },
  neon: { colors: ["#ff2bd6", "#00e5ff", "#a3ff12", "#ffe600", "#ff5f1f", "#8a2bff"], glint: "#e8fdff" },
  sakura: { colors: ["#ffc2d4", "#ff8fab", "#fb6f92", "#ffd9e4", "#f7a8c0", "#e05780"], glint: "#fff0f5", petals: true },
  ocean: { colors: ["#0077b6", "#00b4d8", "#48cae4", "#90e0ef", "#2ec4b6", "#1d4ed8"], glint: "#e0fbff" },
};

/** Particle palette per quadrant: its tone first, then accents that keep the burst lively. */
export const QUADRANT_TONES: Readonly<Record<QuadrantKey, readonly string[]>> = {
  focus: ["#f35f43", "#ff8a6b", "#ffb199", "#f5c542", "#e0a01a"],
  plan: ["#e0a01a", "#f5c542", "#ffd978", "#f35f43", "#ff8a6b"],
  quick: ["#2e67d1", "#6f9cf0", "#a9c5ff", "#5f55c4", "#f5c542"],
  later: ["#9d9a93", "#c9c6bf", "#f5c542", "#e0a01a"],
};

/** The CSS color of a quadrant, matching `.quadrant-*` in TaskList.css. */
export const QUADRANT_COLOR: Readonly<Record<QuadrantKey, string>> = {
  focus: "#f35f43",
  plan: "#e0a01a",
  quick: "#2e67d1",
  later: "#9d9a93",
};

export type RarityTone = { readonly base: string; readonly light: string; readonly dark: string };

/** Common grey, Rare blue, Epic purple, Legendary orange-gold (specs/GAMIFICATION.md §5). */
export const RARITY_TONES: Readonly<Record<Rarity, RarityTone>> = {
  common: { base: "#9aa1ab", light: "#dfe3e8", dark: "#5f6670" },
  rare: { base: "#3d7cf0", light: "#a8c6ff", dark: "#1f47a0" },
  epic: { base: "#9b5cf0", light: "#d6bcff", dark: "#5a2bb0" },
  legendary: { base: "#f59e1b", light: "#ffe08a", dark: "#b8600b" },
};

/** Particle palette for a rarity reveal. */
export function rarityPalette(rarity: Rarity): readonly string[] {
  const tone = RARITY_TONES[rarity];
  if (rarity === "legendary") return [tone.base, tone.light, "#fff3c4", "#f35f43", "#ffd66b"];
  if (rarity === "epic") return [tone.base, tone.light, "#f5c542", "#ff8fd1"];
  return [tone.base, tone.light, "#ffffff", tone.dark];
}

export const STARDUST_COLORS: readonly string[] = ["#c8b6ff", "#ffffff", "#ffe08a", "#a8c6ff"];

/** Darken (negative) or lighten (positive) a #rrggbb color by mixing with black or white. */
export function shade(hex: string, amount: number): string {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!match) return hex;
  const value = Number.parseInt(match[1], 16);
  const target = amount < 0 ? 0 : 255;
  const t = Math.min(1, Math.abs(amount));
  const mix = (channel: number) => Math.round(channel + (target - channel) * t);
  const r = mix((value >> 16) & 255);
  const g = mix((value >> 8) & 255);
  const b = mix(value & 255);
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}
