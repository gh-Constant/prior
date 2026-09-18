import { useState } from "react";
import type { SessionUser } from "../lib/auth";
import { signInWithPassword, signUpWithPassword } from "../lib/auth";
import { useI18n, type Translator } from "../lib/i18n";
import { Icon } from "./Icon";

export type AuthMode = "signin" | "signup";

function submitLabelFor(t: Translator["t"], busy: boolean, mode: AuthMode): string {
  if (busy) return t("auth.form.waiting");
  return mode === "signin" ? t("auth.tabs.signin") : t("auth.tabs.signup");
}

function AuthForm({ mode, authError, onAuthenticated }: {
  readonly mode: AuthMode;
  readonly authError?: string;
  readonly onAuthenticated: (user: SessionUser) => void;
}) {
  const { t } = useI18n();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    setError("");
    setBusy(true);
    try {
      const nextUser = mode === "signup"
        ? await signUpWithPassword(email, password, name)
        : await signInWithPassword(email, password);
      onAuthenticated(nextUser);
    } catch (error_) {
      setError(error_ instanceof Error ? error_.message : t("auth.form.failed"));
    } finally {
      setBusy(false);
    }
  }

  const submitLabel = submitLabelFor(t, busy, mode);
  return (
    <form className="auth-form" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      {mode === "signup" && <label><span>{t("auth.form.name")}</span><div className="field"><Icon name="user" /><input value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" placeholder={t("auth.form.namePlaceholder")} /></div></label>}
      <label><span>{t("auth.form.email")}</span><div className="field"><Icon name="mail" /><input type="email" required value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" placeholder={t("auth.form.emailPlaceholder")} /></div></label>
      <label><span>{t("auth.form.password")}</span><div className="field"><Icon name="lock" /><input type="password" required minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={mode === "signup" ? "new-password" : "current-password"} placeholder={t("auth.form.passwordPlaceholder")} /></div></label>
      {(error || authError) && <p className="auth-error" role="alert">{error || authError}</p>}
      <button className="primary-button auth-submit" type="submit" disabled={busy}>{submitLabel}</button>
    </form>
  );
}

export function SignInPanel({ mode, onModeChange, authError, onAuthenticated, onGoogle }: {
  readonly mode: AuthMode;
  readonly onModeChange: (mode: AuthMode) => void;
  readonly authError?: string;
  readonly onAuthenticated: (user: SessionUser) => void;
  readonly onGoogle: () => void;
}) {
  const { t } = useI18n();
  return (
    <>
      <div className="auth-tabs" role="tablist" aria-label={t("auth.tabs.accessLabel")}>
        <button className={mode === "signin" ? "active" : ""} type="button" role="tab" aria-selected={mode === "signin"} onClick={() => onModeChange("signin")}>{t("auth.tabs.signin")}</button>
        <button className={mode === "signup" ? "active" : ""} type="button" role="tab" aria-selected={mode === "signup"} onClick={() => onModeChange("signup")}>{t("auth.tabs.signup")}</button>
      </div>
      <AuthForm key={mode} mode={mode} authError={authError} onAuthenticated={onAuthenticated} />
      <div className="auth-divider"><span>{t("auth.divider.or")}</span></div>
      <button className="google-button" type="button" onClick={onGoogle}><Icon name="google" /> {t("auth.google.continue")}</button>
    </>
  );
}
