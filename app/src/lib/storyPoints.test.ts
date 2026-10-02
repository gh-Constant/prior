import { describe, expect, it } from "vitest";
import { createTranslator } from "./i18n/translate";
import { MAX_STORY_POINTS, formatStoryPoints, formatStoryPointsValue, normalizeStoryPoints, totalStoryPoints } from "./storyPoints";

describe("normalizeStoryPoints", () => {
  it("keeps valid multiples of one half", () => {
    expect(normalizeStoryPoints(0)).toBe(0);
    expect(normalizeStoryPoints(0.5)).toBe(0.5);
    expect(normalizeStoryPoints(5)).toBe(5);
    expect(normalizeStoryPoints(13)).toBe(13);
    expect(normalizeStoryPoints(MAX_STORY_POINTS)).toBe(999);
  });

  it("rounds to the nearest half", () => {
    expect(normalizeStoryPoints(2.3)).toBe(2.5);
    expect(normalizeStoryPoints(2.2)).toBe(2);
    expect(normalizeStoryPoints(0.2)).toBe(0);
    expect(normalizeStoryPoints(-0.2)).toBe(0);
    expect(Object.is(normalizeStoryPoints(-0.2), -0)).toBe(false);
  });

  it("turns anything invalid into null", () => {
    for (const value of [undefined, null, "", "  ", "abc", NaN, Infinity, -Infinity, -1, 1000, 999.9, true, {}, []]) {
      expect(normalizeStoryPoints(value)).toBeNull();
    }
  });

  it("parses numeric strings (SQLite, CSV)", () => {
    expect(normalizeStoryPoints("8")).toBe(8);
    expect(normalizeStoryPoints(" 3.5 ")).toBe(3.5);
    expect(normalizeStoryPoints("0,5")).toBe(0.5);
  });
});

describe("formatStoryPoints", () => {
  it("formats in English without a translator", () => {
    expect(formatStoryPoints(5)).toBe("5 pts");
    expect(formatStoryPoints(1)).toBe("1 pt");
    expect(formatStoryPoints(0)).toBe("0 pts");
    expect(formatStoryPoints(0.5)).toBe("½ pt");
    expect(formatStoryPoints(2.5)).toBe("2.5 pts");
    expect(formatStoryPoints(null)).toBe("–");
    expect(formatStoryPoints(undefined)).toBe("–");
  });

  it("uses the scrum namespace when it has the keys and falls back when it does not", () => {
    const empty = createTranslator("fr", {}, {});
    expect(formatStoryPoints(5, empty)).toBe("5 pts");
    expect(formatStoryPoints(0.5, empty)).toBe("½ pt");
    const dict = { scrum: { points: "{count} point", points_plural: "{count} points", halfPoint: "½ point" } };
    const fr = createTranslator("fr", dict, dict);
    expect(formatStoryPoints(5, fr)).toBe("5 points");
    expect(formatStoryPoints(1, fr)).toBe("1 point");
    expect(formatStoryPoints(0.5, fr)).toBe("½ point");
    expect(formatStoryPoints(2.5, fr)).toBe("2.5 points");
  });

  it("shows one half as a fraction on card faces", () => {
    expect(formatStoryPointsValue(0.5)).toBe("½");
    expect(formatStoryPointsValue(8)).toBe("8");
  });
});

describe("totalStoryPoints", () => {
  it("adds estimated tasks and ignores the rest", () => {
    expect(totalStoryPoints([{ storyPoints: 3 }, { storyPoints: 0.5 }, { storyPoints: null }, {}])).toBe(3.5);
    expect(totalStoryPoints([])).toBe(0);
  });
});
