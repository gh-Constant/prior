import { useEffect, useState } from "react";
import { useI18n } from "../../lib/i18n";
import { notificationPermission, requestNotificationPermission, sendTestNotification, type PermissionState } from "../../lib/notificationScheduler";
import { getNotificationSettings, saveNotificationSettings, type NotificationSettings as Settings } from "../../lib/reminders";
import { isAndroid, isTauri } from "../../lib/platform";
import { Icon } from "../Icon";
import { SettingsRow, SettingsSection } from "../SettingsLayout";
import "./TaskExtras.css";

function Switch({ id, checked, onChange, disabled }: { readonly id: string; readonly checked: boolean; readonly onChange: (value: boolean) => void; readonly disabled?: boolean }) {
  return <input id={id} type="checkbox" role="switch" className="settings-switch" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />;
}

/** Settings → Notifications: reminders on this device. */
export function NotificationSettings() {
  const { t } = useI18n();
  const [settings, setSettings] = useState<Settings>(() => getNotificationSettings());
  const [permission, setPermission] = useState<PermissionState | null>(null);
  const [testState, setTestState] = useState<"idle" | "sent" | "blocked">("idle");

  useEffect(() => {
    let live = true;
    void notificationPermission().then((state) => { if (live) setPermission(state); });
    return () => { live = false; };
  }, []);

  function update(patch: Partial<Settings>) {
    const next = { ...settings, ...patch };
    setSettings(next);
    saveNotificationSettings(next);
  }

  async function enable(value: boolean) {
    update({ enabled: value });
    if (value) setPermission(await requestNotificationPermission());
  }

  async function test() {
    const state = await sendTestNotification();
    setPermission(state);
    setTestState(state === "granted" ? "sent" : "blocked");
  }

  const quiet = Boolean(settings.quietStart && settings.quietEnd);
  const permissionNote = permission === "denied"
    ? t("reminders.settings.denied")
    : permission === "unsupported"
      ? t("reminders.settings.unsupported")
      : null;
  const scope = isAndroid() ? t("reminders.settings.scopeAndroid") : isTauri() ? t("reminders.settings.scopeDesktop") : t("reminders.settings.scopeWeb");

  return (
    <SettingsSection title={t("reminders.settings.title")}>
      <SettingsRow label={t("reminders.settings.enabled")} htmlFor="notifications-enabled" description={<>
        {scope}
        {permissionNote && <span className="settings-row-note is-error" role="alert">{permissionNote}</span>}
      </>}>
        <Switch id="notifications-enabled" checked={settings.enabled} onChange={(value) => void enable(value)} />
      </SettingsRow>
      <SettingsRow label={t("reminders.settings.habits")} htmlFor="notifications-habits" description={t("reminders.settings.habitsHint")}>
        <Switch id="notifications-habits" checked={settings.habits} disabled={!settings.enabled} onChange={(value) => update({ habits: value })} />
      </SettingsRow>
      <SettingsRow label={t("reminders.settings.quiet")} htmlFor="notifications-quiet" description={t("reminders.settings.quietHint")}>
        <div className="settings-inline-actions">
          <Switch id="notifications-quiet" checked={quiet} disabled={!settings.enabled} onChange={(value) => update(value ? { quietStart: "22:00", quietEnd: "07:00" } : { quietStart: null, quietEnd: null })} />
          {quiet && (
            <>
              <input type="time" className="reminder-picker-custom" aria-label={t("reminders.settings.quietStart")} value={settings.quietStart ?? ""} disabled={!settings.enabled} onChange={(event) => update({ quietStart: event.target.value || null })} />
              <span aria-hidden="true">–</span>
              <input type="time" className="reminder-picker-custom" aria-label={t("reminders.settings.quietEnd")} value={settings.quietEnd ?? ""} disabled={!settings.enabled} onChange={(event) => update({ quietEnd: event.target.value || null })} />
            </>
          )}
        </div>
      </SettingsRow>
      <SettingsRow label={t("reminders.settings.test")} description={<>
        {t("reminders.settings.testHint")}
        {testState === "sent" && <span className="settings-row-note" role="status">{t("reminders.settings.testSent")}</span>}
        {testState === "blocked" && <span className="settings-row-note is-error" role="alert">{t("reminders.settings.denied")}</span>}
      </>}>
        <button type="button" className="secondary-button" disabled={!settings.enabled} onClick={() => void test()}><Icon name="bell" />{t("reminders.settings.testButton")}</button>
      </SettingsRow>
    </SettingsSection>
  );
}
