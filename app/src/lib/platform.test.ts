import { afterEach, describe, expect, it, vi } from "vitest";
import { isAndroid, isDesktop, isTauri, supportsAndroidUpdates, supportsCodex, supportsDesktopUpdates, supportsRealtime } from "./platform";

const DESKTOP_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36";
const ANDROID_UA = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36";

function setTauri(present: boolean) {
  if (present) vi.stubGlobal("__TAURI_INTERNALS__", {});
  else (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = undefined;
}

function setUA(value: string) {
  Object.defineProperty(window.navigator, "userAgent", { configurable: true, value });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("platform", () => {
  it("detects Tauri shells via __TAURI_INTERNALS__", () => {
    setTauri(true);
    expect(isTauri()).toBe(true);
    expect(supportsRealtime()).toBe(true);
  });

  it("detects desktop vs android from the user agent", () => {
    setTauri(true);
    setUA(DESKTOP_UA);
    expect(isDesktop()).toBe(true);
    expect(isAndroid()).toBe(false);
    expect(supportsDesktopUpdates()).toBe(true);
    expect(supportsAndroidUpdates()).toBe(false);
    expect(supportsCodex()).toBe(true);

    setUA(ANDROID_UA);
    expect(isDesktop()).toBe(false);
    expect(isAndroid()).toBe(true);
    expect(supportsDesktopUpdates()).toBe(false);
    expect(supportsAndroidUpdates()).toBe(true);
    expect(supportsCodex()).toBe(false);
  });
});
