import { useState } from "react";
import type { SessionUser } from "../lib/auth";
import { useI18n } from "../lib/i18n";
import { SignInPanel, type AuthMode } from "./SignInPanel";

type Props = {
  readonly authError?: string;
  readonly onAuthenticated: (user: SessionUser) => void;
  readonly onGoogle: () => void;
};

export function AuthGate({ authError, onAuthenticated, onGoogle }: Props) {
  const { t } = useI18n();
  const [mode, setMode] = useState<AuthMode>("signin");

  return (
    <main className="auth-required-page">
      <section className="auth-required-card" aria-labelledby="auth-required-title">
        <div className="auth-required-brand">Prior</div>
        <h1 id="auth-required-title">{t("auth.required.title")}</h1>
        <p>{t("auth.required.description")}</p>
        <SignInPanel mode={mode} onModeChange={setMode} authError={authError} onAuthenticated={onAuthenticated} onGoogle={onGoogle} />
      </section>
    </main>
  );
}
