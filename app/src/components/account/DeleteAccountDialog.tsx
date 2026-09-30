import { useState } from "react";
import { api, apiErrorCode, type ReauthInput } from "../../lib/api";
import { getToken, type SessionUser } from "../../lib/auth";
import { useI18n } from "../../lib/i18n";
import { Icon } from "../Icon";
import { Modal } from "../Modal";
import "./Account.css";

/** Dispatched after the server deleted the account; App wipes the device. */
export const ACCOUNT_DELETED_EVENT = "prior-account-deleted";

/** A 6-digit value is an authenticator code, anything else a recovery code. */
export function secondFactorInput(value: string): Pick<ReauthInput, "code" | "recoveryCode"> {
  const trimmed = value.trim();
  if (!trimmed) return {};
  return /^\d{3}\s?\d{3}$/.test(trimmed) ? { code: trimmed.replace(/\s/g, "") } : { recoveryCode: trimmed };
}

export function reauthErrorKey(error: unknown, prefix: "account.danger" | "account.security"): string {
  switch (apiErrorCode(error)) {
    case "INVALID_PASSWORD": return `${prefix}.invalidPassword`;
    case "INVALID_CODE":
    case "TWO_FACTOR_REQUIRED": return `${prefix}.invalidCode`;
    case "REAUTH_REQUIRED": return `${prefix}.reauthRequired`;
    case "EMAIL_MISMATCH": return "account.danger.emailMismatch";
    case "BILLING_CANCEL_FAILED": return "account.danger.billing";
    case "TWO_FACTOR_LOCKED": return "account.security.locked";
    default: return prefix === "account.danger" ? "account.danger.failed" : "account.security.failed";
  }
}

type Props = {
  readonly user: SessionUser;
  readonly onClose: () => void;
  readonly onExport: () => void;
};

export function DeleteAccountDialog({ user, onClose, onExport }: Props) {
  const { t } = useI18n();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const needsPassword = user.hasPassword !== false;
  const emailMatches = email.trim().toLowerCase() === user.email.toLowerCase();
  const ready = emailMatches && (!needsPassword || password.length > 0) && (!user.twoFactorEnabled || code.trim().length > 0);

  async function submit() {
    if (!ready || busy) return;
    setBusy(true);
    setError("");
    try {
      const token = await getToken();
      if (!token) throw new Error(t("account.danger.failed"));
      await api.deleteAccount({ email: email.trim(), password: needsPassword ? password : undefined, ...secondFactorInput(code) }, token);
      window.dispatchEvent(new CustomEvent(ACCOUNT_DELETED_EVENT, { detail: { accountId: user.id } }));
    } catch (error_) {
      const key = reauthErrorKey(error_, "account.danger");
      setError(t(key));
      setBusy(false);
    }
  }

  return (
    <Modal title={t("account.danger.dialogTitle")} ariaLabelledBy="delete-account-title" onClose={busy ? () => undefined : onClose} maxWidth={480}>
      <form className="account-dialog-body" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
        <p>{t("account.danger.dialogBody")}</p>
        <p className="account-dialog-warning">{t("account.danger.irreversible")}</p>
        <div><button type="button" className="secondary-button" onClick={onExport}><Icon name="download" />{t("account.danger.exportFirst")}</button></div>
        <label>
          <span>{t("account.danger.typeEmail", { email: user.email })}</span>
          <div className="field"><Icon name="mail" /><input type="email" value={email} onChange={(event) => { setEmail(event.target.value); setError(""); }} autoComplete="off" spellCheck={false} required aria-invalid={email.length > 0 && !emailMatches ? true : undefined} /></div>
        </label>
        {needsPassword ? (
          <label>
            <span>{t("account.danger.password")}</span>
            <div className="field"><Icon name="lock" /><input type="password" value={password} onChange={(event) => { setPassword(event.target.value); setError(""); }} autoComplete="current-password" required /></div>
          </label>
        ) : (
          <p>{t("account.danger.googleHint")}</p>
        )}
        {user.twoFactorEnabled && (
          <label>
            <span>{t("account.danger.code")}</span>
            <div className="field"><Icon name="shield" /><input value={code} onChange={(event) => { setCode(event.target.value); setError(""); }} autoComplete="one-time-code" spellCheck={false} required /></div>
          </label>
        )}
        {error && <p className="auth-error" role="alert">{error}</p>}
        <div className="account-dialog-actions">
          <button type="button" className="secondary-button" onClick={onClose} disabled={busy}>{t("account.danger.cancel")}</button>
          <button type="submit" className="settings-danger-button" disabled={!ready || busy}><Icon name="trash" />{busy ? t("account.danger.deleting") : t("account.danger.confirm")}</button>
        </div>
      </form>
    </Modal>
  );
}
