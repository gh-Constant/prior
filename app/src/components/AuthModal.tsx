import { useState } from "react";
import type { SessionUser } from "../lib/auth";
import { signInWithPassword, signUpWithPassword } from "../lib/auth";
import { Icon } from "./Icon";

type Props = {
  user: SessionUser | null;
  onClose: () => void;
  onAuthenticated: (user: SessionUser) => void;
  onGoogle: () => void;
  onLogout: () => Promise<void>;
};

export function AuthModal({ user, onClose, onAuthenticated, onGoogle, onLogout }: Props) {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
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
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to continue");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="modal auth-modal" role="dialog" aria-modal="true" aria-labelledby="account-title" onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <h2 id="account-title">{user ? "Account" : mode === "signin" ? "Sign in" : "Create account"}</h2>
          <button type="button" className="icon-button" aria-label="Close" onClick={onClose}><Icon name="close" /></button>
        </div>
        {user ? (
          <div className="account-panel">
            <div className="account-avatar">{user.avatarUrl ? <img src={user.avatarUrl} alt="" /> : <Icon name="user" />}</div>
            <p className="account-panel-name">{user.displayName || "Prior account"}</p>
            <p className="account-panel-email">{user.email}</p>
            <button className="danger-button" type="button" onClick={() => void onLogout()}>Log out</button>
          </div>
        ) : (
          <>
            <div className="auth-tabs" role="tablist" aria-label="Account access">
              <button className={mode === "signin" ? "active" : ""} type="button" role="tab" aria-selected={mode === "signin"} onClick={() => { setMode("signin"); setError(""); }}>Sign in</button>
              <button className={mode === "signup" ? "active" : ""} type="button" role="tab" aria-selected={mode === "signup"} onClick={() => { setMode("signup"); setError(""); }}>Create account</button>
            </div>
            <form className="auth-form" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
              {mode === "signup" && <label><span>Name</span><div className="field"><Icon name="user" /><input value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" placeholder="Your name" /></div></label>}
              <label><span>Email</span><div className="field"><Icon name="mail" /><input type="email" required value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" placeholder="you@example.com" /></div></label>
              <label><span>Password</span><div className="field"><Icon name="lock" /><input type="password" required minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={mode === "signup" ? "new-password" : "current-password"} placeholder="At least 8 characters" /></div></label>
              {error && <p className="auth-error" role="alert">{error}</p>}
              <button className="primary-button auth-submit" type="submit" disabled={busy}>{busy ? "Please wait…" : mode === "signin" ? "Sign in" : "Create account"}</button>
            </form>
            <div className="auth-divider"><span>or</span></div>
            <button className="google-button" type="button" onClick={onGoogle}><Icon name="google" /> Continue with Google</button>
          </>
        )}
      </section>
    </div>
  );
}
