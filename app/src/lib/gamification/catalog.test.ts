import { describe, expect, it } from "vitest";
import achievementsGo from "../../../../server/internal/gamification/achievements.go?raw";
import catalogGo from "../../../../server/internal/gamification/catalog.go?raw";
import { ACHIEVEMENT_ICONS, CATALOG, CHEST_ITEMS, catalogEntry, equippedAccessories, equippedConfetti, equippedFrame } from "./catalog";

// The client must draw everything the server can grant: read the Go sources.

describe("cosmetic catalog", () => {
  it("matches the server's chest catalog item for item", () => {
    const serverItems = [...catalogGo.matchAll(/\{ID: "([^"]+)", Kind: (\w+), Rarity: (\w+)\}/g)].map(([, id, , rarity]) => ({ id, rarity: rarity.toLowerCase() }));
    expect(serverItems.map((item) => item.id)).toEqual(CHEST_ITEMS);
    for (const item of serverItems) expect(catalogEntry(item.id)?.rarity, item.id).toBe(item.rarity);
  });

  it("draws every starter item and achievement reward", () => {
    const starters = /StarterItems = \[\]string\{([^}]*)\}/.exec(catalogGo)?.[1].match(/"([^"]+)"/g)?.map((raw) => raw.slice(1, -1)) ?? [];
    const rewards = [...achievementsGo.matchAll(/"((?:border|title)-[a-z-]+)"/g)].map(([, id]) => id);
    expect(starters.length).toBeGreaterThan(0);
    expect(rewards.length).toBeGreaterThan(10);
    for (const id of [...starters, ...rewards]) expect(CATALOG.has(id), id).toBe(true);
  });

  it("has an icon for every achievement", () => {
    const ids = [...achievementsGo.matchAll(/(?:counter|oneOff)\("([a-z0-9-]+)"/g)].map(([, id]) => id);
    expect(ids.length).toBeGreaterThanOrEqual(30);
    expect(Object.keys(ACHIEVEMENT_ICONS).sort()).toEqual([...ids].sort());
  });

  it("turns equipped slots into art, with safe defaults", () => {
    expect(equippedFrame({ border: "border-laurel" })).toBe("laurel");
    expect(equippedFrame({ border: "hat-party" })).toBe("common");
    expect(equippedFrame(undefined)).toBe("common");
    expect(equippedConfetti({ confetti: "confetti-sakura" })).toBe("sakura");
    expect(equippedConfetti({})).toBe("classic");
    expect(equippedAccessories({ petHat: "hat-crown", petFace: "face-shades", petNeck: "nope" })).toEqual({ hat: "crown", face: "heart-shades", neck: undefined });
  });
});
