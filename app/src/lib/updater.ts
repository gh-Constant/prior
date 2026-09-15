import { getVersion } from "@tauri-apps/api/app";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";

export type UpdateInfo = {
  version: string;
  currentVersion: string;
  notes?: string;
};

let pendingUpdate: Update | null = null;

export function supportsDesktopUpdates(): boolean {
  if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) return false;
  return !/Android|iPhone|iPad/i.test(navigator.userAgent);
}

export async function getAppVersion(): Promise<string | null> {
  if (!supportsDesktopUpdates()) return null;
  try {
    return await getVersion();
  } catch {
    return null;
  }
}

export async function checkForUpdate(): Promise<UpdateInfo | null> {
  if (!supportsDesktopUpdates()) return null;
  pendingUpdate = await check({ timeout: 15000 });
  if (!pendingUpdate) return null;
  return {
    version: pendingUpdate.version,
    currentVersion: pendingUpdate.currentVersion,
    notes: pendingUpdate.body,
  };
}

export async function installAvailableUpdate(): Promise<void> {
  if (!pendingUpdate) throw new Error("No update available");
  const update = pendingUpdate;
  pendingUpdate = null;
  await update.downloadAndInstall();
  if (!/Windows/i.test(navigator.userAgent)) await relaunch();
}
