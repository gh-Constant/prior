import { useEffect, useRef, useState } from "react";
import type { SessionUser } from "../lib/auth";
import { signInWithPassword, signUpWithPassword } from "../lib/auth";
import { checkForUpdate, getAppVersion, installAvailableUpdate, supportsDesktopUpdates, type UpdateInfo } from "../lib/updater";
import { useModalDialog } from "../hooks/useModalDialog";
import { DownloadPanel } from "./DownloadPanel";
import { Icon } from "./Icon";

type Props = {
  readonly user: SessionUser | null;
  readonly authError?: string;
  readonly onClose: () => void;
  readonly onAuthenticated: (user: SessionUser) => void;
  readonly onGoogle: () => void;
  readonly onLogout: () => Promise<void>;
};

type UpdateState = "idle" | "checking" | "current" | "available" | "installing" | "error";

type AuthMode = "signin" | "signup";

function modalTitle(panel: string, user: SessionUser | null, mode: AuthMode): string {
  if (panel === "downloads") return "Downloads";
  if (user) return "Account";
  return mode === "signin" ? "Sign in" : "Create account";
}

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

function updateCheckLabel(updateState: UpdateState): string {
  switch (updateState) {
    case "checking": return "Checking…";
    case "installing": return "Installing…";
    case "error": return "Try again";
    default: return "Check for updates";
  }
}

function UpdateCard() {
  const [appVersion, setAppVersion] = useState<string | null>(null);
  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  const [updateState, setUpdateState] = useState<UpdateState>("idle");

  async function inspectUpdate() {
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

  async function installUpdate() {
    setUpdateState("installing");
    try {
      await installAvailableUpdate();
    } catch {
      setUpdateState("error");
    }
  }

  useEffect(() => { void inspectUpdate(); }, []);

  const checking = updateState === "checking" || updateState === "installing";
  return (
    <div className="update-card">
      <div className="update-card-heading"><span>Updates</span>{appVersion && <small>v{appVersion}</small>}</div>
      {updateState === "available" && update
        ? <button className="update-button" type="button" onClick={() => void installUpdate()}><Icon name="download" /> Update to v{update.version}</button>
        : (
          <button className="update-check" type="button" disabled={checking} onClick={() => void inspectUpdate()}>
            <Icon name="refresh" /> {updateCheckLabel(updateState)}
          </button>
        )}
    </div>
  );
}

function AccountPanel({ user, onLogout }: { readonly user: SessionUser; readonly onLogout: () => Promise<void> }) {
  const desktopUpdates = supportsDesktopUpdates();
  return (
    <div className="account-panel">
      <div className="account-avatar">{user.avatarUrl ? <img src={user.avatarUrl} alt="" /> : <Icon name="user" />}</div>
      <p className="account-panel-name">{user.displayName || "Prior account"}</p>
      <p className="account-panel-email">{user.email}</p>
      {desktopUpdates && <UpdateCard />}
      <button className="danger-button" type="button" onClick={() => void onLogout()}>Log out</button>
    </div>
  );
}

function SignInPanel({ mode, onModeChange, authError, onAuthenticated, onGoogle }: {
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

function ModalBody({ panel, user, mode, onModeChange, authError, onAuthenticated, onGoogle, onLogout }: {
  readonly panel: "account" | "downloads";
  readonly user: SessionUser | null;
  readonly mode: AuthMode;
  readonly onModeChange: (mode: AuthMode) => void;
  readonly authError?: string;
  readonly onAuthenticated: (user: SessionUser) => void;
  readonly onGoogle: () => void;
  readonly onLogout: () => Promise<void>;
}) {
  if (panel === "downloads") return <DownloadPanel />;
  if (user) return <AccountPanel user={user} onLogout={onLogout} />;
  return <SignInPanel mode={mode} onModeChange={onModeChange} authError={authError} onAuthenticated={onAuthenticated} onGoogle={onGoogle} />;
}

export function AuthModal({ user, authError, onClose, onAuthenticated, onGoogle, onLogout }: Props) {
  const [mode, setMode] = useState<AuthMode>("signin");
  const [panel, setPanel] = useState<"account" | "downloads">("account");
  const dialogRef = useRef<HTMLDialogElement>(null);
  useModalDialog(dialogRef);

  function handleCancel(event: React.SyntheticEvent<HTMLDialogElement>) {
    event.preventDefault();
    onClose();
  }

  return (
    <>
      <button type="button" className="modal-backdrop" aria-label="Close account dialog" onClick={onClose} />
      <dialog ref={dialogRef} className="modal auth-modal" aria-labelledby="account-title" onCancel={handleCancel}>
        <div className="modal-header">
          <h2 id="account-title">{modalTitle(panel, user, mode)}</h2>
          <button type="button" className="icon-button" aria-label="Close" onClick={onClose}><Icon name="close" /></button>
        </div>
        <div className="profile-tabs" role="tablist" aria-label="Profile sections">
          <button className={panel === "account" ? "active" : ""} type="button" role="tab" aria-selected={panel === "account"} onClick={() => setPanel("account")}>Account</button>
          <button className={panel === "downloads" ? "active" : ""} type="button" role="tab" aria-selected={panel === "downloads"} onClick={() => setPanel("downloads")}>Downloads</button>
        </div>
        <ModalBody panel={panel} user={user} mode={mode} onModeChange={setMode} authError={authError} onAuthenticated={onAuthenticated} onGoogle={onGoogle} onLogout={onLogout} />
      </dialog>
    </>
  );
}
