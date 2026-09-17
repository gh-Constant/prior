import { beforeEach, describe, expect, it, vi } from "vitest";
import { openUrl } from "@tauri-apps/plugin-opener";
import { isMobileTauri, isTauri, openExternalUrl } from "./browser";

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));

const originalUserAgent = window.navigator.userAgent;

function setUserAgent(value: string): void {
  Object.defineProperty(window.navigator, "userAgent", { configurable: true, value });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.unstubAllGlobals();
  setUserAgent(originalUserAgent);
});

describe("external URLs", () => {
  it("opens in the in-app browser on Android builds", async () => {
    vi.stubGlobal("__TAURI_INTERNALS__", {});
    setUserAgent("Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36");
    expect(isTauri()).toBe(true);
    expect(isMobileTauri()).toBe(true);
    await openExternalUrl("https://example.com/oauth");
    expect(openUrl).toHaveBeenCalledWith("https://example.com/oauth", "inAppBrowser");
  });

  it("opens in the system browser on desktop builds", async () => {
    vi.stubGlobal("__TAURI_INTERNALS__", {});
    setUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36");
    expect(isMobileTauri()).toBe(false);
    await openExternalUrl("https://example.com/oauth");
    expect(openUrl).toHaveBeenCalledWith("https://example.com/oauth");
  });

  it("opens in the system browser on the web", async () => {
    expect(isTauri()).toBe(false);
    await openExternalUrl("https://example.com/oauth");
    expect(openUrl).toHaveBeenCalledWith("https://example.com/oauth");
  });
});
