// Streak flame stages: the flame grows with the streak and its hue climbs orange → hot blue → violet.

export type StreakStage = "cold" | "spark" | "kindled" | "blazing" | "inferno" | "mythic";

export type StreakPalette = {
  /** Outer flame, top then bottom gradient stops. */
  readonly outer: readonly [string, string];
  readonly middle: readonly [string, string];
  readonly core: string;
  readonly glow: string;
  readonly ember: string;
};

export type StreakVisual = {
  readonly stage: StreakStage;
  /** Flame scale inside its box, 0–1.1. */
  readonly scale: number;
  /** Rising ember particles. */
  readonly embers: number;
  /** Extra side tongues. */
  readonly tongues: 0 | 1 | 2;
  /** Seconds per flicker cycle (smaller is livelier). */
  readonly flicker: number;
  readonly palette: StreakPalette;
};

/** First day of each stage. */
export const STREAK_STAGE_THRESHOLDS: ReadonlyArray<readonly [StreakStage, number]> = [
  ["cold", 0],
  ["spark", 1],
  ["kindled", 3],
  ["blazing", 7],
  ["inferno", 30],
  ["mythic", 100],
];

export function streakStage(days: number): StreakStage {
  const safe = Number.isFinite(days) ? Math.max(0, Math.floor(days)) : 0;
  let stage: StreakStage = "cold";
  for (const [name, from] of STREAK_STAGE_THRESHOLDS) if (safe >= from) stage = name;
  return stage;
}

const PALETTES: Readonly<Record<StreakStage | "frozen", StreakPalette>> = {
  cold: { outer: ["#c9c6bf", "#9d9a93"], middle: ["#e4e2dd", "#c9c6bf"], core: "#f3f2ef", glow: "rgba(157,154,147,0.18)", ember: "#c9c6bf" },
  spark: { outer: ["#ffc24a", "#ff8a1a"], middle: ["#ffe08a", "#ffb020"], core: "#fff6d6", glow: "rgba(255,166,43,0.28)", ember: "#ffc24a" },
  kindled: { outer: ["#ffae2b", "#f35f43"], middle: ["#ffd166", "#ff9a1f"], core: "#fff3c4", glow: "rgba(243,95,67,0.3)", ember: "#ffb020" },
  blazing: { outer: ["#ff9a1f", "#e8341c"], middle: ["#ffc93c", "#ff6a1a"], core: "#fff8e1", glow: "rgba(232,52,28,0.34)", ember: "#ffb020" },
  inferno: { outer: ["#7fd6ff", "#2e5bff"], middle: ["#c4f1ff", "#4f9dff"], core: "#ffffff", glow: "rgba(64,140,255,0.38)", ember: "#9fe0ff" },
  mythic: { outer: ["#e39bff", "#6a2de0"], middle: ["#f6d4ff", "#a45cff"], core: "#ffffff", glow: "rgba(150,80,255,0.42)", ember: "#e7b8ff" },
  frozen: { outer: ["#c9ebff", "#4f9fe0"], middle: ["#f1fbff", "#9fd2f5"], core: "#ffffff", glow: "rgba(90,165,230,0.38)", ember: "#d7f1ff" },
};

const STAGE_SHAPE: Readonly<Record<StreakStage, Omit<StreakVisual, "stage" | "palette">>> = {
  cold: { scale: 0.62, embers: 0, tongues: 0, flicker: 2.4 },
  spark: { scale: 0.72, embers: 0, tongues: 0, flicker: 1.5 },
  kindled: { scale: 0.84, embers: 2, tongues: 0, flicker: 1.25 },
  blazing: { scale: 0.94, embers: 4, tongues: 1, flicker: 1.05 },
  inferno: { scale: 1, embers: 6, tongues: 2, flicker: 0.9 },
  mythic: { scale: 1.06, embers: 8, tongues: 2, flicker: 0.8 },
};

export function streakVisual(days: number, frozen = false): StreakVisual {
  const stage = streakStage(days);
  const shape = STAGE_SHAPE[stage];
  if (frozen) return { stage, ...shape, embers: 0, flicker: 4, palette: PALETTES.frozen };
  return { stage, ...shape, palette: PALETTES[stage] };
}
