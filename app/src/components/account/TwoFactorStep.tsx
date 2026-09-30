import { useEffect, useRef, useState } from "react";
import { apiErrorCode } from "../../lib/api";
import { completeTwoFactor, takePendingChallenge, TWO_FACTOR_CHALLENGE_EVENT, type SessionUser } from "../../lib/auth";
import { useI18n } from "../../lib/i18n";
import { Icon } from "../Icon";

/** The challenge a sign-in answered with, from any flow (password, Google). */
export function useTwoFactorChallenge(): [string | null, () => void] {
  const [challenge, setChallenge] = useState<string | null>(() => takePendingChallenge());
  useEffect(() => {
    const onChallenge = () => setChallenge(takePendingChallenge());
    window.addEventListener(TWO_FACTOR_CHALLENGE_EVENT, onChallenge);
    return () => window.removeEventListener(TWO_FACTOR_CHALLENGE_EVENT, onChallenge);
  }, []);
  return [challenge, () => setChallenge(null)];
}

export function twoFactorErrorKey(error: unknown): string {
  const code = apiErrorCode(error);
  if (code === "TWO_FACTOR_LOCKED") return "account.twoFactorStep.locked";
  if (code === "CHALLENGE_EXPIRED") return "account.twoFactorStep.expired";
  return "account.twoFactorStep.invalid";
}

type Props = {
  readonly challenge: string;
  readonly onAuthenticated: (user: SessionUser) => void;
  readonly onCancel: () => void;
};

/** Second sign-in step: a 6-digit TOTP code, or a recovery code. */
export function TwoFactorStep({ challenge, onAuthenticated, onCancel }: Props) {
  const { t } = useI18n();
  const [recovery, setRecovery] = useState(false);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, [recovery]);

  async function submit() {
    if (busy || !value.trim()) return;
    setBusy(true);
    setError("");
    try {
      const user = await completeTwoFactor(challenge, recovery ? { recoveryCode: value.trim() } : { code: value.replace(/\s/g, "") });
      onAuthenticated(user);
    } catch (error_) {
      const key = twoFactorErrorKey(error_);
      setError(t(key));
      if (key === "account.twoFactorStep.expired") window.setTimeout(onCancel, 1500);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="auth-form two-factor-step" aria-labelledby="two-factor-title" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <div className="two-factor-heading">
        <Icon name="lock" />
        <div>
          <h2 id="two-factor-title">{t("account.twoFactorStep.title")}</h2>
          <p>{recovery ? t("account.twoFactorStep.recoveryHint") : t("account.twoFactorStep.hint")}</p>
        </div>
      </div>
      <label>
        <span>{recovery ? t("account.twoFactorStep.recoveryCode") : t("account.twoFactorStep.code")}</span>
        <div className="field">
          <input
            ref={inputRef}
            value={value}
            onChange={(event) => { setValue(event.target.value); setError(""); }}
            inputMode={recovery ? "text" : "numeric"}
            autoComplete={recovery ? "off" : "one-time-code"}
            pattern={recovery ? undefined : "[0-9 ]{6,7}"}
            maxLength={recovery ? 20 : 7}
            spellCheck={false}
            required
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? "two-factor-error" : undefined}
            className={recovery ? "" : "two-factor-code-input"}
          />
        </div>
      </label>
      {error && <p id="two-factor-error" className="auth-error" role="alert">{error}</p>}
      <button className="primary-button auth-submit" type="submit" disabled={busy || !value.trim()}>{busy ? t("account.twoFactorStep.verifying") : t("account.twoFactorStep.verify")}</button>
      <div className="auth-link-row">
        <button type="button" className="link-button" onClick={() => { setRecovery((current) => !current); setValue(""); setError(""); }}>
          {recovery ? t("account.twoFactorStep.useCode") : t("account.twoFactorStep.useRecovery")}
        </button>
        <button type="button" className="link-button" onClick={onCancel}>{t("account.twoFactorStep.cancel")}</button>
      </div>
    </form>
  );
}
