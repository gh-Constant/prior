import { useState } from "react";
import type { SessionUser } from "../lib/auth";
import { signInWithPassword, signUpWithPassword } from "../lib/auth";
import { Icon } from "./Icon";

export type AuthMode = "signin" | "signup";

function submitLabelFor(busy: boolean, mode: AuthMode): string {
  if (busy) return "Please wait…";
  return mode === "signin" ? "Sign in" : "Create account";
}

function AuthForm({ mode, authError, onAuthenticated }: {
  readonly mode: AuthMode;
  readonly authError?: string;
  readonly onAuthenticated: (user: SessionUser) => void;
}) {
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
      setError(error_ instanceof Error ? error_.message : "Unable to continue");
    } finally {
      setBusy(false);
    }
  }

  const submitLabel = submitLabelFor(busy, mode);
  return (
    <form className="auth-form" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      {mode === "signup" && <label><span>Name</span><div className="field"><Icon name="user" /><input value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" placeholder="Your name" /></div></label>}
      <label><span>Email</span><div className="field"><Icon name="mail" /><input type="email" required value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" placeholder="you@example.com" /></div></label>
      <label><span>Password</span><div className="field"><Icon name="lock" /><input type="password" required minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={mode === "signup" ? "new-password" : "current-password"} placeholder="At least 8 characters" /></div></label>
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
  return (
    <>
      <div className="auth-tabs" role="tablist" aria-label="Account access">
        <button className={mode === "signin" ? "active" : ""} type="button" role="tab" aria-selected={mode === "signin"} onClick={() => onModeChange("signin")}>Sign in</button>
        <button className={mode === "signup" ? "active" : ""} type="button" role="tab" aria-selected={mode === "signup"} onClick={() => onModeChange("signup")}>Create account</button>
      </div>
      <AuthForm key={mode} mode={mode} authError={authError} onAuthenticated={onAuthenticated} />
      <div className="auth-divider"><span>or</span></div>
      <button className="google-button" type="button" onClick={onGoogle}><Icon name="google" /> Continue with Google</button>
    </>
  );
}
