import { useEffect, useRef, useState } from "react";
import { api, apiErrorCode } from "../../lib/api";
import { useI18n } from "../../lib/i18n";
import { Icon } from "../Icon";
import "./Account.css";

export type AccountLinkRoute = { kind: "reset" | "verify"; token: string };

/** Recognizes the emailed links: /reset-password?token= and /verify-email?token=. */
export function parseAccountLinkRoute(location: Pick<Location, "pathname" | "search">): AccountLinkRoute | null {
  const path = location.pathname.replace(/\/+$/, "");
  const kind = path === "/reset-password" ? "reset" : path === "/verify-email" ? "verify" : null;
  if (!kind) return null;
  return { kind, token: new URLSearchParams(location.search).get("token") ?? "" };
}

/** Leaves the link page for the app, dropping the one-use token from history. */
function leave(onDone: () => void): void {
  window.history.replaceState(null, "", "/");
  onDone();
}

function ResetPasswordForm({ token, onDone }: { readonly token: string; readonly onDone: () => void }) {
  const { t } = useI18n();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [state, setState] = useState<"idle" | "saving" | "done" | "invalid">(token ? "idle" : "invalid");
  const [error, setError] = useState("");

  async function submit() {
    if (password !== confirm) {
      setError(t("account.reset.mismatch"));
      return;
    }
    setState("saving");
    setError("");
    try {
      await api.resetPassword(token, password);
      setState("done");
    } catch (error_) {
      if (apiErrorCode(error_) === "TOKEN_INVALID") {
        setState("invalid");
        return;
      }
      setState("idle");
      setError(error_ instanceof Error ? error_.message : t("auth.form.failed"));
    }
  }

  if (state === "done" || state === "invalid") {
    return (
      <>
        <p className={`auth-notice account-link-status`} role={state === "done" ? "status" : "alert"}>
          {state === "done" ? t("account.reset.done") : token ? t("account.reset.invalid") : t("account.reset.missing")}
        </p>
        <div className="account-link-actions">
          <button type="button" className="primary-button" onClick={() => leave(onDone)}>{t("account.links.signIn")}</button>
          <a className="secondary-button" href="prior://auth">{t("account.links.openApp")}</a>
        </div>
      </>
    );
  }
  return (
    <form className="auth-form" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <label><span>{t("account.reset.newPassword")}</span><div className="field"><Icon name="lock" /><input type="password" required minLength={8} maxLength={128} value={password} onChange={(event) => { setPassword(event.target.value); setError(""); }} autoComplete="new-password" /></div></label>
      <label><span>{t("account.reset.confirm")}</span><div className="field"><Icon name="lock" /><input type="password" required minLength={8} maxLength={128} value={confirm} onChange={(event) => { setConfirm(event.target.value); setError(""); }} autoComplete="new-password" /></div></label>
      {error && <p className="auth-error" role="alert">{error}</p>}
      <button className="primary-button auth-submit" type="submit" disabled={state === "saving"}>{state === "saving" ? t("account.reset.saving") : t("account.reset.submit")}</button>
    </form>
  );
}

function VerifyEmailStatus({ token, onDone }: { readonly token: string; readonly onDone: () => void }) {
  const { t } = useI18n();
  const [state, setState] = useState<"checking" | "done" | "invalid">(token ? "checking" : "invalid");
  const started = useRef(false);

  useEffect(() => {
    // One-use token: never send it twice (React StrictMode mounts twice).
    if (!token || started.current) return;
    started.current = true;
    api.verifyEmail(token)
      .then(() => {
        setState("done");
        window.dispatchEvent(new Event("prior-email-verified"));
      })
      .catch(() => setState("invalid"));
  }, [token]);

  return (
    <>
      <p className="auth-notice account-link-status" role={state === "invalid" ? "alert" : "status"} aria-live="polite">
        {state === "checking" ? t("account.verify.checking") : state === "done" ? t("account.verify.done") : t("account.verify.invalid")}
      </p>
      {state !== "checking" && (
        <div className="account-link-actions">
          <button type="button" className="primary-button" onClick={() => leave(onDone)}>{t("account.links.continue")}</button>
          <a className="secondary-button" href="prior://auth">{t("account.links.openApp")}</a>
        </div>
      )}
    </>
  );
}

/** Standalone page for emailed links; works signed in or out. */
export function AccountLinkPage({ route, onDone }: { readonly route: AccountLinkRoute; readonly onDone: () => void }) {
  const { t } = useI18n();
  return (
    <main className="auth-required-page">
      <section className="auth-required-card account-link-card" aria-labelledby="account-link-title">
        <div className="auth-required-brand">Prior</div>
        <h1 id="account-link-title">{route.kind === "reset" ? t("account.reset.title") : t("account.verify.title")}</h1>
        {route.kind === "reset" ? <ResetPasswordForm token={route.token} onDone={onDone} /> : <VerifyEmailStatus token={route.token} onDone={onDone} />}
      </section>
    </main>
  );
}
