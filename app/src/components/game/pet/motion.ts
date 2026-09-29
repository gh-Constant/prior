// Web Animations keyframes for one-shot reactions. `a` is the amplitude
// (1 = full, ~0.5 = subtle). Lengths are in viewBox units.
import type { PetReaction } from "../../../lib/gamification/types";

type Frames = Keyframe[];
export type ReactionTrack = { readonly selector: string; readonly frames: Frames; readonly duration: number; readonly easing?: string; readonly delay?: number };

const n = (value: number) => Math.round(value * 1000) / 1000;

export function reactionTracks(reaction: Exclude<PetReaction, "hatch">, a: number): ReactionTrack[] {
  switch (reaction) {
    case "hop":
      return [
        {
          selector: ".pet-react",
          duration: 760,
          frames: [
            { transform: "translateY(0) scale(1, 1)", offset: 0, easing: "ease-out" },
            { transform: `translateY(0) scale(${n(1 + 0.12 * a)}, ${n(1 - 0.14 * a)})`, offset: 0.16, easing: "cubic-bezier(.2,.8,.4,1)" },
            { transform: `translateY(${n(-18 * a)}px) scale(${n(1 - 0.06 * a)}, ${n(1 + 0.08 * a)})`, offset: 0.46, easing: "ease-in-out" },
            { transform: `translateY(${n(-19 * a)}px) scale(1, 1)`, offset: 0.54, easing: "cubic-bezier(.5,0,.8,.4)" },
            { transform: `translateY(0) scale(${n(1 + 0.1 * a)}, ${n(1 - 0.1 * a)})`, offset: 0.84, easing: "ease-out" },
            { transform: "translateY(0) scale(1, 1)", offset: 1 },
          ],
        },
        ...pawTracks(760, [0, 0.16, 0.46, 0.6, 0.86, 1], [0, 0, 72, 62, 0, 0], a),
        {
          selector: ".pet-shadow",
          duration: 760,
          frames: [
            { transform: "scale(1)", offset: 0 },
            { transform: `scale(${n(1 + 0.08 * a)})`, offset: 0.16 },
            { transform: `scale(${n(1 - 0.35 * a)})`, offset: 0.5 },
            { transform: `scale(${n(1 + 0.08 * a)})`, offset: 0.84 },
            { transform: "scale(1)", offset: 1 },
          ],
        },
      ];
    case "dance": {
      const hop = (y: number, r: number, offset: number): Keyframe => ({ transform: `translateY(${n(y * a)}px) rotate(${n(r * a)}deg)`, offset, easing: "ease-in-out" });
      return [
        {
          selector: ".pet-react",
          duration: 1700,
          frames: [
            hop(0, 0, 0), hop(-7, -11, 0.11), hop(0, -5, 0.22), hop(-7, 11, 0.33), hop(0, 5, 0.44),
            hop(-7, -11, 0.55), hop(0, -5, 0.66), hop(-7, 11, 0.77),
            { transform: `translateY(${n(-12 * a)}px) rotate(0deg) scale(${n(1 - 0.04 * a)}, ${n(1 + 0.06 * a)})`, offset: 0.88, easing: "ease-in" },
            { transform: `translateY(0) scale(${n(1 + 0.08 * a)}, ${n(1 - 0.08 * a)})`, offset: 0.96 },
            { transform: "translateY(0) rotate(0deg) scale(1, 1)", offset: 1 },
          ],
        },
        ...pawTracks(1700, [0, 0.11, 0.22, 0.33, 0.44, 0.55, 0.66, 0.77, 0.88, 1], [0, 85, 25, 85, 25, 85, 25, 85, 110, 0], a, [0, 25, 85, 25, 85, 25, 85, 25, 110, 0]),
        {
          selector: ".pet-head",
          duration: 1700,
          frames: [0, 0.11, 0.22, 0.33, 0.44, 0.55, 0.66, 0.77, 1].map((offset, index) => ({ transform: `rotate(${index === 0 || index === 8 ? 0 : n((index % 2 ? 6 : -6) * a)}deg)`, offset, easing: "ease-in-out" })),
        },
      ];
    }
    case "purr":
      return [
        {
          selector: ".pet-react",
          duration: 1000,
          frames: [
            { transform: "scale(1, 1) rotate(0deg)", offset: 0, easing: "ease-out" },
            { transform: `scale(${n(1 + 0.12 * a)}, ${n(1 - 0.13 * a)}) rotate(0deg)`, offset: 0.14, easing: "ease-in-out" },
            { transform: `scale(${n(1 - 0.04 * a)}, ${n(1 + 0.05 * a)}) rotate(0deg)`, offset: 0.3 },
            { transform: `scale(${n(1 + 0.03 * a)}, ${n(1 - 0.03 * a)}) rotate(${n(1.6 * a)}deg)`, offset: 0.4 },
            { transform: `scale(1, 1) rotate(${n(-1.6 * a)}deg)`, offset: 0.48 },
            { transform: `scale(1, 1) rotate(${n(1.4 * a)}deg)`, offset: 0.56 },
            { transform: `scale(1, 1) rotate(${n(-1.2 * a)}deg)`, offset: 0.64 },
            { transform: `scale(1, 1) rotate(${n(0.9 * a)}deg)`, offset: 0.72 },
            { transform: `scale(1, 1) rotate(${n(-0.5 * a)}deg)`, offset: 0.82 },
            { transform: "scale(1, 1) rotate(0deg)", offset: 1 },
          ],
        },
        {
          selector: ".pet-head",
          duration: 1000,
          frames: [
            { transform: "rotate(0deg)", offset: 0 },
            { transform: `rotate(${n(-7 * a)}deg) translateY(${n(0.8 * a)}px)`, offset: 0.3, easing: "ease-in-out" },
            { transform: `rotate(${n(-6 * a)}deg) translateY(${n(0.8 * a)}px)`, offset: 0.7, easing: "ease-in-out" },
            { transform: "rotate(0deg)", offset: 1 },
          ],
        },
      ];
    case "yawn":
      return [
        {
          selector: ".pet-head",
          duration: 1900,
          frames: [
            { transform: "rotate(0deg) translateY(0)", offset: 0, easing: "ease-in-out" },
            { transform: `rotate(${n(-6 * a)}deg) translateY(${n(-1.6 * a)}px)`, offset: 0.3, easing: "ease-in-out" },
            { transform: `rotate(${n(-7 * a)}deg) translateY(${n(-2 * a)}px)`, offset: 0.6, easing: "ease-in-out" },
            { transform: "rotate(0deg) translateY(0)", offset: 1 },
          ],
        },
        {
          selector: ".pet-react",
          duration: 1900,
          frames: [
            { transform: "scale(1, 1)", offset: 0, easing: "ease-in-out" },
            { transform: `scale(${n(1 - 0.03 * a)}, ${n(1 + 0.05 * a)})`, offset: 0.4, easing: "ease-in-out" },
            { transform: `scale(${n(1 + 0.03 * a)}, ${n(1 - 0.03 * a)})`, offset: 0.78, easing: "ease-in-out" },
            { transform: "scale(1, 1)", offset: 1 },
          ],
        },
      ];
    case "wiggle":
      return [
        {
          selector: ".pet-react",
          duration: 720,
          frames: [0, -9, 8, -6, 4, -2, 0].map((deg, index, all) => ({ transform: `rotate(${n(deg * a)}deg)`, offset: index / (all.length - 1), easing: "ease-in-out" })),
        },
      ];
  }
}

