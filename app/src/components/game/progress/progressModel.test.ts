import { describe, expect, it } from "vitest";
import { CRAFT_COST } from "../../../lib/gamification/catalog";
import type { GameAchievement, GameProfile } from "../../../lib/gamification/state";
import type { InventoryItem } from "../identity/inventory";
import { boardFixture, newcomerState, veteranState } from "./fixtures";
import {
  achievementGroups,
  achievementProgress,
  boardEntries,
  chestRewards,
  chestSource,
  craftOptions,
  displayName,
  equippedFrameId,
  equippedNameEffect,
  equippedTitle,
  inventoryAction,
  inventoryItems,
  isHiddenSecret,
  loadoutFor,
  nextEvolutionLevel,
  petMoodFor,
  pinnedBadges,
  suggestedTeamGoal,
  teamGoal,
  togglePin,
  weekEnd,
  type Translate,
} from "./progressModel";

/**
 * Echoes keys with their variables so assertions stay language-free. Animals
 * translate to their bare key, like a real dictionary would.
 */
const t: Translate = (key, vars) => {
  if (key.startsWith("game.animals.")) return key.slice("game.animals.".length);
  return vars ? `${key}(${Object.entries(vars).map(([name, value]) => `${name}=${value}`).join(",")})` : key;
};

describe("identity", () => {
  it("names players by handle, else by their anonymous animal", () => {
    expect(displayName({ handle: "mira", anonymousKey: "otter" }, t)).toBe("mira");
    expect(displayName({ handle: null, anonymous: "heron" }, t)).toBe("game.anonymousName(animal=heron)");
    expect(displayName({ handle: null, anonymousKey: "fox" }, t)).toBe("game.anonymousName(animal=fox)");
    // An animal missing from the dictionary falls back to the otter.
    expect(displayName({ handle: null, anonymous: "dodo" }, (key, vars) => (key.startsWith("game.animals.otter") ? "Otter" : vars ? `${key}:${vars.animal}` : key))).toBe("game.anonymousName:Otter");
  });

  it("reads equipped cosmetics defensively", () => {
    expect(equippedNameEffect({ nameEffect: "gold" })).toBe("gold");
    expect(equippedNameEffect({ nameEffect: "sparkly" })).toBe("plain");
    expect(equippedFrameId({ border: "border-laurel" })).toBe("laurel");
    expect(equippedFrameId({})).toBe("none");
    expect(equippedFrameId({ border: "hat-party" })).toBe("none");
    expect(equippedTitle({ title: "title-planner" }, t)).toEqual({ text: "game.items.title-planner", rarity: "rare" });
    expect(equippedTitle({ title: "border-flame" }, t)).toBeUndefined();
  });

  it("keeps pinned badges in pin order and drops unknown ids", () => {
    const { profile, achievements } = veteranState();
    const badges = pinnedBadges([...profile.pinnedAchievements, "missing"], achievements, t);
    expect(badges.map((badge) => badge.id)).toEqual(["the-planner", "unbreakable", "centurion"]);
    expect(badges[1]).toMatchObject({ rarity: "epic", icon: "anchor", label: "game.achievements.unbreakable.name" });
  });
});

describe("pet mood", () => {
  const profile = (lastDay?: string): Pick<GameProfile, "streak" | "timeZone"> => ({ streak: { current: 3, best: 3, freezes: 0, lastDay }, timeZone: "Europe/Paris" });

  it("is asleep at local night, whatever happened", () => {
    expect(petMoodFor(profile("2026-09-30"), new Date("2026-09-30T22:30:00Z"))).toBe("asleep");
    expect(petMoodFor(profile("2026-09-30"), new Date("2026-10-01T03:00:00Z"))).toBe("asleep");
  });

  it("is happy after a completion today, content after yesterday, sleepy otherwise", () => {
    const noon = new Date("2026-09-30T10:00:00Z");
    expect(petMoodFor(profile("2026-09-30"), noon)).toBe("happy");
    expect(petMoodFor(profile("2026-09-29"), noon)).toBe("content");
    expect(petMoodFor(profile("2026-09-20"), noon)).toBe("sleepy");
    expect(petMoodFor(profile(undefined), noon)).toBe("sleepy");
  });

  it("uses the profile's time zone for the day boundary", () => {
    // 00:30 UTC is 09:30 in Tokyo; an unknown zone falls back to the device.
    expect(petMoodFor({ streak: { current: 1, best: 1, freezes: 0, lastDay: "2026-09-30" }, timeZone: "Asia/Tokyo" }, new Date("2026-09-30T00:30:00Z"))).toBe("happy");
    expect(petMoodFor({ streak: { current: 1, best: 1, freezes: 0, lastDay: "2026-09-30" }, timeZone: "Not/AZone" }, new Date("2026-09-30T12:00:00"))).toBe("happy");
  });

  it("knows the next evolution", () => {
    expect(nextEvolutionLevel(3)).toBe(10);
    expect(nextEvolutionLevel(27)).toBe(50);
    expect(nextEvolutionLevel(50)).toBeUndefined();
  });
});

