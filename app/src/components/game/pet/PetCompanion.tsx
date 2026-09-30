// Compact sidebar companion: the pet, its name and mood. Clicking pets it (purr).
import { useRef } from "react";
import type { PetMood, PetReaction, PetSpecies, PetStage } from "../../../lib/gamification/types";
import type { PetAccessories } from "./accessories";
import { Pet, type PetBackdrop, type PetHandle } from "./Pet";
import "./PetCompanion.css";

export type PetCompanionProps = {
  readonly species: PetSpecies;
  readonly stage: PetStage;
  readonly mood: PetMood;
  readonly name: string;
  /** Localized mood line under the name, e.g. "Happy". Hidden when empty. */
  readonly moodLabel?: string;
  /** Accessible name of the button, e.g. "Pet Mochi". */
  readonly actionLabel?: string;
  readonly accessories?: PetAccessories;
  readonly crack?: number;
  readonly mysteryEgg?: boolean;
  /** External trigger (task completed → "hop", level-up → "dance"). */
  readonly reaction?: PetReaction | null;
  readonly reactionKey?: string | number;
  readonly onReactionEnd?: (reaction: PetReaction) => void;
  /** Called after the pet is clicked. */
  readonly onPet?: () => void;
  /** Pet size in px (the row is about 12px taller). */
  readonly size?: number;
  readonly backdrop?: PetBackdrop;
  readonly trackPointer?: boolean;
  readonly className?: string;
};

export function PetCompanion({
  species,
  stage,
  mood,
  name,
  moodLabel,
  actionLabel,
  accessories,
  crack,
  mysteryEgg,
  reaction,
  reactionKey,
  onReactionEnd,
  onPet,
  size = 72,
  backdrop = "dark",
  trackPointer = true,
  className,
}: PetCompanionProps) {
  const petRef = useRef<PetHandle>(null);
  return (
    <button
      type="button"
      className={["pet-companion", `pet-companion--${backdrop}`, stage === "egg" ? "pet-companion--egg" : "", className].filter(Boolean).join(" ")}
      aria-label={actionLabel ?? `Pet ${name}`}
      onClick={() => {
        petRef.current?.play(stage === "egg" ? "wiggle" : "purr");
        onPet?.();
      }}
    >
      <span className="pet-companion-stage" style={{ width: size, height: size }}>
        <Pet
          ref={petRef}
          species={species}
          stage={stage}
          mood={mood}
          size={size}
          zoom={1.3}
          accessories={accessories}
          crack={crack}
          mysteryEgg={mysteryEgg}
          reaction={reaction}
          reactionKey={reactionKey}
          onReactionEnd={onReactionEnd}
          backdrop={backdrop}
          trackPointer={trackPointer}
          decorative
        />
      </span>
      <span className="pet-companion-text" aria-hidden="true">
        <span className="pet-companion-name">{name}</span>
        {moodLabel && <span className="pet-companion-mood">{moodLabel}</span>}
      </span>
    </button>
  );
}
