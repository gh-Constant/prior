import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkForAndroidUpdate, isNewerVersion, normalizeVersion, pickApkAsset, supportsAndroidUpdates } from "./androidUpdater";

vi.mock("@tauri-apps/api/app", () => ({
  getVersion: async () => "0.3.20",
}));

const ANDROID_UA = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36";

function stubAndroidTauri() {
  Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
  Object.defineProperty(navigator, "userAgent", { value: ANDROID_UA, configurable: true });
}

beforeEach(() => stubAndroidTauri());

afterEach(() => {
  // @ts-expect-error cleanup test stub
  delete window.__TAURI_INTERNALS__;
  vi.unstubAllGlobals();
});

describe("supportsAndroidUpdates", () => {
  it("is true inside the Android native shell", () => {
    expect(supportsAndroidUpdates()).toBe(true);
  });
});

describe("version comparison", () => {
  it("handles v prefixes and unequal lengths", () => {
    expect(normalizeVersion("v0.3.24")).toEqual([0, 3, 24]);
    expect(isNewerVersion("v0.3.24", "0.3.20")).toBe(true);
    expect(isNewerVersion("0.3.20", "0.3.20")).toBe(false);
    expect(isNewerVersion("0.3.19", "0.3.20")).toBe(false);
    expect(isNewerVersion("0.4", "0.3.24")).toBe(true);
  });
});

describe("pickApkAsset", () => {
  it("selects the APK download URL", () => {
    const asset = pickApkAsset({
      assets: [
        { name: "latest.json", browser_download_url: "https://example.com/latest.json" },
        { name: "prior-0.3.24-aarch64.apk", browser_download_url: "https://example.com/app.apk", size: 20_971_520 },
      ],
    });
    expect(asset?.browser_download_url).toBe("https://example.com/app.apk");
  });

  it("returns null when no APK is attached", () => {
    expect(pickApkAsset({ assets: [] })).toBeNull();
    expect(pickApkAsset({})).toBeNull();
  });
});

describe("checkForAndroidUpdate", () => {
  function stubFetch(payload: unknown, ok = true, status = 200) {
    return vi.fn(async () =>
      ({ ok, status, json: async () => payload }) as Response,
    );
  }

  it("returns update info when the release is newer", async () => {
    const result = await checkForAndroidUpdate(stubFetch({
      tag_name: "v0.3.24",
      body: "Bug fixes",
      assets: [{ name: "app.apk", browser_download_url: "https://example.com/app.apk", size: 20_971_520 }],
    }));
    expect(result).toMatchObject({ version: "0.3.24", currentVersion: "0.3.20", downloadUrl: "https://example.com/app.apk" });
    expect(result?.sizeMb).toBeCloseTo(20, 0);
  });

  it("returns null when already up to date", async () => {
    const result = await checkForAndroidUpdate(stubFetch({
      tag_name: "v0.3.20",
      assets: [{ name: "app.apk", browser_download_url: "https://example.com/app.apk" }],
    }));
    expect(result).toBeNull();
  });

  it("throws a clear error when the release has no APK yet", async () => {
    await expect(checkForAndroidUpdate(stubFetch({ tag_name: "v0.3.25", assets: [] })))
      .rejects.toThrow("no APK");
  });
});
