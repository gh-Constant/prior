// Android in-app update check for sideloaded APK builds.
//
// The Tauri updater plugin is desktop-only, so Android updates cannot be
// downloaded and installed silently. The supported flow is:
//   1. Compare the installed version with the latest GitHub release.
//   2. Show a "Download vX.Y.Z" button that opens the release APK in the
//      system browser, which downloads it.
//   3. Android then offers to install the APK (the user must allow
//      "install unknown apps" once). Reinstalling over the existing app
//      preserves local data as long as the APK is signed with the same
//      keystore as the installed one (true for our release workflow).

import { supportsAndroidUpdates as supportsAndroidUpdatesPlatform } from "./platform";

const LATEST_RELEASE_URL = "https://api.github.com/repos/gh-Constant/prior/releases/latest";

export type AndroidUpdateInfo = {
  version: string;
  currentVersion: string;
  notes?: string;
  downloadUrl: string;
  sizeMb: number | null;
};

type ReleaseAsset = {
  name?: string;
  browser_download_url?: string;
  size?: number;
};

type ReleasePayload = {
  tag_name?: string;
  body?: string;
  assets?: ReleaseAsset[];
};

export function supportsAndroidUpdates(): boolean {
  return supportsAndroidUpdatesPlatform();
}

export async function getAndroidAppVersion(): Promise<string | null> {
  if (!supportsAndroidUpdates()) return null;
  try {
    const { getVersion } = await import("@tauri-apps/api/app");
    return await getVersion();
  } catch {
    return null;
  }
}

export function normalizeVersion(value: string): number[] {
  return value
    .trim()
    .replace(/^[vV]/, "")
    .split(/[.+-]/)
    .map((part) => Number.parseInt(part, 10))
    .filter((part) => Number.isFinite(part));
}

/** Returns true when `latest` is strictly newer than `current`. */
export function isNewerVersion(latest: string, current: string): boolean {
  const next = normalizeVersion(latest);
  const now = normalizeVersion(current);
  const length = Math.max(next.length, now.length);
  for (let index = 0; index < length; index += 1) {
    const a = next[index] ?? 0;
    const b = now[index] ?? 0;
    if (a !== b) return a > b;
  }
  return false;
}

export function pickApkAsset(payload: ReleasePayload): ReleaseAsset | null {
  const assets = Array.isArray(payload.assets) ? payload.assets : [];
  return assets.find((asset) => typeof asset.name === "string" && asset.name.endsWith(".apk") && typeof asset.browser_download_url === "string") ?? null;
}

export async function checkForAndroidUpdate(fetchImpl: typeof fetch = fetch): Promise<AndroidUpdateInfo | null> {
  if (!supportsAndroidUpdates()) return null;
  const currentVersion = await getAndroidAppVersion();
  if (!currentVersion) return null;

  const response = await fetchImpl(LATEST_RELEASE_URL, { headers: { Accept: "application/vnd.github+json" } });
  if (!response.ok) throw new Error(`GitHub release check failed (${response.status})`);
  const payload = (await response.json()) as ReleasePayload;

  const tag = typeof payload.tag_name === "string" ? payload.tag_name : "";
  if (!tag || !isNewerVersion(tag, currentVersion)) return null;

  const apk = pickApkAsset(payload);
  if (!apk?.browser_download_url) throw new Error("The latest release has no APK to download yet.");

  return {
    version: tag.replace(/^[vV]/, ""),
    currentVersion,
    notes: typeof payload.body === "string" && payload.body.trim() ? payload.body.trim().slice(0, 500) : undefined,
    downloadUrl: apk.browser_download_url,
    sizeMb: typeof apk.size === "number" && apk.size > 0 ? Math.round((apk.size / 1_048_576) * 10) / 10 : null,
  };
}

export async function openAndroidUpdate(downloadUrl: string): Promise<void> {
  const { openExternalUrl } = await import("./browser");
  await openExternalUrl(downloadUrl);
}
