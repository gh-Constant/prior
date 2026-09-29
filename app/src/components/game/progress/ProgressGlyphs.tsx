// Small art for rewards and avatars on the Progress page: room items, the
// streak freeze, a title ribbon and a border ring for chest cards, and the
// avatar a player shows on boards (pet headshot, photo or initial).
import type { ReactNode } from "react";
import { CONFETTI_THEME_SPECS } from "../../../lib/fx/themes";
import { equippedAccessories, type CatalogEntry, type RoomArt } from "../../../lib/gamification/catalog";
import type { GameEquipped } from "../../../lib/gamification/state";
import type { PetSpecies, PetStage } from "../../../lib/gamification/types";
import { AvatarPlaceholder } from "../identity/AvatarFrame";
import { ConfettiPreview, PetGlyph } from "../identity/glyphs";
import { PetAccessoryIcon } from "../pet/AccessoryArt";
import { PetHeadshot } from "../pet/PetHeadshot";

const OUTLINE = { stroke: "rgb(0 0 0 / 0.35)", strokeWidth: 1.2, strokeLinejoin: "round" as const };

/** Den decorations drawn in the PetGlyph style (48×48). */
export function RoomGlyph({ room, size = 44 }: { readonly room: RoomArt; readonly size?: number }) {
  if (room === "plant") return <PetGlyph glyph="plant" size={size} />;
  if (room === "lamp") return <PetGlyph glyph="lamp" size={size} />;
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      {room === "rug" && (
        <g {...OUTLINE}>
          <ellipse cx="24" cy="30" rx="20" ry="9" fill="#e07a5f" />
          <ellipse cx="24" cy="30" rx="14" ry="5.6" fill="#f2cc8f" />
          <ellipse cx="24" cy="30" rx="7" ry="2.6" fill="#81b29a" />
          <path d="M5 34 L3 37 M9 37 L8 40 M15 38.5 L14.5 41.5 M24 39 V42 M33 38.5 L33.5 41.5 M39 37 L40 40 M43 34 L45 37" stroke="#b5533c" strokeWidth="1.2" />
        </g>
      )}
      {room === "cushion" && (
        <g {...OUTLINE}>
          <path d="M9 18 C9 12 13 11 24 11 C35 11 39 12 39 18 L40 31 C40 37 35 38 24 38 C13 38 8 37 8 31 Z" fill="#f7a58f" />
          <path d="M13 17 C18 15 30 15 35 17 M13 32 C18 34 30 34 35 32" fill="none" stroke="#e98b74" strokeWidth="1.2" />
          <circle cx="24" cy="24.5" r="2.4" fill="#d9785f" />
        </g>
      )}
      {room === "shelf" && (
        <g {...OUTLINE}>
          <rect x="7" y="7" width="34" height="35" rx="2.5" fill="#b07a4f" />
          <rect x="10" y="10" width="28" height="12" fill="#6d4a30" stroke="none" />
          <rect x="10" y="26" width="28" height="12.5" fill="#6d4a30" stroke="none" />
          <rect x="12" y="12" width="4" height="10" rx="0.8" fill="#4b86f0" />
          <rect x="17" y="13.5" width="4" height="8.5" rx="0.8" fill="#f35f43" />
          <rect x="22" y="12" width="3.5" height="10" rx="0.8" fill="#f6c445" />
          <path d="M28 22 L31 12.5 L34.5 13.5 L31.5 22 Z" fill="#3fae6a" />
          <rect x="12" y="29" width="4.5" height="9.5" rx="0.8" fill="#a78bfa" />
          <rect x="17.5" y="30.5" width="4" height="8" rx="0.8" fill="#10b981" />
          <circle cx="30" cy="34" r="4.2" fill="#fde68a" />
        </g>
      )}
      {room === "frame" && (
        <g {...OUTLINE}>
          <rect x="7" y="9" width="34" height="30" rx="2" fill="#e0a01a" />
          <rect x="11" y="13" width="26" height="22" fill="#bfe3f5" stroke="#b77a05" />
          <circle cx="30" cy="19" r="3" fill="#ffd166" stroke="none" />
          <path d="M11 35 L19 24 L25 31 L29 27 L37 35 Z" fill="#6fbf73" stroke="none" />
        </g>
      )}
      {room === "lights" && (
        <g>
          <path d="M4 14 Q24 30 44 14" fill="none" stroke="#4b4540" strokeWidth="1.4" />
          {[
            [9, 18.2, "#f35f43"],
            [16.5, 22.2, "#f6c445"],
            [24, 23.6, "#4b86f0"],
            [31.5, 22.2, "#3fae6a"],
            [39, 18.2, "#a78bfa"],
          ].map(([x, y, color]) => (
            <g key={String(x)}>
              <circle cx={Number(x)} cy={Number(y) + 5} r="5.5" fill={String(color)} opacity="0.22" />
              <path d={`M${Number(x) - 2.6} ${Number(y) + 2} C${Number(x) - 3} ${Number(y) + 7} ${Number(x) + 3} ${Number(y) + 7} ${Number(x) + 2.6} ${Number(y) + 2} Z`} fill={String(color)} {...OUTLINE} />
              <rect x={Number(x) - 1.6} y={Number(y) - 0.4} width="3.2" height="2.6" rx="0.6" fill="#57534e" />
            </g>
          ))}
        </g>
      )}
    </svg>
  );
}

