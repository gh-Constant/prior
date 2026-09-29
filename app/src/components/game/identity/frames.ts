// Avatar frame catalogue. Frames are earned through rarity-tiered achievements
// and themed milestones (streaks, planning, freezes, diamond league).
import type { Rarity } from "../../../lib/gamification/types";

export type AvatarFrameId = "none" | "common" | "rare" | "epic" | "legendary" | "flame" | "laurel" | "frost" | "prism";

export const AVATAR_FRAMES: readonly Exclude<AvatarFrameId, "none">[] = ["common", "rare", "epic", "legendary", "flame", "laurel", "frost", "prism"];

export const AVATAR_FRAME_RARITY: Readonly<Record<AvatarFrameId, Rarity>> = {
  none: "common",
  common: "common",
  rare: "rare",
  epic: "epic",
  legendary: "legendary",
  flame: "epic",
  laurel: "rare",
  frost: "rare",
  prism: "legendary",
};

export type FrameDetail = "full" | "reduced" | "minimal";

/** How much ornament a frame can afford at a pixel size: tiny avatars keep only the ring. */
export function frameDetailForSize(size: number): FrameDetail {
  if (size >= 48) return "full";
  if (size >= 30) return "reduced";
  return "minimal";
}

type Point = readonly [number, number];

/** Point on a circle centered in the 100×100 frame box; degrees clockwise from 12 o'clock. */
export function polar(radius: number, degrees: number): Point {
  const radians = (degrees * Math.PI) / 180;
  return [50 + radius * Math.sin(radians), 50 - radius * Math.cos(radians)];
}

export type LaurelLeaf = { readonly x: number; readonly y: number; readonly rotate: number; readonly scale: number };

/** Leaves of the left laurel branch (the right branch mirrors it), from the bottom up. */
export function laurelLeaves(): LaurelLeaf[] {
  const leaves: LaurelLeaf[] = [];
  const count = 9;
  for (let index = 0; index < count; index += 1) {
    const degrees = 199 + index * 13;
    const scale = 1 - index * 0.045;
    // Both leaves grow from the stem; side 1 tilts outward, side -1 inward.
    const [x, y] = polar(46.5, degrees);
    for (const side of [-1, 1] as const) {
      leaves.push({ x, y, rotate: degrees - side * 34, scale });
    }
  }
  return leaves;
}
