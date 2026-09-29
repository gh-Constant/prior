// Static head crop for avatars (leaderboards, profile cards), with the hat and face items.
import { useId, useMemo } from "react";
import type { PetMood, PetSpecies, PetStage } from "../../../lib/gamification/types";
import { HAT_HEIGHT, sanitizeAccessories, type PetAccessories } from "./accessories";
import { moodExpression } from "./expressions";
import { getAccessoryAnchor, getPetGeometry, headFeaturesTop } from "./geometry";
import { PET_PALETTES } from "./palette";
import { PetDefs, PetHead } from "./PetFigure";
import { EggDefs, PetEggShell } from "./PetEgg";
import "./pet.css";

export type PetHeadshotProps = {
  readonly species: PetSpecies;
  readonly stage: PetStage;
  /** Only the hat and face slots show on a headshot. */
  readonly accessories?: PetAccessories;
  /** Expression to freeze; "content" (open eyes) by default. */
  readonly mood?: PetMood;
  /** Rendered size in px (24–96 recommended). */
  readonly size?: number;
  /** Circle behind the head: a CSS colour, "tint" for the species tint, or "none". */
  readonly background?: string;
  readonly name?: string;
  readonly label?: string;
  readonly decorative?: boolean;
  readonly className?: string;
};

/** Soft species tints for the avatar circle. */
export const PET_HEADSHOT_TINTS: Readonly<Record<PetSpecies, string>> = {
  mochi: "#fde6dc",
  fern: "#e3f3d2",
  nova: "#e3e4fb",
  ember: "#ffe6cf",
};

function cleanId(id: string): string {
  return `pet${id.replace(/[^a-zA-Z0-9_-]/g, "")}`;
}

export function PetHeadshot({ species, stage, accessories, mood = "content", size = 48, background = "tint", name, label, decorative = false, className }: PetHeadshotProps) {
  const uid = cleanId(useId());
  const equipped = useMemo(() => {
    const clean = sanitizeAccessories(accessories);
    return { hat: clean.hat ?? null, face: clean.face ?? null };
  }, [accessories]);
  const fill = background === "tint" ? PET_HEADSHOT_TINTS[species] : background;
  const a11y = decorative
    ? { "aria-hidden": true as const }
    : { role: "img" as const, "aria-label": label ?? name ?? species };

  if (stage === "egg") {
    return (
      <svg className={["pet", "pet--still", "pet-headshot", className].filter(Boolean).join(" ")} width={size} height={size} viewBox="28 46 64 64" focusable="false" {...a11y}>
        <EggDefs uid={uid} species={species} />
        {fill !== "none" && <circle cx={60} cy={78} r={32} fill={fill} />}
        <g transform="translate(60 78) scale(0.74) translate(-60 -78)">
          <PetEggShell uid={uid} species={species} crack={0} />
        </g>
      </svg>
    );
  }

  const geometry = getPetGeometry(species, stage);
  const { head } = geometry;
  let top = headFeaturesTop(geometry);
  if (equipped.hat) {
    const anchor = getAccessoryAnchor(species, stage, "hat");
    top = Math.min(top, anchor.y - (HAT_HEIGHT[equipped.hat] ?? 0) * anchor.scale);
  }
  top -= 1.5;
  const bottom = head.cy + head.ry + 5;
  const side = Math.max(bottom - top, head.rx * 2 + 22);
  const y = bottom - side;
  const x = 60 - side / 2;
  const viewBox = `${x.toFixed(2)} ${y.toFixed(2)} ${side.toFixed(2)} ${side.toFixed(2)}`;

  return (
    <svg className={["pet", "pet--still", "pet-headshot", className].filter(Boolean).join(" ")} width={size} height={size} viewBox={viewBox} focusable="false" {...a11y}>
      <PetDefs uid={uid} geometry={geometry} palette={PET_PALETTES[species]} />
      {fill !== "none" && <circle cx={60} cy={y + side / 2} r={side / 2} fill={fill} />}
      <PetHead uid={uid} geometry={geometry} palette={PET_PALETTES[species]} expression={moodExpression(mood)} accessories={equipped} />
    </svg>
  );
}
