import { useRef, useState } from "react";
import type { SessionUser } from "../lib/auth";
import { useModalDialog } from "../hooks/useModalDialog";
import { useI18n } from "../lib/i18n";
import { SignInPanel, type AuthMode } from "./SignInPanel";
import { Icon } from "./Icon";
import { EditableAvatar } from "./IconPicker";

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
  const { t } = useI18n();
  const [mode, setMode] = useState<AuthMode>("signin");
  const dialogRef = useRef<HTMLDialogElement>(null);
  useModalDialog(dialogRef);

  function handleCancel(event: React.SyntheticEvent<HTMLDialogElement>) {
    event.preventDefault();
    onClose();
  }

  return (
    <>
      <button type="button" className="modal-backdrop" aria-label={t("auth.dialog.closeBackdrop")} onClick={onClose} />
      <dialog ref={dialogRef} className="modal auth-modal" aria-labelledby="account-title" onCancel={handleCancel}>
        <div className="modal-header">
          <h2 id="account-title">{user ? t("auth.dialog.accountTitle") : mode === "signin" ? t("auth.tabs.signin") : t("auth.tabs.signup")}</h2>
          <button type="button" className="icon-button" aria-label={t("auth.dialog.close")} onClick={onClose}><Icon name="close" /></button>
        </div>
        {user ? (
          <div className="account-choice">
            <div className="account-dialog-summary">
              <EditableAvatar
                person={{ id: user.id, name: user.displayName || user.email, avatarUrl: user.avatarUrl }}
                readOnly
                avatarClassName="account-avatar"
              />
              <div>
                <p className="account-panel-name">{user.displayName || t("auth.account.fallbackName")}</p>
                <p className="account-panel-email">{user.email}</p>
              </div>
            </div>
            <button type="button" className="secondary-button account-choice-btn" onClick={onSettings}>
              <Icon name="gear" /><span>{t("auth.account.settings")}</span>
            </button>
            <button type="button" className="danger-button account-choice-btn" onClick={() => void onLogout()}>
              <Icon name="logout" /><span>{t("auth.account.logout")}</span>
            </button>
          </div>
        ) : (
          <div className="account-choice">
            <SignInPanel mode={mode} onModeChange={setMode} authError={authError} onAuthenticated={onAuthenticated} onGoogle={onGoogle} />
            <button type="button" className="secondary-button account-choice-btn" onClick={onSettings}>
              <Icon name="gear" /><span>{t("auth.account.settings")}</span>
            </button>
          </div>
        )}
      </dialog>
    </>
  );
}
