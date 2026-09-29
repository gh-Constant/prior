import { describe, expect, it } from "vitest";
import { AVATAR_FRAMES, AVATAR_FRAME_RARITY, frameDetailForSize, laurelLeaves, polar } from "./frames";

describe("frames", () => {
  it("sheds ornaments as avatars shrink", () => {
    expect(frameDetailForSize(24)).toBe("minimal");
    expect(frameDetailForSize(29)).toBe("minimal");
    expect(frameDetailForSize(30)).toBe("reduced");
    expect(frameDetailForSize(40)).toBe("reduced");
    expect(frameDetailForSize(48)).toBe("full");
    expect(frameDetailForSize(96)).toBe("full");
  });

  it("covers every rarity with at least one frame", () => {
    const rarities = new Set(AVATAR_FRAMES.map((frame) => AVATAR_FRAME_RARITY[frame]));
    expect([...rarities].sort()).toEqual(["common", "epic", "legendary", "rare"]);
    expect(AVATAR_FRAMES).toHaveLength(8);
  });

  it("places points clockwise from 12 o'clock", () => {
    const [topX, topY] = polar(40, 0);
    const [rightX, rightY] = polar(40, 90);
    expect(topX).toBeCloseTo(50);
    expect(topY).toBeCloseTo(10);
    expect(rightX).toBeCloseTo(90);
    expect(rightY).toBeCloseTo(50);
  });

  it("keeps laurel leaves on the left half of the ring, below the crown gap", () => {
    const leaves = laurelLeaves();
    expect(leaves).toHaveLength(18);
    for (const leaf of leaves) {
      expect(leaf.x).toBeLessThan(50);
      expect(leaf.y).toBeGreaterThan(20);
      expect(Math.hypot(leaf.x - 50, leaf.y - 50)).toBeCloseTo(46.5);
    }
  });
});
