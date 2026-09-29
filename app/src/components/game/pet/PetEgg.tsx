// The speckled egg. Speckles hint at the species inside (or stay mixed when it
// is still a mystery); cracks grow with `crack` (0..1).
import type { CSSProperties } from "react";
import type { PetSpecies } from "../../../lib/gamification/types";
import { EGG_SHELL, MYSTERY_EGG_SPOTS, PET_PALETTES } from "./palette";
import { flamePath, heartPath, leafPath, sparklePath } from "./shapes";

export const EGG_PATH = "M60 51C73.6 51 82.6 70 82.6 84C82.6 98 73 108 60 108C47 108 37.4 98 37.4 84C37.4 70 46.4 51 60 51Z";

// The zigzag the shell splits along when it hatches.
const SPLIT = "L90 80L81 80.6L76 75.4L70.4 81.4L64.8 74.6L59.2 81L53.6 74.6L48.2 81.4L43 75.6L38.6 80.4L30 80";
const TOP_CLIP = `M0 0H120V80${SPLIT}L0 80Z`;
const BOTTOM_CLIP = `M0 120H120V80${SPLIT}L0 80Z`;

type Crack = { readonly d: string; readonly from: number; readonly to: number };
const CRACKS: readonly Crack[] = [
  { d: "M48.2 81.4L53.6 74.6L59.2 81L64.8 74.6L70.4 81.4", from: 0.05, to: 0.45 },
  { d: "M70.4 81.4L76 75.4L81 80.6M59.2 81L57.6 76.4L60.4 72.2", from: 0.4, to: 0.75 },
  { d: "M48.2 81.4L43 75.6L38.6 80.4M64.8 74.6L66.8 69.6L64.6 66", from: 0.7, to: 1 },
];

// x, y, rx, ry, rotation, colour index, shape
type Spot = readonly [number, number, number, number, number, 0 | 1, "dot" | "mark"];
const SPOTS: readonly Spot[] = [
  [50.5, 63, 3.2, 2.5, -24, 0, "dot"],
  [67.5, 60.5, 2.3, 1.8, 18, 1, "mark"],
  [73.5, 73.5, 3.7, 2.8, 32, 0, "dot"],
  [45.5, 76, 2.4, 1.9, -8, 1, "mark"],
  [47, 92, 3.3, 2.5, -12, 0, "dot"],
  [60.5, 90, 2.6, 2, 0, 1, "mark"],
  [73, 94, 2.5, 1.9, 22, 0, "dot"],
  [58, 70, 1.8, 1.4, 0, 0, "dot"],
  [60, 101.5, 1.9, 1.4, 0, 0, "dot"],
];

function SpotMark({ species, x, y, size, color }: { readonly species: PetSpecies | null; readonly x: number; readonly y: number; readonly size: number; readonly color: string }) {
  switch (species) {
    case "mochi":
      return <path d={heartPath(x, y, size * 1.9)} fill={color} />;
    case "fern":
      return <path d={leafPath(size * 2.4, size * 1.4)} transform={`translate(${x} ${y + size}) rotate(28)`} fill={color} />;
    case "nova":
      return <path d={sparklePath(x, y, size * 1.3)} fill={color} />;
    case "ember":
      return <path d={flamePath(x, y + size * 0.8, size * 2.2)} fill={color} />;
    default:
      return <ellipse cx={x} cy={y} rx={size} ry={size * 0.78} fill={color} />;
  }
}

/** Shell surface (drawn once per shell half). */
function Shell({ uid, species }: { readonly uid: string; readonly species: PetSpecies | null }) {
  const colors = species ? PET_PALETTES[species].eggSpots : null;
  return (
    <g>
      <path d={EGG_PATH} fill={`url(#${uid}-egg)`} stroke={EGG_SHELL.outline} strokeWidth={1.5} />
      <g opacity={0.92}>
        {SPOTS.map(([x, y, rx, ry, rotate, tone, shape], index) => {
          const color = colors ? colors[tone] : MYSTERY_EGG_SPOTS[index % MYSTERY_EGG_SPOTS.length];
          if (shape === "mark" && species) return <SpotMark key={index} species={species} x={x} y={y} size={rx} color={color} />;
          return <ellipse key={index} cx={x} cy={y} rx={rx} ry={ry} transform={`rotate(${rotate} ${x} ${y})`} fill={color} />;
        })}
      </g>
      <path d="M46.5 66Q49.5 58.6 55.6 55.4" fill="none" stroke="#fff" strokeWidth={2.6} strokeLinecap="round" opacity={0.75} />
    </g>
  );
}

