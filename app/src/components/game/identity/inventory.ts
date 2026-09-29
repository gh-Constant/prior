// Inventory model and pure loadout rules (equip, unequip, pin badges).
import type { ReactNode } from "react";
import type { CosmeticKind, NameEffectId, Rarity } from "../../../lib/gamification/types";
import type { IconName } from "../../Icon";
import type { AvatarFrameId } from "./frames";

export type InventoryTab = "name-effect" | "border" | "title" | "pet" | "confetti" | "badge";

export const INVENTORY_TABS: readonly InventoryTab[] = ["name-effect", "border", "title", "pet", "confetti", "badge"];

type ItemBase = {
  readonly id: string;
  readonly label: string;
  readonly rarity: Rarity;
  /** Locked items show their unlock condition instead of an equip action. */
  readonly locked?: boolean;
  /** e.g. "Level 20", "30-day streak". */
  readonly unlockHint?: string;
};

export type InventoryItem =
  | (ItemBase & { readonly kind: "name-effect"; readonly effect: NameEffectId })
  | (ItemBase & { readonly kind: "border"; readonly frame: AvatarFrameId })
  | (ItemBase & { readonly kind: "title"; readonly title: string })
  | (ItemBase & { readonly kind: "pet-hat" | "pet-face" | "pet-neck" | "pet-room"; readonly preview?: ReactNode })
  | (ItemBase & { readonly kind: "confetti"; readonly colors: readonly string[] })
  | (ItemBase & { readonly kind: "badge"; readonly icon: IconName; readonly progress?: number; readonly progressLabel?: string });

export type InventoryLoadout = {
  /** Equipped item id per cosmetic slot. */
  readonly equipped: Readonly<Partial<Record<CosmeticKind, string>>>;
  /** Pinned achievement ids, oldest first. */
  readonly pinnedBadges: readonly string[];
};

export const EMPTY_LOADOUT: InventoryLoadout = { equipped: {}, pinnedBadges: [] };

export const MAX_PINNED_BADGES = 3;

export function tabForItem(item: InventoryItem): InventoryTab {
  switch (item.kind) {
    case "pet-hat":
    case "pet-face":
    case "pet-neck":
    case "pet-room":
      return "pet";
    default:
      return item.kind;
  }
}

export function isEquipped(loadout: InventoryLoadout, item: InventoryItem): boolean {
  if (item.kind === "badge") return loadout.pinnedBadges.includes(item.id);
  return loadout.equipped[item.kind] === item.id;
}

/**
 * Equips an item, or unequips it when it is already equipped. Pinning a fourth
 * badge replaces the oldest pin. Locked items never change the loadout.
 */
export function toggleItem(loadout: InventoryLoadout, item: InventoryItem, maxPins = MAX_PINNED_BADGES): InventoryLoadout {
  if (item.locked) return loadout;
  if (item.kind === "badge") {
    if (loadout.pinnedBadges.includes(item.id)) {
      return { ...loadout, pinnedBadges: loadout.pinnedBadges.filter((id) => id !== item.id) };
    }
    const pinned = [...loadout.pinnedBadges, item.id];
    return { ...loadout, pinnedBadges: pinned.slice(Math.max(0, pinned.length - maxPins)) };
  }
  const equipped = { ...loadout.equipped };
  if (equipped[item.kind] === item.id) delete equipped[item.kind];
  else equipped[item.kind] = item.id;
  return { ...loadout, equipped };
}

/** The equipped item of a slot, if it is still in the inventory. */
export function equippedItem<K extends InventoryItem["kind"]>(
  items: readonly InventoryItem[],
  loadout: InventoryLoadout,
  kind: K,
): Extract<InventoryItem, { kind: K }> | undefined {
  const id = kind === "badge" ? undefined : loadout.equipped[kind as CosmeticKind];
  return items.find((item): item is Extract<InventoryItem, { kind: K }> => item.kind === kind && item.id === id);
}

/** Pinned badges in pin order, skipping ids no longer owned. */
export function pinnedBadgeItems(items: readonly InventoryItem[], loadout: InventoryLoadout): Extract<InventoryItem, { kind: "badge" }>[] {
  return loadout.pinnedBadges
    .map((id) => items.find((item): item is Extract<InventoryItem, { kind: "badge" }> => item.kind === "badge" && item.id === id))
    .filter((item): item is Extract<InventoryItem, { kind: "badge" }> => item !== undefined);
}

export function tabCounts(items: readonly InventoryItem[], tab: InventoryTab): { readonly owned: number; readonly total: number } {
  const inTab = items.filter((item) => tabForItem(item) === tab);
  return { owned: inTab.filter((item) => !item.locked).length, total: inTab.length };
}
