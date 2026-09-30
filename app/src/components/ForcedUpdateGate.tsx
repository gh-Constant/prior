import { useEffect, useState, type ReactNode } from "react";
import { API_URL } from "../lib/api";
import { fetchMinAndroidVersion, getAndroidAppVersion, isUpdateRequired, openAndroidUpdate, supportsAndroidUpdates } from "../lib/androidUpdater";
import { useI18n } from "../lib/i18n";
import { Icon } from "./Icon";

/**
 * Blocks the Android app when the API declares a minimum supported version
 * (MIN_ANDROID_VERSION) newer than the installed one. Offline or failed checks
 * never block. Everyone else gets the app untouched.
 */
export function ForcedUpdateGate({ children }: { readonly children: ReactNode }) {
  const { t } = useI18n();
  const [required, setRequired] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!supportsAndroidUpdates()) return;
    let live = true;
    void Promise.all([getAndroidAppVersion(), fetchMinAndroidVersion(API_URL)]).then(([installed, min]) => {
      if (live) setRequired(isUpdateRequired(installed, min));
    });
    return () => { live = false; };
  }, []);

  if (!required) return <>{children}</>;

  const update = async () => {
    setBusy(true);
    try {
      // Play installs use the immediate in-app flow; sideloads fall back to the release page.
      await openAndroidUpdate({ source: "play", downloadUrl: "" }).catch(() =>
        openAndroidUpdate({ source: "github", downloadUrl: "https://github.com/gh-Constant/prior/releases/latest" }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="auth-required-page" role="alertdialog" aria-labelledby="forced-update-title">
      <div>
        <h1 id="forced-update-title">{t("settings.updates.required.title")}</h1>
        <p>{t("settings.updates.required.body")}</p>
        <button type="button" className="primary-button" disabled={busy} onClick={() => void update()}>
          <Icon name="download" />{t("settings.updates.updateNow")}
        </button>
      </div>
    </main>
  );
}
