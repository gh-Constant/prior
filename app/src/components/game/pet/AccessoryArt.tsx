// Accessory art. Each item is authored around (0,0) at scale 1:
// hats sit on their bottom centre, face items are centred on the eye line with
// lenses at x=±10, neck items hang from the chin line.
import type { ReactNode } from "react";
import type { AccessoryAnchor } from "./geometry";
import type { PetAccessoryId } from "./accessories";
import { heartPath, leafPath } from "./shapes";

const SW = 1.3;

function PartyHat() {
  return (
    <g transform="rotate(-10)">
      <path d="M-10.5 0L-1.2 -23Q0 -24.6 1.2 -23L10.5 0Q0 3.4 -10.5 0Z" fill="#ff7b5f" stroke="#bf412b" strokeWidth={SW} strokeLinejoin="round" />
      <path d="M-6.6 -9.6L4.4 -13.6M-8.9 -3.6L7.4 -7.4" stroke="#ffe08a" strokeWidth={2.1} strokeLinecap="round" opacity={0.95} />
      <path d="M-4.6 -18.4Q-2.6 -21 -1.4 -21.6" stroke="#fff" strokeWidth={1.2} strokeLinecap="round" opacity={0.55} fill="none" />
      <path d="M-10.5 0Q0 3.4 10.5 0" fill="none" stroke="#ffd166" strokeWidth={2.2} strokeLinecap="round" />
      <circle cx={0} cy={-24.4} r={3.3} fill="#ffd166" stroke="#c98a14" strokeWidth={SW} />
      <circle cx={-0.9} cy={-25.4} r={1} fill="#fff6d0" />
    </g>
  );
}

function Beanie() {
  // Hugs the skull: the rib band arches with the head so ears poke out at the sides.
  const ribs = [-15, -10, -5, 0, 5, 10, 15];
  return (
    <g>
      <path d="M-18.6 -1.6C-19.4 -14.4 -10 -21.4 0 -21.4C10 -21.4 19.4 -14.4 18.6 -1.6Q0 -8.4 -18.6 -1.6Z" fill="#78c9b8" stroke="#3d8b7c" strokeWidth={SW} strokeLinejoin="round" />
      <path d="M-11 -10.6Q-9 -16.4 -2.6 -18.4" fill="none" stroke="#fff" strokeWidth={1.8} strokeLinecap="round" opacity={0.45} />
      <path d="M-20.6 -3.2Q0 -10.6 20.6 -3.2L20.4 3.6Q0 -3.4 -20.4 3.6Z" fill="#52aa99" stroke="#3d8b7c" strokeWidth={SW} strokeLinejoin="round" />
      {ribs.map((x) => {
        const top = -3.2 - 3.7 * (1 - (x / 20.6) ** 2) + 0.8;
        return <path key={x} d={`M${x} ${top.toFixed(2)}v5.2`} stroke="#3d8b7c" strokeWidth={0.9} strokeLinecap="round" opacity={0.45} />;
      })}
      <circle cx={0} cy={-22.2} r={4.3} fill="#fff6e8" stroke="#c7b193" strokeWidth={SW} />
      <circle cx={-1.3} cy={-23.6} r={1.2} fill="#fff" />
    </g>
  );
}

function Crown() {
  return (
    <g transform="rotate(6)">
      <path d="M-10 0L-11.6 -11.4L-5.6 -6L0 -13.8L5.6 -6L11.6 -11.4L10 0Q0 2 -10 0Z" fill="#ffd45c" stroke="#b27a10" strokeWidth={SW} strokeLinejoin="round" />
      <path d="M-9.4 -3.4Q0 -1.8 9.4 -3.4" fill="none" stroke="#f0b429" strokeWidth={1.4} />
      <circle cx={-11.6} cy={-11.6} r={1.5} fill="#fff1b8" stroke="#b27a10" strokeWidth={0.9} />
      <circle cx={0} cy={-14.2} r={1.7} fill="#fff1b8" stroke="#b27a10" strokeWidth={0.9} />
      <circle cx={11.6} cy={-11.6} r={1.5} fill="#fff1b8" stroke="#b27a10" strokeWidth={0.9} />
      <circle cx={0} cy={-5.6} r={2.2} fill="#ff6b7a" stroke="#b33a4a" strokeWidth={0.9} />
      <circle cx={-6.4} cy={-4.6} r={1.3} fill="#7cc8ff" />
      <circle cx={6.4} cy={-4.6} r={1.3} fill="#7cc8ff" />
      <path d="M-7.6 -8.2L-8.4 -3" stroke="#fff" strokeWidth={1} strokeLinecap="round" opacity={0.6} />
    </g>
  );
}

