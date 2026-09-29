import { describe, expect, it } from "vitest";
import { applyDailyCurve, nameEffectsUnlocked, petStageFor, progressFor, rankFor, taskXp, xpToReach } from "./rules";

// These values are pinned by server/internal/gamification/gamification_test.go;
// the client must agree with the server on every one of them.
describe("gamification rules mirror", () => {
  it("matches the server level curve at its boundaries", () => {
    expect(xpToReach(1)).toBe(0);
    expect(xpToReach(2)).toBe(30);
    for (let level = 2; level <= 300; level++) {
      expect(progressFor(xpToReach(level))).toMatchObject({ level, xpInLevel: 0 });
      expect(progressFor(xpToReach(level) - 1).level).toBe(level - 1);
    }
    expect(progressFor(-5).level).toBe(1);
  });

  it("names ranks, effects and pet stages like the server", () => {
    expect([1, 9, 10, 35, 42, 99, 250].map(rankFor)).toEqual(["Spark", "Spark", "Ember", "Blaze", "Nova", "Infinity", "Infinity"]);
    expect(nameEffectsUnlocked(1)).toEqual(["plain"]);
    expect(nameEffectsUnlocked(20).at(-1)).toBe("gold");
    expect(nameEffectsUnlocked(100)).toHaveLength(9);
    expect([1, 10, 25, 50].map((level) => petStageFor(level, true))).toEqual(["baby", "young", "adult", "radiant"]);
    expect(petStageFor(80, false)).toBe("egg");
  });

  it("rewards important work and ignores farmed tasks", () => {
    const createdAt = new Date(2026, 8, 29, 9, 0);
    const completedAt = new Date(2026, 8, 29, 11, 0);
    expect(taskXp({ quadrant: "focus", createdAt, completedAt })).toBe(30);
    expect(taskXp({ quadrant: "plan", createdAt, completedAt })).toBe(25);
    expect(taskXp({ quadrant: "later", createdAt, completedAt })).toBe(5);
    expect(taskXp({ quadrant: "focus", dueDate: "2026-09-29", createdAt, completedAt })).toBe(36);
    expect(taskXp({ quadrant: "focus", dueDate: "2026-09-28", createdAt, completedAt })).toBe(30);
    expect(taskXp({ quadrant: "focus", createdAt, completedAt: new Date(createdAt.getTime() + 20_000) })).toBe(1);
  });

  it("applies the same daily curve as the server", () => {
    expect(applyDailyCurve(0, 30)).toBe(30);
    expect(applyDailyCurve(290, 30)).toBe(20);
    expect(applyDailyCurve(590, 30)).toBe(12);
    expect(applyDailyCurve(600, 10)).toBe(2);
    expect(applyDailyCurve(700, 1)).toBe(1);
    expect(applyDailyCurve(799, 30)).toBe(1);
    expect(applyDailyCurve(800, 30)).toBe(0);
    expect(applyDailyCurve(0, 0)).toBe(0);
  });
});
