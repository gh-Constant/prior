// Every cosmetic the server can grant (server/internal/gamification/catalog.go
// and the achievement rewards), mapped to the art that draws it. Labels live
// in the "game" i18n namespace under items.<id>.
import type { IconName } from "../../components/Icon";
import type { GameEquipped } from "./state";
import type { Rarity } from "./types";

export type FrameArt = "common" | "rare" | "epic" | "legendary" | "flame" | "laurel" | "frost" | "prism";
export type AccessoryArt = "party-hat" | "beanie" | "crown" | "flower" | "round-glasses" | "heart-shades" | "scarf" | "bow-tie" | "bell-collar";
export type RoomArt = "rug" | "plant" | "lamp" | "shelf" | "frame" | "lights" | "cushion";
export type ConfettiArt = "classic" | "gold" | "pastel" | "neon" | "sakura" | "ocean";

export type CatalogEntry =
  | { readonly id: string; readonly kind: "border"; readonly rarity: Rarity; readonly frame: FrameArt }
  | { readonly id: string; readonly kind: "title"; readonly rarity: Rarity }
  | { readonly id: string; readonly kind: "pet-hat" | "pet-face" | "pet-neck"; readonly rarity: Rarity; readonly accessory: AccessoryArt }
  | { readonly id: string; readonly kind: "pet-room"; readonly rarity: Rarity; readonly room: RoomArt }
  | { readonly id: string; readonly kind: "confetti"; readonly rarity: Rarity; readonly theme: ConfettiArt };

const ENTRIES: readonly CatalogEntry[] = [
  // Borders: the starter ring, then achievement rewards only.
  { id: "border-common-ring", kind: "border", rarity: "common", frame: "common" },
  { id: "border-rare-double", kind: "border", rarity: "rare", frame: "rare" },
  { id: "border-flame", kind: "border", rarity: "rare", frame: "flame" },
  { id: "border-laurel", kind: "border", rarity: "rare", frame: "laurel" },
  { id: "border-epic-gems", kind: "border", rarity: "epic", frame: "epic" },
  { id: "border-legendary-orbit", kind: "border", rarity: "legendary", frame: "legendary" },
  { id: "border-frost", kind: "border", rarity: "legendary", frame: "frost" },
  { id: "border-prism", kind: "border", rarity: "legendary", frame: "prism" },
  // Titles from chests, then from achievements.
  { id: "title-dreamer", kind: "title", rarity: "common" },
  { id: "title-tinkerer", kind: "title", rarity: "rare" },
  { id: "title-starlit", kind: "title", rarity: "epic" },
  { id: "title-mythmaker", kind: "title", rarity: "legendary" },
  { id: "title-early-bird", kind: "title", rarity: "common" },
  { id: "title-night-owl", kind: "title", rarity: "common" },
  { id: "title-team-player", kind: "title", rarity: "common" },
  { id: "title-planner", kind: "title", rarity: "rare" },
  { id: "title-firefighter", kind: "title", rarity: "epic" },
  { id: "title-architect", kind: "title", rarity: "epic" },
  { id: "title-clockwork", kind: "title", rarity: "epic" },
  { id: "title-unbreakable", kind: "title", rarity: "epic" },
  { id: "title-creature-of-habit", kind: "title", rarity: "epic" },
  { id: "title-legend", kind: "title", rarity: "legendary" },
  { id: "title-eternal-flame", kind: "title", rarity: "legendary" },
  { id: "title-centurion", kind: "title", rarity: "legendary" },
  // Pet outfits and room.
  { id: "hat-party", kind: "pet-hat", rarity: "common", accessory: "party-hat" },
  { id: "hat-beanie", kind: "pet-hat", rarity: "common", accessory: "beanie" },
  { id: "hat-flower", kind: "pet-hat", rarity: "rare", accessory: "flower" },
  { id: "hat-crown", kind: "pet-hat", rarity: "legendary", accessory: "crown" },
  { id: "face-glasses", kind: "pet-face", rarity: "common", accessory: "round-glasses" },
  { id: "face-shades", kind: "pet-face", rarity: "epic", accessory: "heart-shades" },
  { id: "neck-scarf", kind: "pet-neck", rarity: "common", accessory: "scarf" },
  { id: "neck-bowtie", kind: "pet-neck", rarity: "common", accessory: "bow-tie" },
  { id: "neck-bell", kind: "pet-neck", rarity: "rare", accessory: "bell-collar" },
  { id: "room-rug", kind: "pet-room", rarity: "common", room: "rug" },
  { id: "room-plant", kind: "pet-room", rarity: "common", room: "plant" },
  { id: "room-cushion", kind: "pet-room", rarity: "common", room: "cushion" },
  { id: "room-lamp", kind: "pet-room", rarity: "rare", room: "lamp" },
  { id: "room-shelf", kind: "pet-room", rarity: "rare", room: "shelf" },
  { id: "room-frame", kind: "pet-room", rarity: "epic", room: "frame" },
  { id: "room-lights", kind: "pet-room", rarity: "epic", room: "lights" },
  // Confetti.
  { id: "confetti-classic", kind: "confetti", rarity: "common", theme: "classic" },
  { id: "confetti-pastel", kind: "confetti", rarity: "common", theme: "pastel" },
  { id: "confetti-ocean", kind: "confetti", rarity: "common", theme: "ocean" },
  { id: "confetti-gold", kind: "confetti", rarity: "rare", theme: "gold" },
  { id: "confetti-neon", kind: "confetti", rarity: "rare", theme: "neon" },
  { id: "confetti-sakura", kind: "confetti", rarity: "epic", theme: "sakura" },
];

