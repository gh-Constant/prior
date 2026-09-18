import { describe, expect, it } from "vitest";
import { calculateFloatingStyle } from "./useFloatingMenu";

describe("calculateFloatingStyle", () => {
  it("opens downward when there is ample space below", () => {
    const trigger = document.createElement("button");
    trigger.getBoundingClientRect = () => ({
      top: 100,
      bottom: 132,
      left: 100,
      right: 200,
      width: 100,
      height: 32,
      x: 100,
      y: 100,
      toJSON: () => {},
    });

    // Default window height is 768
    const { style, placement } = calculateFloatingStyle(trigger, null, {
      isPill: false,
      offset: 4,
    });

    expect(placement).toBe("bottom");
    expect(style.top).toBe("136px");
    expect(style.bottom).toBe("auto");
    expect(style.left).toBe("100px");
    expect(style.position).toBe("fixed");
    expect(style.zIndex).toBe(99999);
  });

  it("auto-flips upward when space below is constrained and space above is larger", () => {
    const trigger = document.createElement("button");
    trigger.getBoundingClientRect = () => ({
      top: 650,
      bottom: 682,
      left: 100,
      right: 200,
      width: 100,
      height: 32,
      x: 100,
      y: 650,
      toJSON: () => {},
    });

    // On 768px height, space below 682 is only 78px (less than menuHeight 200px)
    const { style, placement } = calculateFloatingStyle(trigger, null, {
      isPill: false,
      offset: 4,
    });

    expect(placement).toBe("top");
    expect(style.top).toBe("auto");
    expect(style.bottom).toBe(`${768 - 650 + 4}px`);
  });

  it("clamps left position so it never overflows the viewport right edge", () => {
    const trigger = document.createElement("button");
    // Window width is 1024
    trigger.getBoundingClientRect = () => ({
      top: 100,
      bottom: 132,
      left: 950,
      right: 1010,
      width: 60,
      height: 32,
      x: 950,
      y: 100,
      toJSON: () => {},
    });

    const { style } = calculateFloatingStyle(trigger, null, {
      isPill: true,
      minWidth: 180,
    });

    // 1024 - 8 (VIEWPORT_MARGIN) - 200 (default expected width) = 816
    const leftNum = parseInt(String(style.left), 10);
    expect(leftNum).toBeLessThanOrEqual(1024 - 180);
    expect(leftNum).toBeGreaterThanOrEqual(8);
  });

  it("uses max-content and pill min-width for pill mode", () => {
    const trigger = document.createElement("button");
    trigger.getBoundingClientRect = () => ({
      top: 100,
      bottom: 132,
      left: 50,
      right: 130,
      width: 80,
      height: 32,
      x: 50,
      y: 100,
      toJSON: () => {},
    });

    const { style } = calculateFloatingStyle(trigger, null, {
      isPill: true,
      minWidth: 180,
    });

    expect(style.width).toBe("max-content");
    expect(style.minWidth).toBe("180px");
  });
});
