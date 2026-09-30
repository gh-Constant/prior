import { useEffect, useMemo, useState } from "react";
import qrcode from "qrcode-generator";
import { api, type TwoFactorStatus } from "../../lib/api";
import { getToken, saveUser, type SessionUser } from "../../lib/auth";
import { saveBlob } from "../../lib/accountData";
import { useI18n } from "../../lib/i18n";
import { Icon } from "../Icon";
import { Modal } from "../Modal";
import { SettingsRow, SettingsSection } from "../SettingsLayout";
import { reauthErrorKey, secondFactorInput } from "./DeleteAccountDialog";
import "./Account.css";

/** Renders an otpauth URI as an SVG QR code (dark modules on a white card). */
export function QrCode({ value, label }: { readonly value: string; readonly label: string }) {
  const path = useMemo(() => {
    const code = qrcode(0, "M");
    code.addData(value);
    code.make();
    const size = code.getModuleCount();
    let d = "";
    for (let row = 0; row < size; row += 1) {
      for (let col = 0; col < size; col += 1) {
        if (code.isDark(row, col)) d += `M${col} ${row}h1v1h-1z`;
      }
    }
    return { d, size };
  }, [value]);
  return (
    <svg viewBox={`-2 -2 ${path.size + 4} ${path.size + 4}`} role="img" aria-label={label} shapeRendering="crispEdges">
      <rect x={-2} y={-2} width={path.size + 4} height={path.size + 4} fill="#ffffff" />
      <path d={path.d} fill="#111111" />
    </svg>
  );
}

function RecoveryCodes({ codes, email, onDone }: { readonly codes: string[]; readonly email: string; readonly onDone: () => void }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const text = `${t("account.security.recoveryFile", { email })}\n\n${codes.join("\n")}\n`;
  return (
    <div className="account-dialog-body">
      <p>{t("account.security.recoveryHint")}</p>
      <ul className="recovery-codes" aria-label={t("account.security.recoveryTitle")}>
        {codes.map((code) => <li key={code}>{code}</li>)}
      </ul>
      <div className="account-dialog-actions">
        <button type="button" className="secondary-button" onClick={() => saveBlob(new Blob([text], { type: "text/plain;charset=utf-8" }), "prior-recovery-codes.txt")}><Icon name="download" />{t("account.security.download")}</button>
        <button type="button" className="secondary-button" onClick={() => { void navigator.clipboard?.writeText(text).then(() => setCopied(true)).catch(() => undefined); }}><Icon name="clipboard" />{copied ? t("account.security.copied") : t("account.security.copy")}</button>
        <button type="button" className="primary-button" onClick={onDone}>{t("account.security.done")}</button>
      </div>
    </div>
  );
}

type Dialog = { kind: "setup"; secret: string; uri: string } | { kind: "codes"; codes: string[] } | { kind: "disable" } | { kind: "regenerate" } | null;

