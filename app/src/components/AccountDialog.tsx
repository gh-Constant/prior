import { useRef, useState } from "react";
import type { SessionUser } from "../lib/auth";
import { useModalDialog } from "../hooks/useModalDialog";
import { SignInPanel, type AuthMode } from "./SignInPanel";
import { Icon } from "./Icon";

type Props = {
  readonly user: SessionUser | null;
  readonly authError?: string;
  readonly onClose: () => void;
  readonly onAuthenticated: (user: SessionUser) => void;
  readonly onGoogle: () => void;
  readonly onLogout: () => Promise<void>;
  readonly onSettings: () => void;
};

export function AccountDialog({ user, authError, onClose, onAuthenticated, onGoogle, onLogout, onSettings }: Props) {
  const [mode, setMode] = useState<AuthMode>("signin");
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
          <h2 id="account-title">{user ? "Account" : mode === "signin" ? "Sign in" : "Create account"}</h2>
          <button type="button" className="icon-button" aria-label="Close" onClick={onClose}><Icon name="close" /></button>
        </div>
        {user ? (
          <div className="account-choice">
            <div className="account-dialog-summary">
              <div className="account-avatar">{user.avatarUrl ? <img src={user.avatarUrl} alt="" /> : <Icon name="user" />}</div>
              <div>
                <p className="account-panel-name">{user.displayName || "Prior account"}</p>
                <p className="account-panel-email">{user.email}</p>
              </div>
            </div>
            <button type="button" className="secondary-button account-choice-btn" onClick={onSettings}>
              <Icon name="gear" /><span>Settings</span>
            </button>
            <button type="button" className="danger-button account-choice-btn" onClick={() => void onLogout()}>
              <Icon name="logout" /><span>Log out</span>
            </button>
          </div>
        ) : (
          <div className="account-choice">
            <SignInPanel mode={mode} onModeChange={setMode} authError={authError} onAuthenticated={onAuthenticated} onGoogle={onGoogle} />
            <button type="button" className="secondary-button account-choice-btn" onClick={onSettings}>
              <Icon name="gear" /><span>Settings</span>
            </button>
          </div>
        )}
      </dialog>
    </>
  );
}
