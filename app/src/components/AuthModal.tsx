import { useEffect, useState } from "react";
import type { SessionUser } from "../lib/auth";
import { signInWithPassword, signUpWithPassword } from "../lib/auth";
import { checkForUpdate, getAppVersion, installAvailableUpdate, supportsDesktopUpdates, type UpdateInfo } from "../lib/updater";
import { DownloadPanel } from "./DownloadPanel";
import { Icon } from "./Icon";

type Props = {
  user: SessionUser | null;
  authError?: string;
  onClose: () => void;
  onAuthenticated: (user: SessionUser) => void;
  onGoogle: () => void;
  onLogout: () => Promise<void>;
};

type UpdateState = "idle" | "checking" | "current" | "available" | "installing" | "error";

export function AuthModal({ user, authError, onClose, onAuthenticated, onGoogle, onLogout }: Props) {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [panel, setPanel] = useState<"account" | "downloads">("account");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [appVersion, setAppVersion] = useState<string | null>(null);
  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  const [updateState, setUpdateState] = useState<UpdateState>("idle");

  const desktopUpdates = supportsDesktopUpdates();

  async function inspectUpdate() {
    if (!desktopUpdates) return;
    setUpdateState("checking");
    try {
      const [version, nextUpdate] = await Promise.all([getAppVersion(), checkForUpdate()]);
      setAppVersion(version);
      setUpdate(nextUpdate);
      setUpdateState(nextUpdate ? "available" : "current");
    } catch {
      setUpdateState("error");
    }
  }

  useEffect(() => { void inspectUpdate(); }, []);

  async function installUpdate() {
    setUpdateState("installing");
    try {
      await installAvailableUpdate();
    } catch {
      setUpdateState("error");
    }
  }

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
          <h2 id="account-title">{panel === "downloads" ? "Downloads" : user ? "Account" : mode === "signin" ? "Sign in" : "Create account"}</h2>
          <button type="button" className="icon-button" aria-label="Close" onClick={onClose}><Icon name="close" /></button>
        </div>
        <div className="profile-tabs" role="tablist" aria-label="Profile sections">
          <button className={panel === "account" ? "active" : ""} type="button" role="tab" aria-selected={panel === "account"} onClick={() => setPanel("account")}>Account</button>
          <button className={panel === "downloads" ? "active" : ""} type="button" role="tab" aria-selected={panel === "downloads"} onClick={() => setPanel("downloads")}>Downloads</button>
        </div>
        {panel === "downloads" ? <DownloadPanel /> : user ? (
          <div className="account-panel">
            <div className="account-avatar">{user.avatarUrl ? <img src={user.avatarUrl} alt="" /> : <Icon name="user" />}</div>
            <p className="account-panel-name">{user.displayName || "Prior account"}</p>
            <p className="account-panel-email">{user.email}</p>
            {desktopUpdates && <div className="update-card">
              <div className="update-card-heading"><span>Updates</span>{appVersion && <small>v{appVersion}</small>}</div>
              {updateState === "available" && update ? <button className="update-button" type="button" onClick={() => void installUpdate()}><Icon name="download" /> Update to v{update.version}</button> : (
                <button className="update-check" type="button" disabled={updateState === "checking" || updateState === "installing"} onClick={() => void inspectUpdate()}>
                  <Icon name="refresh" /> {updateState === "checking" ? "Checking…" : updateState === "installing" ? "Installing…" : updateState === "error" ? "Try again" : "Check for updates"}
                </button>
              )}
            </div>}
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
              {(error || authError) && <p className="auth-error" role="alert">{error || authError}</p>}
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
