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
  const [installed, setInstalled] = useState(false);

  async function inspectUpdate() {
    setUpdateState("checking");
    try {
      const [version, nextUpdate] = await Promise.all([getAppVersion(), checkForUpdate()]);
      setAppVersion(version);
      setUpdate(nextUpdate);
      setInstalled(false);
      setUpdateState(nextUpdate ? "available" : "current");
    } catch {
      setUpdateState("error");
    }
  }

  async function installUpdate() {
    setUpdateState("installing");
    try {
      await installAvailableUpdate();
      // Non-Windows relaunches inside installAvailableUpdate. Windows stays
      // alive: the install is staged, the user restarts to finish.
      if (/Windows/i.test(typeof navigator === "undefined" ? "" : navigator.userAgent)) {
        setInstalled(true);
        setUpdateState("available");
      }
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
            <button className="update-install" type="button" disabled={checking} onClick={() => void installUpdate()}>
              <span className="update-install-icon" aria-hidden="true"><Icon name="download" /></span>
              <span className="update-install-copy">
                <strong>{checking ? t("settings.updates.installing") : t("settings.updates.installNow", { version: update.version })}</strong>
                <small>{t("settings.updates.installHint")}</small>
              </span>
            </button>
            {installed && <p className="update-hint">{t("settings.updates.installedHint")}</p>}
          </>
        )
        : (
          <button className="update-check" type="button" disabled={checking} onClick={() => void inspectUpdate()}>
            <Icon name="refresh" /> {updateCheckLabel(t, updateState)}
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
