import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_ENABLED_VIEWS, isTourDone, isViewShown, markTourDone, readHiddenViews, writeEnabledViews, writeHiddenViews } from "./navigation";

describe("navigation preferences", () => {
  beforeEach(() => localStorage.clear());

  it("shows everything until the person chooses", () => {
    expect(readHiddenViews()).toEqual([]);
    expect(isViewShown("habits", [])).toBe(true);
  });

  it("hides the optional spaces that were not picked, never the core ones", () => {
    writeEnabledViews(DEFAULT_ENABLED_VIEWS);
    const hidden = readHiddenViews();
    expect(hidden).toEqual(["inbox", "waiting", "mine"]);
    expect(isViewShown("inbox", hidden)).toBe(false);
    expect(isViewShown("calendar", hidden)).toBe(true);
    expect(isViewShown("today", hidden)).toBe(true);
    expect(isViewShown("all", hidden)).toBe(true);
  });

  it("ignores unknown values and remembers the tour", () => {
    localStorage.setItem("prior.nav.hidden", JSON.stringify(["today", "notes", 3]));
    expect(readHiddenViews()).toEqual(["notes"]);
    writeHiddenViews(["focus"]);
    expect(readHiddenViews()).toEqual(["focus"]);
    expect(isTourDone()).toBe(false);
    markTourDone();
    expect(isTourDone()).toBe(true);
  });
});
