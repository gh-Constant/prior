import { describe, expect, it } from "vitest";
import { arcControlPoint, easeInOutCubic, quadraticPoint, sampleQuadratic } from "./bezier";
import { streakStage, streakVisual } from "./streak";
import { shade } from "./themes";
import { planXpSegments, segmentDuration, xpRatio } from "./xpBar";

describe("bezier", () => {
  it("starts and ends on the endpoints", () => {
    const from = { x: 10, y: 300 };
    const to = { x: 400, y: 20 };
    const control = arcControlPoint(from, to);
    expect(quadraticPoint(from, control, to, 0)).toEqual(from);
    expect(quadraticPoint(from, control, to, 1)).toEqual(to);
  });

  it("bulges upward whichever way the flight goes", () => {
    for (const [from, to] of [
      [{ x: 0, y: 0 }, { x: 300, y: 0 }],
      [{ x: 300, y: 0 }, { x: 0, y: 0 }],
      [{ x: 0, y: 400 }, { x: 200, y: 0 }],
      [{ x: 400, y: 400 }, { x: 0, y: 380 }],
    ] as const) {
      const control = arcControlPoint(from, to, 0.4);
      const mid = quadraticPoint(from, control, to, 0.5);
      const straightMidY = (from.y + to.y) / 2;
      expect(mid.y).toBeLessThanOrEqual(straightMidY);
    }
  });

  it("samples the requested number of eased points", () => {
    const points = sampleQuadratic({ x: 0, y: 0 }, { x: 50, y: -50 }, { x: 100, y: 0 }, 10, easeInOutCubic);
    expect(points).toHaveLength(11);
    expect(points[0]).toEqual({ x: 0, y: 0 });
    expect(points[10]).toEqual({ x: 100, y: 0 });
    // Ease-in-out: the first step is shorter than the middle one.
    const first = Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y);
    const middle = Math.hypot(points[6].x - points[5].x, points[6].y - points[5].y);
    expect(first).toBeLessThan(middle);
  });
});

describe("streak stages", () => {
  it("maps days to stages at 1, 3, 7, 30 and 100", () => {
    expect(streakStage(0)).toBe("cold");
    expect(streakStage(1)).toBe("spark");
    expect(streakStage(2)).toBe("spark");
    expect(streakStage(3)).toBe("kindled");
    expect(streakStage(6)).toBe("kindled");
    expect(streakStage(7)).toBe("blazing");
    expect(streakStage(29)).toBe("blazing");
    expect(streakStage(30)).toBe("inferno");
    expect(streakStage(99)).toBe("inferno");
    expect(streakStage(100)).toBe("mythic");
    expect(streakStage(5000)).toBe("mythic");
  });

  it("treats invalid input as no streak", () => {
    expect(streakStage(-3)).toBe("cold");
    expect(streakStage(Number.NaN)).toBe("cold");
  });

  it("grows the flame and shifts its hue with the streak", () => {
    const sizes = [0, 1, 3, 7, 30, 100].map((days) => streakVisual(days).scale);
    expect([...sizes].sort((a, b) => a - b)).toEqual(sizes);
    expect(streakVisual(10).palette.outer[1]).not.toBe(streakVisual(40).palette.outer[1]);
    expect(streakVisual(40).palette.outer[1]).not.toBe(streakVisual(150).palette.outer[1]);
  });

  it("freezes a flame without embers", () => {
    const frozen = streakVisual(40, true);
    expect(frozen.stage).toBe("inferno");
    expect(frozen.embers).toBe(0);
    expect(frozen.palette).not.toEqual(streakVisual(40).palette);
  });
});

describe("xp bar planning", () => {
  it("tweens within a level", () => {
    expect(planXpSegments({ level: 3, xpInLevel: 20, xpForLevel: 100 }, { level: 3, xpInLevel: 50, xpForLevel: 100 })).toEqual([
      { level: 3, xpForLevel: 100, fromXp: 20, toXp: 50, levelUp: false, instant: false },
    ]);
  });

  it("does nothing when nothing changed", () => {
    expect(planXpSegments({ level: 3, xpInLevel: 20, xpForLevel: 100 }, { level: 3, xpInLevel: 20, xpForLevel: 100 })).toEqual([]);
  });

  it("fills, flashes and restarts on a level-up", () => {
    const segments = planXpSegments({ level: 3, xpInLevel: 80, xpForLevel: 100 }, { level: 4, xpInLevel: 15, xpForLevel: 120 });
    expect(segments).toEqual([
      { level: 3, xpForLevel: 100, fromXp: 80, toXp: 100, levelUp: true, instant: false },
      { level: 4, xpForLevel: 120, fromXp: 0, toXp: 15, levelUp: false, instant: false },
    ]);
  });

  it("plays one flash for a multi-level jump", () => {
    const segments = planXpSegments({ level: 3, xpInLevel: 10, xpForLevel: 100 }, { level: 6, xpInLevel: 5, xpForLevel: 160 });
    expect(segments.filter((segment) => segment.levelUp)).toHaveLength(1);
    expect(segments.at(-1)?.level).toBe(6);
  });

  it("jumps back when a level is lost", () => {
    expect(planXpSegments({ level: 4, xpInLevel: 5, xpForLevel: 120 }, { level: 3, xpInLevel: 95, xpForLevel: 100 })).toEqual([
      { level: 3, xpForLevel: 100, fromXp: 95, toXp: 95, levelUp: false, instant: true },
    ]);
  });

  it("clamps ratios and durations", () => {
    expect(xpRatio(150, 100)).toBe(1);
    expect(xpRatio(-5, 100)).toBe(0);
    expect(xpRatio(5, 0)).toBe(0);
    const small = segmentDuration({ level: 1, xpForLevel: 100, fromXp: 10, toXp: 12, levelUp: false, instant: false });
    const large = segmentDuration({ level: 1, xpForLevel: 100, fromXp: 0, toXp: 100, levelUp: false, instant: false });
    expect(small).toBeLessThan(large);
    expect(large).toBeLessThanOrEqual(900);
    expect(segmentDuration({ level: 1, xpForLevel: 100, fromXp: 0, toXp: 0, levelUp: false, instant: true })).toBe(0);
  });
});

describe("shade", () => {
  it("darkens and lightens hex colors", () => {
    expect(shade("#808080", -0.5)).toBe("#404040");
    expect(shade("#808080", 1)).toBe("#ffffff");
    expect(shade("not-a-color", -0.2)).toBe("not-a-color");
  });
});