// Shell shade leans toward the species inside; a mystery egg stays neutral.
const EGG_TINT: Readonly<Record<PetSpecies, string>> = {
  mochi: "#f3d3c4",
  fern: "#d9e8bd",
  nova: "#d9d5f0",
  ember: "#f6cfae",
};

/** Eggs are drawn a little larger than the raw path, scaled from the ground point. */
const EGG_SCALE = "translate(60 108) scale(1.12) translate(-60 -108)";

export function EggDefs({ uid, species = null }: { readonly uid: string; readonly species?: PetSpecies | null }) {
  return (
    <defs>
      <radialGradient id={`${uid}-egg`} cx="0.38" cy="0.32" r="0.8">
        <stop offset="0" stopColor={EGG_SHELL.light} />
        <stop offset="0.55" stopColor={EGG_SHELL.base} />
        <stop offset="1" stopColor={species ? EGG_TINT[species] : EGG_SHELL.shade} />
      </radialGradient>
      <clipPath id={`${uid}-egg-top`}><path d={TOP_CLIP} /></clipPath>
      <clipPath id={`${uid}-egg-bottom`}><path d={BOTTOM_CLIP} /></clipPath>
    </defs>
  );
}

function crackOffset(crack: number, { from, to }: Crack): number {
  const t = Math.min(1, Math.max(0, (crack - from) / (to - from)));
  return 1 - t;
}

type EggProps = {
  readonly uid: string;
  /** Species inside, or null for a mystery egg with mixed speckles. */
  readonly species: PetSpecies | null;
  readonly crack: number;
  /** Colour of the light leaking through the cracks. */
  readonly glow?: string;
};

/** The whole egg, made of two halves so the hatch can split it. */
export function PetEggShell({ uid, species, crack, glow }: EggProps) {
  return (
    <g className="pet-egg-shell" transform={EGG_SCALE}>
      <g className="pet-egg-half pet-egg-half--bottom" clipPath={`url(#${uid}-egg-bottom)`}><Shell uid={uid} species={species} /></g>
      <g className="pet-egg-half pet-egg-half--top" clipPath={`url(#${uid}-egg-top)`}><Shell uid={uid} species={species} /></g>
      {glow && crack > 0.5 && (
        <g fill="none" stroke={glow} strokeWidth={3.6} strokeLinecap="round" strokeLinejoin="round" opacity={Math.min(0.7, (crack - 0.5) * 1.6)} className="pet-egg-crack-glow">
          {CRACKS.map((item) => <path key={item.d} d={item.d} pathLength={1} strokeDasharray="1 1" strokeDashoffset={crackOffset(crack, item)} />)}
        </g>
      )}
      <g fill="none" stroke={EGG_SHELL.crack} strokeWidth={1.3} strokeLinecap="round" strokeLinejoin="round">
        {CRACKS.map((item) => (
          <path key={item.d} className="pet-egg-crack" d={item.d} pathLength={1} strokeDasharray="1 1" strokeDashoffset={crackOffset(crack, item)} style={{ transition: "stroke-dashoffset 0.6s ease-out" } as CSSProperties} />
        ))}
      </g>
    </g>
  );
}

/** Loose shell pieces for the hatch burst. */
export function PetEggBurst({ uid, species }: { readonly uid: string; readonly species: PetSpecies | null }) {
  return (
    <g className="pet-egg-burst" aria-hidden="true" transform={EGG_SCALE}>
      <g className="pet-shell-bottom" clipPath={`url(#${uid}-egg-bottom)`}><Shell uid={uid} species={species} /></g>
      <g className="pet-shell-top" clipPath={`url(#${uid}-egg-top)`}><Shell uid={uid} species={species} /></g>
    </g>
  );
}
