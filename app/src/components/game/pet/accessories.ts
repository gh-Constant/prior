// Accessory catalogue (pure data). Art lives in AccessoryArt.tsx.
import type { PetAccessorySlot } from "../../../lib/gamification/types";

export type PetAccessoryId =
  | "party-hat"
  | "beanie"
  | "crown"
  | "flower"
  | "round-glasses"
  | "heart-shades"
  | "scarf"
  | "bow-tie"
  | "bell-collar";

/** Equipped accessory per slot. Missing or null means nothing is worn. */
export type PetAccessories = Partial<Record<PetAccessorySlot, PetAccessoryId | null>>;

export const PET_ACCESSORY_SLOTS: readonly PetAccessorySlot[] = ["hat", "face", "neck"];

export const PET_ACCESSORY_SLOT: Readonly<Record<PetAccessoryId, PetAccessorySlot>> = {
  "party-hat": "hat",
  beanie: "hat",
  crown: "hat",
  flower: "hat",
  "round-glasses": "face",
  "heart-shades": "face",
  scarf: "neck",
  "bow-tie": "neck",
  "bell-collar": "neck",
};

export const PET_ACCESSORY_IDS = Object.keys(PET_ACCESSORY_SLOT) as PetAccessoryId[];

export function accessoriesForSlot(slot: PetAccessorySlot): PetAccessoryId[] {
  return PET_ACCESSORY_IDS.filter((id) => PET_ACCESSORY_SLOT[id] === slot);
}

/** Drops anything equipped in the wrong slot so bad data never renders a scarf on a head. */
export function sanitizeAccessories(accessories: PetAccessories | undefined): PetAccessories {
  const result: PetAccessories = {};
  if (!accessories) return result;
  for (const slot of PET_ACCESSORY_SLOTS) {
    const id = accessories[slot];
    if (id && PET_ACCESSORY_SLOT[id] === slot) result[slot] = id;
  }
  return result;
}

/** Hats that fully cover the top of the head (Fern's sprout tucks under them). */
export function hatCoversCrown(id: PetAccessoryId | null | undefined): boolean {
  return id === "party-hat" || id === "beanie" || id === "crown";
}

/** How far each hat rises above its anchor at scale 1 (for framing headshots). */
export const HAT_HEIGHT: Readonly<Partial<Record<PetAccessoryId, number>>> = {
  "party-hat": 28.5,
  beanie: 27,
  crown: 16.5,
  flower: 9,
};
