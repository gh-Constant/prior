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

// Builds installed from Google Play update through Play In-App Updates (native
// `play_update_*` commands). Play re-signs the app, so a GitHub APK can never
// update a Play install; the GitHub flow below only serves sideloaded builds,
// where the native check rejects because Play does not know the install.

const LATEST_RELEASE_URL = "https://api.github.com/repos/gh-Constant/prior/releases/latest";

export type AndroidUpdateInfo = {
  version: string;
  currentVersion: string;
  notes?: string;
  /** "play" updates through Play's in-app flow; "github" opens the release APK. */
  source: "play" | "github";
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

type PlayUpdate = { available: boolean; versionCode: number };

/** Play's answer, or null when this install is not managed by Google Play. */
async function checkPlayUpdate(): Promise<PlayUpdate | null> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<PlayUpdate>("play_update_check");
  } catch {
    return null;
  }
}

export async function checkForAndroidUpdate(fetchImpl: typeof fetch = fetch): Promise<AndroidUpdateInfo | null> {
  if (!supportsAndroidUpdates()) return null;
  const currentVersion = await getAndroidAppVersion();
  if (!currentVersion) return null;

  const play = await checkPlayUpdate();
  if (play) {
    // Play only exposes a version code, so the version label is generic.
    return play.available ? { version: "", currentVersion, source: "play", downloadUrl: "", sizeMb: null } : null;
  }

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
    source: "github",
    downloadUrl: apk.browser_download_url,
    sizeMb: typeof apk.size === "number" && apk.size > 0 ? Math.round((apk.size / 1_048_576) * 10) / 10 : null,
  };
}

export async function openAndroidUpdate(update: Pick<AndroidUpdateInfo, "source" | "downloadUrl">): Promise<void> {
  if (update.source === "play") {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("play_update_start");
    return;
  }
  const { openExternalUrl } = await import("./browser");
  await openExternalUrl(update.downloadUrl);
}

/** True when `installed` is older than the server's minimum supported version. */
export function isUpdateRequired(installed: string | null, minVersion: string | null | undefined): boolean {
  if (!installed || !minVersion) return false;
  return isNewerVersion(minVersion, installed);
}

/** The minimum Android version the API still supports, or null (no floor / offline). */
export async function fetchMinAndroidVersion(apiUrl: string, fetchImpl: typeof fetch = fetch): Promise<string | null> {
  try {
    const response = await fetchImpl(`${apiUrl}/health`);
    if (!response.ok) return null;
    const body = (await response.json()) as { minAndroidVersion?: unknown };
    return typeof body.minAndroidVersion === "string" && body.minAndroidVersion ? body.minAndroidVersion : null;
  } catch {
    return null;
  }
}
