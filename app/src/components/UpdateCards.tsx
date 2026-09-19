import { useEffect, useState } from "react";
import { checkForUpdate, getAppVersion, installAvailableUpdate, supportsDesktopUpdates, type UpdateInfo } from "../lib/updater";
import { checkForAndroidUpdate, getAndroidAppVersion, openAndroidUpdate, supportsAndroidUpdates, type AndroidUpdateInfo } from "../lib/androidUpdater";
import { useI18n, type Translator } from "../lib/i18n";
import { Icon } from "./Icon";

type UpdateState = "idle" | "checking" | "current" | "available" | "installing" | "error";

function updateCheckLabel(t: Translator["t"], updateState: UpdateState): string {
  switch (updateState) {
    case "checking": return t("settings.updates.checking");
    case "installing": return t("settings.updates.installing");
    case "error": return t("settings.updates.retry");
    default: return t("settings.updates.check");
  }
}

export function UpdateCard() {
  const { t } = useI18n();
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
      <div className="update-card-heading"><span>{t("settings.updates.title")}</span>{appVersion && <small>v{appVersion}</small>}</div>
      {updateState === "available" && update
        ? (
          <button className="update-button" type="button" disabled={checking} onClick={() => void installUpdate()}>
            <Icon name="download" /> {checking ? t("settings.updates.installing") : `Update to v${update.version}`}
          </button>
        )
        : (
          <button className="update-check" type="button" disabled={checking} onClick={() => void inspectUpdate()}>
            <Icon name="refresh" /> {updateState === "current" ? t("settings.updates.upToDate") : updateCheckLabel(t, updateState)}
          </button>
        )}
    </div>
  );
}

export function AndroidUpdateCard() {
  const { t } = useI18n();
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
      <div className="update-card-heading"><span>{t("settings.updates.title")}</span>{appVersion && <small>v{appVersion}</small>}</div>
      {updateState === "available" && update
        ? (
          <>
            <button className="update-button" type="button" onClick={() => void downloadUpdate()}>
              <Icon name="download" /> {update.sizeMb ? t("settings.updates.downloadWithSize", { version: update.version, size: update.sizeMb }) : t("settings.updates.download", { version: update.version })}
            </button>
            <p className="update-hint">{t("settings.updates.apkHint")}</p>
          </>
        )
        : (
          <button className="update-check" type="button" disabled={checking} onClick={() => void inspectUpdate()}>
            <Icon name="refresh" /> {updateState === "current" ? t("settings.updates.upToDate") : updateCheckLabel(t, updateState)}
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
