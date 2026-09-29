import { describe, expect, it } from "vitest";
import {
  EMPTY_LOADOUT,
  equippedItem,
  isEquipped,
  pinnedBadgeItems,
  tabCounts,
  tabForItem,
  toggleItem,
  type InventoryItem,
  type InventoryLoadout,
} from "./inventory";

const gold: InventoryItem = { kind: "name-effect", id: "effect-gold", label: "Gold", rarity: "rare", effect: "gold" };
const silver: InventoryItem = { kind: "name-effect", id: "effect-silver", label: "Silver", rarity: "rare", effect: "silver" };
const mythic: InventoryItem = { kind: "name-effect", id: "effect-mythic", label: "Mythic", rarity: "legendary", effect: "mythic", locked: true, unlockHint: "Level 100" };
const laurel: InventoryItem = { kind: "border", id: "border-laurel", label: "Laurel", rarity: "rare", frame: "laurel" };
const hat: InventoryItem = { kind: "pet-hat", id: "hat-top", label: "Top hat", rarity: "rare" };
const badge = (id: string, locked = false): InventoryItem => ({ kind: "badge", id, label: id, rarity: "common", icon: "star", locked });

describe("toggleItem", () => {
  it("equips into the item's slot and swaps within the slot", () => {
    const withGold = toggleItem(EMPTY_LOADOUT, gold);
    expect(withGold.equipped["name-effect"]).toBe("effect-gold");
    const withSilver = toggleItem(withGold, silver);
    expect(withSilver.equipped["name-effect"]).toBe("effect-silver");
    expect(isEquipped(withSilver, gold)).toBe(false);
    expect(isEquipped(withSilver, silver)).toBe(true);
  });

  it("unequips an equipped item and leaves other slots alone", () => {
    const loadout = toggleItem(toggleItem(toggleItem(EMPTY_LOADOUT, gold), laurel), hat);
    const next = toggleItem(loadout, gold);
    expect(next.equipped["name-effect"]).toBeUndefined();
    expect(next.equipped.border).toBe("border-laurel");
    expect(next.equipped["pet-hat"]).toBe("hat-top");
  });

  it("ignores locked items and never mutates the input", () => {
    const loadout: InventoryLoadout = { equipped: { "name-effect": "effect-gold" }, pinnedBadges: [] };
    expect(toggleItem(loadout, mythic)).toBe(loadout);
    expect(toggleItem(loadout, badge("secret", true))).toBe(loadout);
    toggleItem(loadout, silver);
    expect(loadout.equipped["name-effect"]).toBe("effect-gold");
  });

  it("pins up to three badges, replacing the oldest pin", () => {
    let loadout = EMPTY_LOADOUT;
    for (const id of ["a", "b", "c"]) loadout = toggleItem(loadout, badge(id));
    expect(loadout.pinnedBadges).toEqual(["a", "b", "c"]);
    loadout = toggleItem(loadout, badge("d"));
    expect(loadout.pinnedBadges).toEqual(["b", "c", "d"]);
    loadout = toggleItem(loadout, badge("c"));
    expect(loadout.pinnedBadges).toEqual(["b", "d"]);
    expect(toggleItem(loadout, badge("e"), 1).pinnedBadges).toEqual(["e"]);
  });
});

describe("inventory lookups", () => {
  const items: InventoryItem[] = [gold, silver, mythic, laurel, hat, badge("a"), badge("b"), badge("locked", true)];

  it("groups pet slots under the Pet tab", () => {
    expect(tabForItem(hat)).toBe("pet");
    expect(tabForItem(laurel)).toBe("border");
    expect(tabForItem(badge("a"))).toBe("badge");
  });

  it("resolves equipped items and pinned badges in pin order", () => {
    const loadout: InventoryLoadout = { equipped: { "name-effect": "effect-silver", border: "gone" }, pinnedBadges: ["b", "missing", "a"] };
    expect(equippedItem(items, loadout, "name-effect")?.effect).toBe("silver");
    expect(equippedItem(items, loadout, "border")).toBeUndefined();
    expect(pinnedBadgeItems(items, loadout).map((item) => item.id)).toEqual(["b", "a"]);
  });

  it("counts owned versus total per tab", () => {
    expect(tabCounts(items, "name-effect")).toEqual({ owned: 2, total: 3 });
    expect(tabCounts(items, "badge")).toEqual({ owned: 2, total: 3 });
    expect(tabCounts(items, "confetti")).toEqual({ owned: 0, total: 0 });
  });
});
