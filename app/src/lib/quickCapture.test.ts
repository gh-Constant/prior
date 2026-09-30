import { beforeEach, describe, expect, it } from "vitest";
import { acceleratorFromEvent, DEFAULT_QUICK_ADD_SHORTCUT, formatShortcut, getQuickAddSettings, isQuickAddWindow, saveQuickAddSettings } from "./quickCapture";

const key = (overrides: Partial<KeyboardEvent>) => ({ key: "", code: "", metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...overrides });

describe("quick capture settings", () => {
  beforeEach(() => localStorage.clear());

  it("defaults to Cmd/Ctrl+Shift+Space and can be turned off", () => {
    expect(getQuickAddSettings()).toEqual({ enabled: true, shortcut: DEFAULT_QUICK_ADD_SHORTCUT });
    saveQuickAddSettings({ enabled: false, shortcut: "Alt+Q" });
    expect(getQuickAddSettings()).toEqual({ enabled: false, shortcut: "Alt+Q" });
  });

  it("records accelerators and refuses bare keys", () => {
    expect(acceleratorFromEvent(key({ key: " ", code: "Space", metaKey: true, shiftKey: true }), true)).toBe("CommandOrControl+Shift+Space");
    expect(acceleratorFromEvent(key({ key: "q", code: "KeyQ", ctrlKey: true, altKey: true }), false)).toBe("CommandOrControl+Alt+Q");
    expect(acceleratorFromEvent(key({ key: "q", code: "KeyQ" }), false)).toBeNull();
    expect(acceleratorFromEvent(key({ key: "Shift", code: "ShiftLeft", shiftKey: true }), false)).toBeNull();
  });

  it("formats shortcuts per platform and detects the quick-add window", () => {
    expect(formatShortcut(DEFAULT_QUICK_ADD_SHORTCUT, true)).toBe("⌘⇧Space");
    expect(formatShortcut(DEFAULT_QUICK_ADD_SHORTCUT, false)).toBe("Ctrl+Shift+Space");
    expect(isQuickAddWindow("?quick-add=1")).toBe(true);
    expect(isQuickAddWindow("")).toBe(false);
  });
});
