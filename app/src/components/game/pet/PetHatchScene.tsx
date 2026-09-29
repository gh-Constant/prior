// Egg → hatch → baby, with a rarity callout for rare species. Remount with a
// new `key` to start over with a fresh egg.
import { useState, type ReactNode } from "react";
import { useEffectsIntensity } from "../../../lib/gamification/effects";
import type { PetSpecies } from "../../../lib/gamification/types";
import { isRareSpecies } from "./hatch";
import { Pet, type PetBackdrop } from "./Pet";
import { useResolvedTheme } from "../../../lib/theme";
import "./PetHatchScene.css";

export type PetHatchSceneProps = {
  /** Species that will hatch (roll it with pickWeightedSpecies). The egg stays a mystery until it breaks. */
  readonly species: PetSpecies;
  /** Change to start the hatch animation. */
  readonly hatchKey?: string | number;
  /** Crack progress shown before hatching (0..1). */
  readonly crack?: number;
  readonly size?: number;
  readonly backdrop?: PetBackdrop;
  /** Accessible label of the egg/pet. */
  readonly label?: string;
  /** Badge text for rare species, e.g. "Rare!". */
  readonly rareLabel?: string;
  /** Callout content under the pet once hatched (e.g. the species name). */
  readonly revealContent?: ReactNode;
  readonly onHatched?: (species: PetSpecies) => void;
};

export function PetHatchScene({ species, hatchKey, crack = 0, size = 160, backdrop: backdropProp, label, rareLabel = "Rare!", revealContent, onHatched }: PetHatchSceneProps) {
  const [hatched, setHatched] = useState(false);
  const theme = useResolvedTheme();
  const backdrop: PetBackdrop = backdropProp ?? theme;
  const still = useEffectsIntensity() === "off";
  const rare = hatched && isRareSpecies(species);
  return (
    <div className={["pet-hatch-scene", rare ? "is-rare" : "", still ? "is-still" : "", `pet-hatch-scene--${backdrop}`].filter(Boolean).join(" ")}>
      <div className="pet-hatch-stage">
        {rare && <span className="pet-hatch-rays" aria-hidden="true" />}
        <Pet
          species={species}
          stage={hatched ? "baby" : "egg"}
          mood={hatched ? "happy" : "content"}
          mysteryEgg={!hatched}
          crack={crack}
          size={size}
          backdrop={backdrop}
          reaction="hatch"
          reactionKey={hatchKey}
          label={label}
          onReactionEnd={(reaction) => {
            if (reaction !== "hatch") return;
            setHatched(true);
            onHatched?.(species);
          }}
        />
      </div>
      {hatched && (revealContent || rare) && (
        <div className="pet-hatch-callout" role="status">
          {rare && <span className="pet-hatch-badge">{rareLabel}</span>}
          {revealContent}
        </div>
      )}
    </div>
  );
}