function Flower() {
  const petals = [0, 72, 144, 216, 288];
  return (
    <g transform="translate(10.5 1.5)">
      <path d={leafPath(9, 5.4)} transform="rotate(118)" fill="#7cc466" stroke="#3f8a3d" strokeWidth={1.1} />
      <path d={leafPath(7, 4.4)} transform="rotate(-150)" fill="#8fd174" stroke="#3f8a3d" strokeWidth={1.1} />
      {petals.map((angle) => (
        <ellipse key={angle} cx={0} cy={-3.9} rx={2.9} ry={3.9} transform={`rotate(${angle})`} fill="#ffa8bb" stroke="#d9637e" strokeWidth={1.1} />
      ))}
      <circle r={2.5} fill="#ffd166" stroke="#d3902a" strokeWidth={1} />
      <circle cx={-0.7} cy={-0.8} r={0.8} fill="#fff4c8" />
    </g>
  );
}

function RoundGlasses() {
  return (
    <g fill="none" stroke="#3b2f2a" strokeWidth={1.5} strokeLinecap="round">
      <circle cx={-10} cy={0} r={6.6} fill="#d6ecff" fillOpacity={0.26} />
      <circle cx={10} cy={0} r={6.6} fill="#d6ecff" fillOpacity={0.26} />
      <path d="M-3.4 -1.2Q0 -3.8 3.4 -1.2" />
      <path d="M-16.5 -1.4L-19.6 -3M16.5 -1.4L19.6 -3" />
      <path d="M-13.8 -2.6Q-12.8 -4.4 -10.8 -4.8M6.2 -2.6Q7.2 -4.4 9.2 -4.8" stroke="#fff" strokeWidth={1.2} opacity={0.8} />
    </g>
  );
}

function HeartShades() {
  return (
    <g strokeLinejoin="round">
      <path d={heartPath(-10, 0.6, 14.4)} fill="#3a2036" fillOpacity={0.88} stroke="#ff5f8f" strokeWidth={1.8} />
      <path d={heartPath(10, 0.6, 14.4)} fill="#3a2036" fillOpacity={0.88} stroke="#ff5f8f" strokeWidth={1.8} />
      <path d="M-3.2 -2Q0 -4 3.2 -2" fill="none" stroke="#ff5f8f" strokeWidth={1.6} strokeLinecap="round" />
      <path d="M-14 -2.4Q-13 -4 -11.4 -4.2M6 -2.4Q7 -4 8.6 -4.2" fill="none" stroke="#fff" strokeWidth={1.2} strokeLinecap="round" opacity={0.85} />
    </g>
  );
}

function Scarf() {
  return (
    <g strokeLinejoin="round">
      <path d="M7.4 3.4L15.8 3.8L17.6 18.4L9.2 17.4Z" fill="#ec5a45" stroke="#ad3827" strokeWidth={SW} />
      <path d="M8.6 8.6L16.4 9M9 13L17 13.4" stroke="#ffe3b8" strokeWidth={1.7} strokeLinecap="round" />
      <path d="M10.6 17.8L10.4 20.4M13.4 18.1L13.4 20.8M16.2 18.3L16.4 20.8" stroke="#ec5a45" strokeWidth={1.4} strokeLinecap="round" />
      <path d="M-19 -3.6C-12 2.6 12 2.6 19 -3.6L19.6 1.6C12 8.4 -12 8.4 -19.6 1.6Z" fill="#ec5a45" stroke="#ad3827" strokeWidth={SW} />
      <path d="M-14 1.8C-8 5.4 8 5.4 14 1.8" fill="none" stroke="#ffe3b8" strokeWidth={1.4} strokeLinecap="round" strokeDasharray="0.1 3.2" />
      <ellipse cx={10.8} cy={4.4} rx={4.2} ry={3.3} fill="#f06b53" stroke="#ad3827" strokeWidth={SW} />
    </g>
  );
}

