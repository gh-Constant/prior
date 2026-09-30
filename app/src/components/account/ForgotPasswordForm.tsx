import { useState } from "react";
import { api } from "../../lib/api";
import { useI18n } from "../../lib/i18n";
import { Icon } from "../Icon";

/** Asks for a reset link. The answer never says whether the account exists. */
export function ForgotPasswordForm({ initialEmail = "", onBack }: { readonly initialEmail?: string; readonly onBack: () => void }) {
  const { t, lang } = useI18n();
  const [email, setEmail] = useState(initialEmail);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await api.forgotPassword(email.trim(), lang);
      setSentTo(email.trim());
    } catch {
      setError(t("account.forgot.failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="auth-form forgot-password-form" aria-labelledby="forgot-title" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <div className="two-factor-heading">
        <Icon name="mail" />
        <div>
          <h2 id="forgot-title">{t("account.forgot.title")}</h2>
          <p>{t("account.forgot.hint")}</p>
        </div>
      </div>
      {sentTo ? (
        <p className="auth-notice" role="status">{t("account.forgot.sent", { email: sentTo })}</p>
      ) : (
        <>
          <label>
            <span>{t("auth.form.email")}</span>
            <div className="field"><Icon name="mail" /><input type="email" required value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" placeholder={t("auth.form.emailPlaceholder")} /></div>
          </label>
          {error && <p className="auth-error" role="alert">{error}</p>}
          <button className="primary-button auth-submit" type="submit" disabled={busy || !email.trim()}>{busy ? t("account.forgot.sending") : t("account.forgot.submit")}</button>
        </>
      )}
      <div className="auth-link-row">
        <button type="button" className="link-button" onClick={onBack}>{t("account.forgot.back")}</button>
      </div>
    </form>
  );
}