export const CATALOG: ReadonlyMap<string, CatalogEntry> = new Map(ENTRIES.map((entry) => [entry.id, entry]));

export function catalogEntry(id: string | undefined | null): CatalogEntry | undefined {
  return id ? CATALOG.get(id) : undefined;
}

/** What chests drop and crafting makes: the server's Catalog, in order. */
export const CHEST_ITEMS: readonly string[] = [
  "hat-party", "hat-beanie", "hat-flower", "hat-crown", "face-glasses", "face-shades", "neck-scarf", "neck-bowtie", "neck-bell",
  "room-rug", "room-plant", "room-cushion", "room-lamp", "room-shelf", "room-frame", "room-lights",
  "confetti-pastel", "confetti-ocean", "confetti-gold", "confetti-neon", "confetti-sakura",
  "title-dreamer", "title-tinkerer", "title-starlit", "title-mythmaker",
];

/** Stardust to craft one item: four duplicates of its rarity (server CraftCost). */
export const CRAFT_COST: Readonly<Record<Rarity, number>> = { common: 20, rare: 80, epic: 240, legendary: 800 };

export function equippedFrame(equipped: GameEquipped | undefined): FrameArt {
  const entry = catalogEntry(equipped?.border);
  return entry?.kind === "border" ? entry.frame : "common";
}

export function equippedConfetti(equipped: GameEquipped | undefined): ConfettiArt {
  const entry = catalogEntry(equipped?.confetti);
  return entry?.kind === "confetti" ? entry.theme : "classic";
}

export function equippedRoom(equipped: GameEquipped | undefined): RoomArt[] {
  const entry = catalogEntry(equipped?.petRoom);
  return entry?.kind === "pet-room" ? [entry.room] : [];
}

/** The pet's outfit from equipped slots. */
export function equippedAccessories(equipped: GameEquipped | undefined): { hat?: AccessoryArt; face?: AccessoryArt; neck?: AccessoryArt } {
  const art = (id: string | undefined) => {
    const entry = catalogEntry(id);
    return entry && "accessory" in entry ? entry.accessory : undefined;
  };
  return { hat: art(equipped?.petHat), face: art(equipped?.petFace), neck: art(equipped?.petNeck) };
}

export const ACHIEVEMENT_ICONS: Readonly<Record<string, IconName>> = {
  "first-step": "check-circle",
  "warming-up": "activity",
  centurion: "award",
  veteran: "shield",
  legend: "star",
  "in-the-zone": "focus",
  firefighter: "flame",
  "clean-slate": "sparkles",
  "the-planner": "plan",
  architect: "compass",
  punctual: "clock",
  clockwork: "hourglass",
  "three-in-a-row": "zap",
  "week-warrior": "flame",
  unbreakable: "anchor",
  centennial: "trending-up",
  "eternal-flame": "sun",
  "habit-forming": "coffee",
  "second-nature": "feather",
  "creature-of-habit": "heart",
  "level-10": "bolt",
  "level-25": "rocket",
  "level-50": "target",
  "level-100": "star",
  "team-player": "user",
  cheerleader: "smile",
  "crowd-favorite": "heart",
  rising: "trending-up",
  "diamond-league": "award",
  "early-bird": "sun",
  "night-owl": "moon",
  "welcome-back": "home",
};

export function achievementIcon(id: string): IconName {
  return ACHIEVEMENT_ICONS[id] ?? "award";
}