describe("inventory", () => {
  const state = veteranState();
  const items = inventoryItems(state, t);
  const loadout = loadoutFor(state.profile);
  const item = (id: string) => items.find((entry) => entry.id === id) as InventoryItem;

  it("maps the server's equip slots onto inventory kinds", () => {
    expect(loadout.equipped).toMatchObject({ "name-effect": "effect:gold", border: "border-laurel", title: "title-planner", "pet-hat": "hat-flower", "pet-room": "room-lamp", confetti: "confetti-gold" });
    expect(loadout.pinnedBadges).toEqual(["the-planner", "unbreakable", "centurion"]);
    expect(loadoutFor({ equipped: {}, pinnedAchievements: [] }).equipped["name-effect"]).toBe("effect:plain");
  });

  it("lists every cosmetic, locking what is not owned with where it comes from", () => {
    expect(item("effect:gold").locked).toBe(false);
    expect(item("effect:emerald")).toMatchObject({ locked: true, unlockHint: "game.xp.level(level=30)" });
    expect(item("border-laurel").locked).toBe(false);
    expect(item("border-frost")).toMatchObject({ locked: true, unlockHint: "game.achievements.centennial.name" });
    // The prism border comes from a secret achievement: its name stays hidden.
    expect(item("border-prism")).toMatchObject({ locked: true, unlockHint: "game.secretAchievement" });
    expect(item("hat-crown")).toMatchObject({ locked: true, unlockHint: "progress.inventory.fromChests" });
    expect(item("confetti-gold")).toMatchObject({ kind: "confetti", locked: false });
  });

  it("turns achievements into badges, secret ones anonymous until earned", () => {
    expect(item("veteran")).toMatchObject({ kind: "badge", locked: true, unlockHint: "312/500", progress: 312 / 500 });
    expect(item("clean-slate")).toMatchObject({ kind: "badge", locked: true, label: "game.secretAchievement", icon: "sparkles", rarity: "common" });
    expect(item("early-bird")).toMatchObject({ kind: "badge", locked: false, label: "game.achievements.early-bird.name" });
  });

  it("equips, unequips and pins through the right slot", () => {
    expect(inventoryAction(loadout, item("effect:silver"))).toEqual({ type: "equip", slot: "nameEffect", itemId: "silver" });
    expect(inventoryAction(loadout, item("effect:gold"))).toEqual({ type: "equip", slot: "nameEffect", itemId: "" });
    expect(inventoryAction(loadout, item("effect:plain"))).toEqual({ type: "equip", slot: "nameEffect", itemId: "" });
    expect(inventoryAction(loadoutFor({ equipped: {}, pinnedAchievements: [] }), item("effect:plain"))).toBeNull();
    expect(inventoryAction(loadout, item("border-flame"))).toEqual({ type: "equip", slot: "border", itemId: "border-flame" });
    expect(inventoryAction(loadout, item("border-laurel"))).toEqual({ type: "equip", slot: "border", itemId: "" });
    expect(inventoryAction(loadout, item("neck-scarf"))).toEqual({ type: "equip", slot: "petNeck", itemId: "neck-scarf" });
    expect(inventoryAction(loadout, item("room-plant"))).toEqual({ type: "equip", slot: "petRoom", itemId: "room-plant" });
    expect(inventoryAction(loadout, item("hat-crown"))).toBeNull();
    // A fourth pin replaces the oldest; pinning again unpins.
    expect(inventoryAction(loadout, item("first-step"))).toEqual({ type: "pin", ids: ["unbreakable", "centurion", "first-step"] });
    expect(inventoryAction(loadout, item("unbreakable"))).toEqual({ type: "pin", ids: ["the-planner", "centurion"] });
  });

  it("toggles pins with the same rule", () => {
    expect(togglePin(["a", "b"], "c")).toEqual(["a", "b", "c"]);
    expect(togglePin(["a", "b", "c"], "d")).toEqual(["b", "c", "d"]);
    expect(togglePin(["a", "b", "c"], "b")).toEqual(["a", "c"]);
  });

  it("offers unowned chest items for crafting, cheapest first", () => {
    const options = craftOptions(state);
    expect(options.some((option) => option.id === "hat-party")).toBe(false);
    expect(options.some((option) => option.id === "border-prism")).toBe(false);
    expect(options[0].entry.rarity).toBe("common");
    const crown = options.find((option) => option.id === "hat-crown");
    expect(crown).toMatchObject({ cost: CRAFT_COST.legendary, affordable: false });
    expect(options.find((option) => option.id === "hat-beanie")).toMatchObject({ cost: 20, affordable: true });
  });
});