/** Arm swings: `left` degrees raise the left paw outward; the right mirrors `right` (or `left`). */
function pawTracks(duration: number, offsets: number[], left: number[], a: number, right: number[] = left): ReactionTrack[] {
  const frames = (values: number[], sign: number): Keyframe[] => offsets.map((offset, index) => ({ transform: `rotate(${n(values[index] * a * sign)}deg)`, offset, easing: "ease-in-out" }));
  return [
    { selector: ".pet-paw--l", duration, frames: frames(left, 1) },
    { selector: ".pet-paw--r", duration, frames: frames(right, -1) },
  ];
}

/** Egg rattling before the shell breaks. */
export function hatchShakeFrames(a: number): Frames {
  const degrees = [0, -4, 4, -3, 5, -6, 6, -8, 8, -10, 10, -12, 9, 0];
  return degrees.map((deg, index) => ({ transform: `rotate(${n(deg * a)}deg) translateY(${index % 2 ? n(-1.2 * a) : 0}px)`, offset: index / (degrees.length - 1) }));
}

/** A small egg rattle when the egg is poked. */
export function eggNudgeFrames(a: number): Frames {
  return [0, -7, 6, -4, 2, 0].map((deg, index, all) => ({ transform: `rotate(${n(deg * a)}deg)`, offset: index / (all.length - 1), easing: "ease-in-out" }));
}

export const BLINK_FRAMES: Frames = [
  { transform: "scaleY(1)", offset: 0 },
  { transform: "scaleY(0.08)", offset: 0.45 },
  { transform: "scaleY(0.08)", offset: 0.55 },
  { transform: "scaleY(1)", offset: 1 },
];

export const SLOW_BLINK_FRAMES: Frames = [
  { transform: "scaleY(1)", offset: 0 },
  { transform: "scaleY(0.1)", offset: 0.3 },
  { transform: "scaleY(0.1)", offset: 0.7 },
  { transform: "scaleY(1)", offset: 1 },
];

export function earTwitchFrames(a: number): Frames {
  return [
    { transform: "rotate(0deg)", offset: 0 },
    { transform: `rotate(${n(-14 * a)}deg)`, offset: 0.3 },
    { transform: `rotate(${n(5 * a)}deg)`, offset: 0.62 },
    { transform: "rotate(0deg)", offset: 1 },
  ];
}
