import { useEffect, useState } from "react";
import { checkForUpdate, getAppVersion, installAvailableUpdate, supportsDesktopUpdates, type UpdateInfo } from "../lib/updater";
import { checkForAndroidUpdate, getAndroidAppVersion, openAndroidUpdate, supportsAndroidUpdates, type AndroidUpdateInfo } from "../lib/androidUpdater";
import { Icon } from "./Icon";

type UpdateState = "idle" | "checking" | "current" | "available" | "installing" | "error";

function updateCheckLabel(updateState: UpdateState): string {
  switch (updateState) {
    case "checking": return "Checking…";
    case "installing": return "Installing…";
    case "error": return "Try again";
    default: return "Check for updates";
  }
}

export function UpdateCard() {
  const [appVersion, setAppVersion] = useState<string | null>(null);
  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  const [updateState, setUpdateState] = useState<UpdateState>("idle");

  async function inspectUpdate() {
    setUpdateState("checking");
    try {
      const [version, nextUpdate] = await Promise.all([getAppVersion(), checkForUpdate()]);
      setAppVersion(version);
      setUpdate(nextUpdate);
      setUpdateState(nextUpdate ? "available" : "current");
    } catch {
      setUpdateState("error");
    }
  }

  async function installUpdate() {
    setUpdateState("installing");
    try {
      await installAvailableUpdate();
    } catch {
      setUpdateState("error");
    }
  }

  useEffect(() => { void inspectUpdate(); }, []);

  const checking = updateState === "checking" || updateState === "installing";
  return (
    <div className="update-card">
      <div className="update-card-heading"><span>Updates</span>{appVersion && <small>v{appVersion}</small>}</div>
      {updateState === "available" && update
        ? <button className="update-button" type="button" onClick={() => void installUpdate()}><Icon name="download" /> Update to v{update.version}</button>
        : (
          <button className="update-check" type="button" disabled={checking} onClick={() => void inspectUpdate()}>
            <Icon name="refresh" /> {updateCheckLabel(updateState)}
          </button>
        )}
    </div>
  );
}

export function AndroidUpdateCard() {
  const [appVersion, setAppVersion] = useState<string | null>(null);
  const [update, setUpdate] = useState<AndroidUpdateInfo | null>(null);
  const [updateState, setUpdateState] = useState<UpdateState>("idle");

  async function inspectUpdate() {
    setUpdateState("checking");
    try {
      const [version, nextUpdate] = await Promise.all([getAndroidAppVersion(), checkForAndroidUpdate()]);
      setAppVersion(version);
      setUpdate(nextUpdate);
      setUpdateState(nextUpdate ? "available" : "current");
    } catch {
      setUpdateState("error");
    }
  }

  async function downloadUpdate() {
    if (!update) return;
    setUpdateState("installing");
    try {
      await openAndroidUpdate(update.downloadUrl);
      setUpdateState("available");
    } catch {
      setUpdateState("error");
    }
  }

  useEffect(() => { void inspectUpdate(); }, []);

  const checking = updateState === "checking" || updateState === "installing";
  return (
    <div className="update-card">
      <div className="update-card-heading"><span>Updates</span>{appVersion && <small>v{appVersion}</small>}</div>
      {updateState === "available" && update
        ? (
          <>
            <button className="update-button" type="button" onClick={() => void downloadUpdate()}>
              <Icon name="download" /> Download v{update.version}{update.sizeMb ? ` (${update.sizeMb} MB)` : ""}
            </button>
            <p className="update-hint">The APK downloads in your browser — open it to install. Allow “unknown apps” once if asked.</p>
          </>
        )
        : (
          <button className="update-check" type="button" disabled={checking} onClick={() => void inspectUpdate()}>
            <Icon name="refresh" /> {updateState === "current" ? "Up to date" : updateCheckLabel(updateState)}
          </button>
        )}
    </div>
  );
}

export function UpdateCards() {
  const desktopUpdates = supportsDesktopUpdates();
  const androidUpdates = supportsAndroidUpdates();
  if (!desktopUpdates && !androidUpdates) return null;
  return (
    <>
      {desktopUpdates && <UpdateCard />}
      {androidUpdates && <AndroidUpdateCard />}
    </>
  );
}