/** Settings → Security: TOTP two-step verification. */
export function SecuritySettings({ user, onUserUpdated }: { readonly user: SessionUser | null; readonly onUserUpdated: (user: SessionUser) => void }) {
  const { t } = useI18n();
  const [status, setStatus] = useState<TwoFactorStatus | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  async function refresh() {
    const token = await getToken();
    if (!token) return;
    const next = await api.twoFactorStatus(token);
    setStatus(next);
    if (user && user.twoFactorEnabled !== next.enabled) {
      const updated = { ...user, twoFactorEnabled: next.enabled };
      saveUser(updated);
      onUserUpdated(updated);
    }
  }

  useEffect(() => {
    if (!user) return;
    refresh().catch(() => setStatus({ enabled: Boolean(user.twoFactorEnabled), available: false, recoveryCodesLeft: 0 }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  function open(next: Dialog) {
    setDialog(next);
    setCode("");
    setPassword("");
    setError("");
    setCopied(false);
  }

  async function run(action: (token: string) => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const token = await getToken();
      if (!token) throw new Error("signed out");
      await action(token);
    } catch (error_) {
      setError(t(reauthErrorKey(error_, "account.security")));
    } finally {
      setBusy(false);
    }
  }

  const startSetup = () => run(async (token) => {
    const setup = await api.twoFactorSetup(token);
    open({ kind: "setup", secret: setup.secret, uri: setup.otpauthUrl });
  });
  const confirmSetup = () => run(async (token) => {
    const result = await api.twoFactorEnable(code.replace(/\s/g, ""), token);
    open({ kind: "codes", codes: result.recoveryCodes });
    await refresh();
  });
  const disable = () => run(async (token) => {
    await api.twoFactorDisable({ password: user?.hasPassword === false ? undefined : password, ...secondFactorInput(code) }, token);
    open(null);
    await refresh();
  });
  const regenerate = () => run(async (token) => {
    const result = await api.twoFactorRecoveryCodes(code.replace(/\s/g, ""), token);
    open({ kind: "codes", codes: result.recoveryCodes });
    await refresh();
  });

  if (!user) {
    return (
      <SettingsSection title={t("account.security.title")}>
        <SettingsRow label={t("account.security.label")} description={t("account.security.signIn")} />
      </SettingsSection>
    );
  }

  const enabled = status?.enabled ?? Boolean(user.twoFactorEnabled);
  const description = enabled
    ? t("account.security.on", { count: status?.recoveryCodesLeft ?? 0 })
    : status && !status.available ? t("account.security.unavailable") : t("account.security.off");
  const codeField = (
    <label>
      <span>{dialog?.kind === "setup" || dialog?.kind === "regenerate" ? t("account.security.enterCode") : t("account.danger.code")}</span>
      <div className="field">
        <Icon name="shield" />
        <input
          value={code}
          onChange={(event) => { setCode(event.target.value); setError(""); }}
          inputMode={dialog?.kind === "disable" ? "text" : "numeric"}
          autoComplete="one-time-code"
          maxLength={dialog?.kind === "disable" ? 20 : 7}
          spellCheck={false}
          required
          className={dialog?.kind === "disable" ? "" : "two-factor-code-input"}
        />
      </div>
    </label>
  );

  return (
    <>
      <SettingsSection title={t("account.security.title")}>
        <SettingsRow label={t("account.security.label")} description={<>
          {description}
          {error && !dialog && <span className="settings-row-note is-error" role="alert">{error}</span>}
        </>}>
          <div className="settings-inline-actions">
            {enabled ? (
              <>
                <button type="button" className="secondary-button" onClick={() => open({ kind: "regenerate" })}><Icon name="key" />{t("account.security.regenerate")}</button>
                <button type="button" className="secondary-button settings-danger-text" onClick={() => open({ kind: "disable" })}>{t("account.security.disable")}</button>
              </>
            ) : (
              <button type="button" className="primary-button" disabled={busy || status?.available === false} onClick={() => void startSetup()}><Icon name="shield" />{t("account.security.enable")}</button>
            )}
          </div>
        </SettingsRow>
      </SettingsSection>

      {dialog?.kind === "setup" && (
        <Modal title={t("account.security.setupTitle")} ariaLabelledBy="two-factor-setup-title" onClose={() => open(null)} maxWidth={560}>
          <form className="account-dialog-body" onSubmit={(event) => { event.preventDefault(); void confirmSetup(); }}>
            <div className="two-factor-setup">
              <div className="two-factor-qr"><QrCode value={dialog.uri} label={t("account.security.qrAlt")} /></div>
              <div className="two-factor-setup-fields">
                <p>{t("account.security.scan")}</p>
                <div>
                  <p>{t("account.security.manual")}</p>
                  <code className="two-factor-secret">{dialog.secret.replace(/(.{4})/g, "$1 ").trim()}</code>
                </div>
                <div><button type="button" className="secondary-button" onClick={() => { void navigator.clipboard?.writeText(dialog.secret).then(() => setCopied(true)).catch(() => undefined); }}><Icon name="clipboard" />{copied ? t("account.security.copied") : t("account.security.copyKey")}</button></div>
              </div>
            </div>
            {codeField}
            {error && <p className="auth-error" role="alert">{error}</p>}
            <div className="account-dialog-actions">
              <button type="button" className="secondary-button" onClick={() => open(null)}>{t("account.security.cancel")}</button>
              <button type="submit" className="primary-button" disabled={busy || code.replace(/\s/g, "").length !== 6}>{busy ? t("account.security.confirming") : t("account.security.confirm")}</button>
            </div>
          </form>
        </Modal>
      )}

      {dialog?.kind === "codes" && (
        <Modal title={t("account.security.recoveryTitle")} ariaLabelledBy="recovery-codes-title" onClose={() => open(null)} maxWidth={520}>
          <RecoveryCodes codes={dialog.codes} email={user.email} onDone={() => open(null)} />
        </Modal>
      )}

      {(dialog?.kind === "disable" || dialog?.kind === "regenerate") && (
        <Modal title={dialog.kind === "disable" ? t("account.security.disableTitle") : t("account.security.regenerateTitle")} ariaLabelledBy="two-factor-change-title" onClose={() => open(null)} maxWidth={460}>
          <form className="account-dialog-body" onSubmit={(event) => { event.preventDefault(); void (dialog.kind === "disable" ? disable() : regenerate()); }}>
            <p>{dialog.kind === "disable" ? t("account.security.disableBody") : t("account.security.regenerateBody")}</p>
            {dialog.kind === "disable" && (user.hasPassword === false ? <p>{t("account.danger.googleHint")}</p> : (
              <label>
                <span>{t("account.danger.password")}</span>
                <div className="field"><Icon name="lock" /><input type="password" value={password} onChange={(event) => { setPassword(event.target.value); setError(""); }} autoComplete="current-password" required /></div>
              </label>
            ))}
            {codeField}
            {error && <p className="auth-error" role="alert">{error}</p>}
            <div className="account-dialog-actions">
              <button type="button" className="secondary-button" onClick={() => open(null)}>{t("account.security.cancel")}</button>
              <button type="submit" className={dialog.kind === "disable" ? "settings-danger-button" : "primary-button"} disabled={busy || !code.trim()}>
                {dialog.kind === "disable" ? t("account.security.disable") : t("account.security.create")}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
