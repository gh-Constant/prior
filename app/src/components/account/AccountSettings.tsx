import { useState } from "react";
import { api } from "../../lib/api";
import { getToken, type SessionUser } from "../../lib/auth";
import { exportLocalData, saveBlob } from "../../lib/accountData";
import { useI18n } from "../../lib/i18n";
import { Icon } from "../Icon";
import { SettingsRow, SettingsSection } from "../SettingsLayout";
import { DeleteAccountDialog } from "./DeleteAccountDialog";
import { needsEmailVerification } from "./VerifyEmailBanner";
import "./Account.css";

/** Settings → Profile & account: email status, data export, danger zone. */
export function AccountSettings({ user }: { readonly user: SessionUser | null }) {
  const { t, lang } = useI18n();
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [resend, setResend] = useState<"idle" | "sending" | "sent" | "failed">("idle");
  const [deleting, setDeleting] = useState(false);

  async function exportAccount() {
    if (exporting) return;
    setExporting(true);
    setExportError(null);
    try {
      if (!user) {
        await exportLocalData();
        return;
      }
      const token = await getToken();
      if (!token) throw new Error("signed out");
      const { blob, filename } = await api.exportAccount(token);
      saveBlob(blob, filename);
    } catch {
      setExportError(t("account.settings.exportFailed"));
    } finally {
      setExporting(false);
    }
  }

  async function resendVerification() {
    setResend("sending");
    try {
      const token = await getToken();
      if (!token) throw new Error("signed out");
      await api.resendVerification(lang, token);
      setResend("sent");
    } catch {
      setResend("failed");
    }
  }

  if (!user) {
    return (
      <SettingsSection title={t("account.settings.title")}>
        <SettingsRow label={t("account.settings.exportLocal")} description={<>
          {t("account.settings.exportLocalHint")}
          {exportError && <span className="settings-row-note is-error" role="alert">{exportError}</span>}
        </>}>
          <button type="button" className="secondary-button" disabled={exporting} onClick={() => void exportAccount()}>
            <Icon name="download" />{exporting ? t("account.settings.exporting") : t("account.settings.exportLocalButton")}
          </button>
        </SettingsRow>
      </SettingsSection>
    );
  }

  const unverified = needsEmailVerification(user);
  return (
    <>
      <SettingsSection title={t("account.settings.title")}>
        <SettingsRow label={t("account.settings.email")} description={<>
          {user.email}
          {resend === "sent" && <span className="settings-row-note" role="status">{t("account.banner.sent", { email: user.email })}</span>}
          {resend === "failed" && <span className="settings-row-note is-error" role="alert">{t("account.banner.failed")}</span>}
        </>}>
          <div className="settings-inline-actions">
            <span className={`settings-status-pill ${unverified ? "is-warn" : "is-ok"}`}>{unverified ? t("account.settings.unverified") : t("account.settings.verified")}</span>
            {unverified && resend !== "sent" && (
              <button type="button" className="secondary-button" disabled={resend === "sending"} onClick={() => void resendVerification()}>
                <Icon name="mail" />{resend === "sending" ? t("account.banner.sending") : t("account.banner.resend")}
              </button>
            )}
          </div>
        </SettingsRow>
        <SettingsRow label={t("account.settings.export")} description={<>
          {t("account.settings.exportHint")}
          {exportError && <span className="settings-row-note is-error" role="alert">{exportError}</span>}
        </>}>
          <button type="button" className="secondary-button" disabled={exporting} onClick={() => void exportAccount()}>
            <Icon name="download" />{exporting ? t("account.settings.exporting") : t("account.settings.exportButton")}
          </button>
        </SettingsRow>
      </SettingsSection>
      <div className="settings-danger-zone">
        <SettingsSection title={t("account.danger.title")}>
          <SettingsRow label={t("account.danger.label")} description={t("account.danger.hint")}>
            <button type="button" className="settings-danger-button" onClick={() => setDeleting(true)}>
              <Icon name="trash" />{t("account.danger.button")}
            </button>
          </SettingsRow>
        </SettingsSection>
      </div>
      {deleting && <DeleteAccountDialog user={user} onClose={() => setDeleting(false)} onExport={() => void exportAccount()} />}
    </>
  );
}
