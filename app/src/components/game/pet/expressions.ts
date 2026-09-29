// Pure mapping from mood and one-shot reactions to a facial expression.
import type { PetMood, PetReaction } from "../../../lib/gamification/types";

export type PetEyeState = "open" | "happy" | "closed" | "half" | "star";
export type PetMouthState = "smile" | "open" | "yawn" | "small" | "tiny";

export type PetExpression = {
  readonly eyes: PetEyeState;
  readonly mouth: PetMouthState;
  /** Stronger cheek blush. */
  readonly blush: boolean;
};

const MOOD_EXPRESSIONS: Readonly<Record<PetMood, PetExpression>> = {
  happy: { eyes: "happy", mouth: "open", blush: true },
  content: { eyes: "open", mouth: "smile", blush: false },
  sleepy: { eyes: "half", mouth: "small", blush: false },
  asleep: { eyes: "closed", mouth: "tiny", blush: false },
  excited: { eyes: "star", mouth: "open", blush: true },
};

export function moodExpression(mood: PetMood): PetExpression {
  return MOOD_EXPRESSIONS[mood];
}

/** Expression held while a reaction plays; null keeps the mood's face. */
export function reactionExpression(reaction: PetReaction, mood: PetMood): PetExpression | null {
  switch (reaction) {
    case "hop":
      return { eyes: mood === "excited" ? "star" : "happy", mouth: "open", blush: true };
    case "dance":
      return { eyes: "happy", mouth: "open", blush: true };
    case "purr":
      return { eyes: "happy", mouth: "smile", blush: true };
    case "yawn":
      return { eyes: "closed", mouth: "yawn", blush: false };
    case "wiggle":
      return { eyes: mood === "asleep" ? "half" : "happy", mouth: "smile", blush: false };
    case "hatch":
      return null;
  }
}

/** Duration in ms that each reaction holds the stage. */
export const REACTION_DURATION: Readonly<Record<PetReaction, number>> = {
  hop: 760,
  dance: 1700,
  purr: 1000,
  yawn: 1900,
  wiggle: 720,
  hatch: 3000,
};

/** Duration used when motion is off: long enough to read the expression. */
export const STILL_REACTION_DURATION = 900;
