import { describe, expect, it } from "vitest";
import { NAME_EFFECTS, RARITY_ORDER } from "../../../lib/gamification/types";
import {
  bestNameEffect,
  formatCountdown,
  goalProgress,
  isNameEffectUnlocked,
  leagueZone,
  medalForPosition,
  nameEffectRarity,
  nextNameEffect,
  rankByXp,
  rankForLevel,
  rankIndexForLevel,
  seededRandom,
  unlockedNameEffects,
} from "./rules";

describe("name effects by level", () => {
  it("unlocks effects at their level thresholds", () => {
    expect(unlockedNameEffects(1)).toEqual(["plain"]);
    expect(unlockedNameEffects(4)).toEqual(["plain"]);
    expect(unlockedNameEffects(5)).toEqual(["plain", "copper"]);
    expect(unlockedNameEffects(20)).toEqual(["plain", "copper", "silver", "gold"]);
    expect(unlockedNameEffects(74)).toHaveLength(7);
    expect(unlockedNameEffects(100)).toEqual([...NAME_EFFECTS]);
    expect(isNameEffectUnlocked("mythic", 99)).toBe(false);
    expect(isNameEffectUnlocked("mythic", 100)).toBe(true);
  });

  it("picks the best unlocked effect and the next one to earn", () => {
    expect(bestNameEffect(1)).toBe("plain");
    expect(bestNameEffect(49)).toBe("sapphire");
    expect(bestNameEffect(250)).toBe("mythic");
    expect(nextNameEffect(1)).toEqual({ effect: "copper", level: 5 });
    expect(nextNameEffect(50)).toEqual({ effect: "aurora", level: 75 });
    expect(nextNameEffect(100)).toBeUndefined();
  });

  it("never lowers rarity as the ladder climbs", () => {
    const ranks = NAME_EFFECTS.map((effect) => RARITY_ORDER.indexOf(nameEffectRarity(effect)));
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    expect(nameEffectRarity("mythic")).toBe("legendary");
  });
});

describe("ranks", () => {
  it("changes rank every ten levels and caps at Infinity", () => {
    expect(rankForLevel(1)).toBe("Spark");
    expect(rankForLevel(9)).toBe("Spark");
    expect(rankForLevel(10)).toBe("Ember");
    expect(rankForLevel(42)).toBe("Nova");
    expect(rankForLevel(90)).toBe("Infinity");
    expect(rankForLevel(400)).toBe("Infinity");
    expect(rankIndexForLevel(Number.NaN)).toBe(0);
    expect(rankIndexForLevel(-3)).toBe(0);
  });
});

describe("league zones", () => {
  it("promotes the top 7 and demotes the bottom 5 of a 30-player cohort", () => {
    const zones = Array.from({ length: 30 }, (_, index) => leagueZone(index + 1, 30, "gold"));
    expect(zones.filter((zone) => zone === "promotion")).toHaveLength(7);
    expect(zones.filter((zone) => zone === "demotion")).toHaveLength(5);
    expect(zones[6]).toBe("promotion");
    expect(zones[7]).toBe("safe");
    expect(zones[24]).toBe("safe");
    expect(zones[25]).toBe("demotion");
  });

  it("never demotes from Pebble nor promotes from Diamond", () => {
    expect(leagueZone(30, 30, "pebble")).toBe("safe");
    expect(leagueZone(1, 30, "pebble")).toBe("promotion");
    expect(leagueZone(1, 30, "diamond")).toBe("safe");
    expect(leagueZone(30, 30, "diamond")).toBe("demotion");
  });

  it("lets promotion win when a small cohort cannot fit both zones", () => {
    const zones = Array.from({ length: 10 }, (_, index) => leagueZone(index + 1, 10, "ruby"));
    expect(zones.slice(0, 7).every((zone) => zone === "promotion")).toBe(true);
    expect(zones.slice(7)).toEqual(["demotion", "demotion", "demotion"]);
    // On Diamond nobody promotes, so the bottom five still drop.
    const diamond = Array.from({ length: 10 }, (_, index) => leagueZone(index + 1, 10, "diamond"));
    expect(diamond.filter((zone) => zone === "demotion")).toHaveLength(5);
  });

  it("honors custom rules", () => {
    expect(leagueZone(3, 20, "silver", { promote: 3, demote: 2 })).toBe("promotion");
    expect(leagueZone(4, 20, "silver", { promote: 3, demote: 2 })).toBe("safe");
    expect(leagueZone(19, 20, "silver", { promote: 3, demote: 2 })).toBe("demotion");
  });
});

describe("rankByXp", () => {
  it("sorts by XP descending, keeps server order on ties and numbers positions", () => {
    const ranked = rankByXp([
      { id: "a", xp: 10 },
      { id: "b", xp: 30 },
      { id: "c", xp: 10 },
      { id: "d", xp: 50 },
    ]);
    expect(ranked.map((player) => player.id)).toEqual(["d", "b", "a", "c"]);
    expect(ranked.map((player) => player.position)).toEqual([1, 2, 3, 4]);
  });
});

describe("medals and countdowns", () => {
  it("gives medals to the podium only", () => {
    expect([1, 2, 3, 4].map(medalForPosition)).toEqual(["gold", "silver", "bronze", undefined]);
  });

  it("formats the time left in the week", () => {
    const minute = 60_000;
    expect(formatCountdown(((2 * 24 + 14) * 60 + 7) * minute)).toBe("2d 14h");
    expect(formatCountdown((5 * 60 + 3) * minute)).toBe("5h 3m");
    expect(formatCountdown(12 * minute)).toBe("12m");
    expect(formatCountdown(20_000)).toBe("1m");
    expect(formatCountdown(-5)).toBe("0m");
    expect(formatCountdown(26 * 60 * minute, { d: " j", h: " h", m: " min" })).toBe("1 j 2 h");
  });

  it("clamps goal progress", () => {
    expect(goalProgress(500, 2000)).toBe(0.25);
    expect(goalProgress(2500, 2000)).toBe(1);
    expect(goalProgress(-1, 2000)).toBe(0);
    expect(goalProgress(10, 0)).toBe(0);
  });
});

describe("seededRandom", () => {
  it("is deterministic per seed and stays in [0, 1)", () => {
    const first = seededRandom("gold:constant");
    const second = seededRandom("gold:constant");
    const other = seededRandom("gold:mira");
    const a = Array.from({ length: 20 }, first);
    const b = Array.from({ length: 20 }, second);
    const c = Array.from({ length: 20 }, other);
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
    expect(a.every((value) => value >= 0 && value < 1)).toBe(true);
  });
});