export function FreezeGlyph({ size = 24 }: { readonly size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true" focusable="false">
      <path d="M12 2.5v19M3.8 7.25l16.4 9.5M3.8 16.75l16.4-9.5" />
      <path d="m9.2 4.2 2.8 2.3 2.8-2.3M9.2 19.8l2.8-2.3 2.8 2.3M3.5 10.8l3.4-1.2-.6-3.5M20.5 13.2l-3.4 1.2.6 3.5M3.5 13.2l3.4 1.2-.6 3.5M20.5 10.8l-3.4-1.2.6-3.5" />
    </svg>
  );
}

function RibbonGlyph() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M2.5 8.5h19l-2.5 3.5 2.5 3.5h-19L5 12Z" />
      <path d="M6.5 11.8h11" strokeLinecap="round" />
    </svg>
  );
}

function RingGlyph() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true" focusable="false">
      <circle cx="12" cy="12" r="8.2" strokeWidth="3" />
      <circle cx="12" cy="12" r="4.4" strokeWidth="1.2" opacity="0.7" />
      <path d="M12 1.8 13.2 4 12 5.2 10.8 4Z" fill="currentColor" strokeWidth="0.6" />
    </svg>
  );
}

/** Icon of a catalog item for chest cards (drawn at 24px on a rarity disc). */
export function RewardIcon({ entry }: { readonly entry: CatalogEntry | undefined }): ReactNode {
  if (!entry) return <FreezeGlyph />;
  switch (entry.kind) {
    case "border":
      return <RingGlyph />;
    case "title":
      return <RibbonGlyph />;
    case "confetti":
      return <ConfettiPreview colors={CONFETTI_THEME_SPECS[entry.theme].colors} seed={entry.id} size={24} />;
    case "pet-room":
      return <RoomGlyph room={entry.room} size={24} />;
    default:
      return <PetAccessoryIcon id={entry.accessory} size={24} />;
  }
}

/** Inventory tile art for pet outfits and room items. */
export function PetItemPreview({ entry }: { readonly entry: CatalogEntry }): ReactNode {
  if (entry.kind === "pet-room") return <RoomGlyph room={entry.room} size={46} />;
  if ("accessory" in entry) return <PetAccessoryIcon id={entry.accessory} size={46} />;
  return null;
}

export type AvatarPet = { readonly species: PetSpecies; readonly stage: PetStage } | null | undefined;

/** A player's avatar: their pet's headshot with its public hat, else a photo, else an initial. */
export function PlayerAvatar({ pet, equipped, name, photoUrl }: { readonly pet: AvatarPet; readonly equipped?: GameEquipped; readonly name: string; readonly photoUrl?: string }) {
  if (pet) {
    const { hat, face } = equippedAccessories(equipped);
    return <PetHeadshot species={pet.species} stage={pet.stage} accessories={{ hat, face }} decorative />;
  }
  if (photoUrl) return <img src={photoUrl} alt="" referrerPolicy="no-referrer" draggable={false} />;
  return <AvatarPlaceholder name={name} />;
}
