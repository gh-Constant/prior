import { useState } from "react";
import { useI18n } from "../../lib/i18n";
import { acceleratorFromEvent, applyQuickAddShortcut, DEFAULT_QUICK_ADD_SHORTCUT, formatShortcut, getQuickAddSettings, saveQuickAddSettings, type QuickAddSettings as Settings } from "../../lib/quickCapture";
import { SettingsRow, SettingsSection } from "../SettingsLayout";

/** Settings → General on desktop: the quick-add global shortcut. */
export function QuickAddSettings() {
  const { t } = useI18n();
  const [settings, setSettings] = useState<Settings>(() => getQuickAddSettings());
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState("");

  async function update(next: Settings) {
    const previous = settings;
    setSettings(next);
    setError("");
    try {
      await applyQuickAddShortcut(next);
      saveQuickAddSettings(next);
    } catch {
      setError(t("capture.settings.failed"));
      setSettings(previous);
      await applyQuickAddShortcut(previous).catch(() => undefined);
    }
  }

  return (
    <SettingsSection title={t("capture.settings.title")}>
      <SettingsRow label={t("capture.settings.label")} htmlFor="quick-add-enabled" description={<>
        {t("capture.settings.hint")}
        {error && <span className="settings-row-note is-error" role="alert">{error}</span>}
      </>}>
        <div className="settings-inline-actions">
          <button
            type="button"
            className="secondary-button settings-mono"
            aria-label={t("capture.settings.change")}
            aria-describedby="quick-add-current"
            disabled={!settings.enabled}
            onClick={() => setRecording(true)}
            onBlur={() => setRecording(false)}
            onKeyDown={(event) => {
              if (!recording) return;
              event.preventDefault();
              if (event.key === "Escape") { setRecording(false); return; }
              const accelerator = acceleratorFromEvent(event.nativeEvent);
              if (!accelerator) return;
              setRecording(false);
              void update({ ...settings, shortcut: accelerator });
            }}
          >
            <span id="quick-add-current">{recording ? t("capture.settings.recording") : settings.enabled ? formatShortcut(settings.shortcut) : t("capture.settings.off")}</span>
          </button>
          {settings.shortcut !== DEFAULT_QUICK_ADD_SHORTCUT && settings.enabled && (
            <button type="button" className="secondary-button" onClick={() => void update({ ...settings, shortcut: DEFAULT_QUICK_ADD_SHORTCUT })}>{t("capture.settings.reset")}</button>
          )}
          <input id="quick-add-enabled" type="checkbox" role="switch" className="settings-switch" aria-label={t("capture.settings.title")} checked={settings.enabled} onChange={(event) => void update({ ...settings, enabled: event.target.checked })} />
        </div>
      </SettingsRow>
    </SettingsSection>
  );
}