describe("achievements", () => {
  const { achievements } = veteranState();

  it("groups by category in server order with unlocked counts", () => {
    const groups = achievementGroups(achievements);
    expect(groups.map((group) => group.category)).toEqual(["start", "focus", "planning", "consistency", "habits", "growth", "team", "leagues", "secret"]);
    expect(groups[0]).toMatchObject({ unlocked: 3 });
    expect(groups[0].items).toHaveLength(5);
  });

  it("hides secrets only while locked and measures counter progress", () => {
    const find = (id: string) => achievements.find((achievement) => achievement.id === id) as GameAchievement;
    expect(isHiddenSecret(find("clean-slate"))).toBe(true);
    expect(isHiddenSecret(find("early-bird"))).toBe(false);
    expect(isHiddenSecret(find("veteran"))).toBe(false);
    expect(achievementProgress(find("veteran"))).toBeCloseTo(0.624);
    expect(achievementProgress(find("first-step"))).toBe(1);
    expect(achievementProgress(find("clean-slate"))).toBeUndefined();
  });
});

describe("chests", () => {
  it("describes where a chest came from", () => {
    expect(chestSource({ id: "c", tier: "rare", source: "level", sourceRef: "25", grantedAt: "" }, t)).toBe("progress.chests.fromLevel(level=25)");
    expect(chestSource({ id: "c", tier: "epic", source: "streak", sourceRef: "30", grantedAt: "" }, t)).toBe("progress.chests.fromStreak(days=30)");
    expect(chestSource({ id: "c", tier: "epic", source: "achievement", sourceRef: "unbreakable", grantedAt: "" }, t)).toBe("progress.chests.fromAchievement(name=game.achievements.unbreakable.name)");
  });

  it("turns drops into rewards, including duplicates and freezes", () => {
    const rewards = chestRewards(
      [
        { itemId: "hat-crown", kind: "pet-hat", rarity: "legendary" },
        { itemId: "confetti-gold", rarity: "rare", duplicate: true, stardust: 20 },
        { rarity: "rare", freeze: true },
        { rarity: "rare", stardust: 20 },
      ],
      t,
    );
    expect(rewards[0]).toMatchObject({ itemId: "hat-crown", kind: "pet-hat", label: "game.items.hat-crown", kindLabel: "progress.kinds.pet-hat", rarity: "legendary", duplicate: false });
    expect(rewards[1]).toMatchObject({ kind: "confetti", duplicate: true, stardust: 20 });
    expect(rewards[2]).toMatchObject({ kind: "freeze", label: "game.chest.freeze", duplicate: false });
    // A freeze that did not fit arrives as stardust.
    expect(rewards[3]).toMatchObject({ kind: "freeze", duplicate: true, stardust: 20 });
    expect(new Set(rewards.map((reward) => reward.id)).size).toBe(4);
  });
});

describe("boards", () => {
  it("adds the viewer below the board with a gap when they sit far outside it", () => {
    const level = boardEntries(boardFixture("level"));
    expect(level.me?.position).toBe(14);
    expect(level.gap).toBe(true);
    const streak = boardEntries(boardFixture("streak"));
    expect(streak.me).toBeNull();
    expect(boardEntries({ board: "level", players: boardFixture("level").players, me: { ...boardFixture("level").me!, position: 9 } }).gap).toBe(false);
  });

  it("suggests a team goal when the owner has not set one", () => {
    expect(suggestedTeamGoal(1)).toBe(500);
    expect(suggestedTeamGoal(4)).toBe(1600);
    expect(teamGoal({ teamGoalXp: 0, members: [] })).toBe(500);
    expect(teamGoal({ teamGoalXp: 1200, members: [] })).toBe(1200);
    expect(weekEnd("2026-09-28T00:00:00Z")).toBe(Date.UTC(2026, 9, 5));
  });
});

describe("fixtures", () => {
  it("newcomers have an egg and nothing unlocked", () => {
    const state = newcomerState();
    expect(state.profile.pet?.species).toBeNull();
    expect(state.achievements.every((achievement) => !achievement.unlockedAt)).toBe(true);
  });
});