function BowTie() {
  return (
    <g strokeLinejoin="round">
      <path d="M-1.6 3.6L-10.4 -1.6Q-12.6 3.6 -10.4 8.8Z" fill="#d9477a" stroke="#932650" strokeWidth={SW} />
      <path d="M1.6 3.6L10.4 -1.6Q12.6 3.6 10.4 8.8Z" fill="#d9477a" stroke="#932650" strokeWidth={SW} />
      <circle cx={-7.6} cy={1.8} r={0.9} fill="#fff" opacity={0.9} />
      <circle cx={-8.2} cy={5.8} r={0.9} fill="#fff" opacity={0.9} />
      <circle cx={7.6} cy={1.8} r={0.9} fill="#fff" opacity={0.9} />
      <circle cx={8.2} cy={5.8} r={0.9} fill="#fff" opacity={0.9} />
      <rect x={-2.6} y={1.2} width={5.2} height={4.8} rx={1.8} fill="#e8608f" stroke="#932650" strokeWidth={SW} />
    </g>
  );
}

function BellCollar() {
  return (
    <g strokeLinejoin="round">
      <path d="M-17 -3.2C-10 2.6 10 2.6 17 -3.2L17.4 0.6C10 6.6 -10 6.6 -17.4 0.6Z" fill="#e8553f" stroke="#a8352a" strokeWidth={SW} />
      <circle cx={0} cy={7.4} r={3.8} fill="#ffd45c" stroke="#b27a10" strokeWidth={SW} />
      <path d="M-2.6 8.2H2.6" stroke="#b27a10" strokeWidth={1} strokeLinecap="round" />
      <circle cx={0} cy={9.6} r={0.8} fill="#8a5d0c" />
      <circle cx={-1.3} cy={6} r={0.9} fill="#fff6d0" />
    </g>
  );
}

const ART: Readonly<Record<PetAccessoryId, () => ReactNode>> = {
  "party-hat": PartyHat,
  beanie: Beanie,
  crown: Crown,
  flower: Flower,
  "round-glasses": RoundGlasses,
  "heart-shades": HeartShades,
  scarf: Scarf,
  "bow-tie": BowTie,
  "bell-collar": BellCollar,
};

export function AccessoryArt({ id, anchor, className }: { readonly id: PetAccessoryId; readonly anchor: AccessoryAnchor; readonly className?: string }) {
  const Art = ART[id];
  return (
    <g className={className} data-accessory={id} transform={`translate(${anchor.x} ${anchor.y}) rotate(${anchor.rotate}) scale(${anchor.scale})`}>
      <Art />
    </g>
  );
}

// Framing for wardrobe thumbnails, per item.
const ICON_BOX: Readonly<Record<PetAccessoryId, string>> = {
  "party-hat": "-17 -30 34 34",
  beanie: "-22 -28 44 34",
  crown: "-15 -19 30 30",
  flower: "-2 -12 24 24",
  "round-glasses": "-21 -21 42 42",
  "heart-shades": "-21 -21 42 42",
  scarf: "-21 -10 42 32",
  "bow-tie": "-14 -10 28 28",
  "bell-collar": "-19 -12 38 38",
};

/** A standalone thumbnail of an accessory (decorative). */
export function PetAccessoryIcon({ id, size = 32 }: { readonly id: PetAccessoryId; readonly size?: number }) {
  const Art = ART[id];
  return (
    <svg className="pet-accessory-icon" width={size} height={size} viewBox={ICON_BOX[id]} aria-hidden="true" focusable="false">
      <Art />
    </svg>
  );
}
