import { useCallback, useEffect, useState } from "react";
import { checkForUpdate, getAppVersion, installAvailableUpdate, supportsDesktopUpdates } from "../lib/updater";
import { checkForAndroidUpdate, getAndroidAppVersion, openAndroidUpdate, supportsAndroidUpdates, type AndroidUpdateInfo } from "../lib/androidUpdater";
import { useI18n } from "../lib/i18n";
import { Icon } from "./Icon";

export type UpdateState = "idle" | "checking" | "current" | "available" | "installing" | "error";

export type AppUpdate = {
  /** Which updater applies to this build; null on the web, where there is none. */
  readonly channel: "desktop" | "android" | null;
  readonly version: string | null;
  readonly state: UpdateState;
  readonly nextVersion: string | null;
  readonly sizeMb: number | null;
  readonly check: () => Promise<void>;
  readonly install: () => Promise<void>;
};

function updateChannel(): AppUpdate["channel"] {
  if (supportsDesktopUpdates()) return "desktop";
  if (supportsAndroidUpdates()) return "android";
  return null;
}

/**
 * Installed version + update availability for native builds. Checks once on
 * mount (the Settings page is where users look for this) and on demand.
 */
export function useAppUpdate(): AppUpdate {
  const [channel] = useState(updateChannel);
  const [version, setVersion] = useState<string | null>(null);
  const [state, setState] = useState<UpdateState>("idle");
  const [nextVersion, setNextVersion] = useState<string | null>(null);
  const [android, setAndroid] = useState<AndroidUpdateInfo | null>(null);

  const check = useCallback(async () => {
    if (!channel) return;
    setState("checking");
    try {
      if (channel === "desktop") {
        const [installed, update] = await Promise.all([getAppVersion(), checkForUpdate()]);
        setVersion(installed);
        setNextVersion(update?.version ?? null);
        setState(update ? "available" : "current");
      } else {
        const [installed, update] = await Promise.all([getAndroidAppVersion(), checkForAndroidUpdate()]);
        setVersion(installed);
        setAndroid(update);
        setNextVersion(update?.version ?? null);
        setState(update ? "available" : "current");
      }
    } catch {
      setState("error");
    }
  }, [channel]);

  const install = useCallback(async () => {
    setState("installing");
    try {
      if (channel === "desktop") {
        await installAvailableUpdate();
      } else if (channel === "android" && android) {
        // The APK downloads in the browser; Android installs it from there.
        await openAndroidUpdate(android.downloadUrl);
        setState("available");
      }
    } catch {
      setState("error");
    }
  }, [android, channel]);

  useEffect(() => {
    if (!channel) return;
    let live = true;
    // Show the installed version even if the update check is slow or fails.
    void (channel === "desktop" ? getAppVersion() : getAndroidAppVersion())
      .then((installed) => { if (live && installed) setVersion((current) => current ?? installed); })
      .catch(() => undefined);
    void check();
    return () => { live = false; };
  }, [channel, check]);

  return { channel, version, state, nextVersion, sizeMb: android?.sizeMb ?? null, check, install };
}

/** Right-hand control of the Version row: status chip, check, or install. */
export function UpdateControl({ update }: { readonly update: AppUpdate }) {
  const { t } = useI18n();
  const { channel, state, nextVersion, sizeMb } = update;
  if (!channel) return null;

  if (state === "available" && nextVersion) {
    const label = channel === "android"
      ? sizeMb ? t("settings.updates.downloadWithSize", { version: nextVersion, size: sizeMb }) : t("settings.updates.download", { version: nextVersion })
      : t("settings.updates.installNow", { version: nextVersion });
    return (
      <button type="button" className="primary-button" onClick={() => void update.install()}>
        <Icon name="download" />{label}
      </button>
    );
  }

  if (state === "current") {
    return (
      <div className="settings-inline-actions">
        <span className="settings-status-chip is-positive"><span className="settings-status-dot" aria-hidden="true" />{t("settings.updates.upToDate")}</span>
        <button type="button" className="settings-icon-button" aria-label={t("settings.updates.check")} title={t("settings.updates.check")} onClick={() => void update.check()}>
          <Icon name="refresh" />
        </button>
      </div>
    );
  }

  const busy = state === "checking" || state === "installing";
  return (
    <button type="button" className="secondary-button" disabled={busy} onClick={() => void update.check()}>
      <Icon name="refresh" />
      {state === "checking" ? t("settings.updates.checking") : state === "installing" ? t("settings.updates.installing") : state === "error" ? t("settings.updates.retry") : t("settings.updates.check")}
    </button>
  );
}
