import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { getAgentSettings, notifyAgentSettingsChanged, saveAgentSettings } from "../lib/ai";
import { clearCachedCodexAccount, codexBinaryAvailable, getCachedCodexAccount, logoutCodex, setCachedCodexAccount, startCodexLogin, supportsCodexDesktop, waitForCodexLogin, type CodexAccount } from "../lib/codex";
import type { AgentProvider } from "../types";
import { getToken, type SessionUser } from "../lib/auth";
import { api } from "../lib/api";
import { pullAssistantSettings, pushAssistantSettings } from "../lib/settingsSync";
import { UpdateControl, useAppUpdate } from "./UpdateControl";
import { Icon, type IconName } from "./Icon";
import { LANGUAGES, useI18n, type Language } from "../lib/i18n";
import { EditableAvatar, IconUpload } from "./IconPicker";
import { CustomSelect } from "./CustomSelect";
import { logger } from "../lib/logger";
import { localStore } from "../lib/localStore";
import "./SettingsPage.css";

type SettingsTab = "general" | "profile" | "assistant" | "diagnostics" | "developer";

type SettingsPageProps = {
  readonly user: SessionUser | null;
  readonly onUserUpdated: (user: SessionUser) => void;
};

const LATEST_RELEASE_URL = "https://api.github.com/repos/gh-Constant/prior/releases/latest";

async function fetchLatestReleaseVersion(): Promise<string | null> {
  try {
    const response = await fetch(LATEST_RELEASE_URL, { headers: { Accept: "application/vnd.github+json" } });
    if (!response.ok) return null;
    const data = (await response.json()) as { tag_name?: string };
    const tag = data.tag_name?.trim() ?? "";
    if (!tag) return null;
    return tag.startsWith("v") ? tag : `v${tag}`;
  } catch {
    return null;
  }
}

/* ── Layout primitives: titled sections of bordered cards made of rows ── */

function SettingsSection({ title, children, footer }: { readonly title: string; readonly children: ReactNode; readonly footer?: ReactNode }) {
  const headingId = useId();
  return (
    <section className="settings-section" aria-labelledby={headingId}>
      <h2 id={headingId} className="settings-section-title">{title}</h2>
      <div className="settings-group">
        {children}
        {footer && <div className="settings-group-footer">{footer}</div>}
      </div>
    </section>
  );
}

type SettingsRowProps = {
  readonly label: ReactNode;
  readonly description?: ReactNode;
  /** Associates the label with a form control inside the row. */
  readonly htmlFor?: string;
  /** Control spans the full width under the text (long inputs, log viewers). */
  readonly stacked?: boolean;
  readonly children?: ReactNode;
};

function SettingsRow({ label, description, htmlFor, stacked = false, children }: SettingsRowProps) {
  return (
    <div className={`settings-row ${stacked ? "is-stacked" : ""}`}>
      <div className="settings-row-text">
        {htmlFor ? <label className="settings-row-label" htmlFor={htmlFor}>{label}</label> : <div className="settings-row-label">{label}</div>}
        {description && <div className="settings-row-description">{description}</div>}
      </div>
      {children !== undefined && children !== null && children !== false && <div className="settings-row-control">{children}</div>}
    </div>
  );
}

/* ── General ── */

function GeneralSettings() {
  const { t, lang, setLang } = useI18n();
  const update = useAppUpdate();
  const [latest, setLatest] = useState<string | null>(null);

  useEffect(() => {
    // Web builds have no bundled version: show the latest published one.
    if (update.channel) return undefined;
    let live = true;
    void fetchLatestReleaseVersion().then((version) => { if (live) setLatest(version); });
    return () => { live = false; };
  }, [update.channel]);

  let versionDescription: ReactNode;
  if (!update.channel) {
    versionDescription = latest ? t("settings.layout.versionWeb", { version: latest }) : t("settings.general.webApp");
  } else {
    const parts = [update.version ? t("settings.layout.versionDesktop", { version: update.version }) : null];
    if (update.state === "available" && update.nextVersion) parts.push(t("settings.layout.updateAvailable", { version: update.nextVersion }));
    if (update.state === "error") parts.push(t("settings.layout.checkFailed"));
    versionDescription = <>
      {parts.filter(Boolean).join(" · ")}
      {update.channel === "android" && update.state === "available" && <span className="settings-row-note">{t("settings.updates.apkHint")}</span>}
    </>;
  }

  return (
    <>
      <SettingsSection title={t("settings.layout.languageRegion")}>
        <SettingsRow label={t("settings.language.label")} description={t("settings.layout.languageHint")}>
          <div className="settings-select">
            <CustomSelect
              id="settings-language-select"
              ariaLabel={t("settings.language.label")}
              value={lang}
              onChange={(next) => setLang(next as Language)}
              options={LANGUAGES.map((entry) => ({ value: entry.code, label: entry.nativeName }))}
            />
          </div>
        </SettingsRow>
      </SettingsSection>
      <SettingsSection title={t("settings.layout.application")}>
        <SettingsRow label={t("settings.general.version")} description={versionDescription}>
          <UpdateControl update={update} />
        </SettingsRow>
      </SettingsSection>
    </>
  );
}

/* ── Profile & account ── */

function ProfileSettings({ user, onUserUpdated }: SettingsPageProps) {
  const { t } = useI18n();
  const [username, setUsername] = useState(user?.displayName ?? "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [avatarBusy, setAvatarBusy] = useState(false);

  useEffect(() => {
    setUsername(user?.displayName ?? "");
    setError(null);
  }, [user]);

  async function handleSave(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextUsername = username.trim();
    if (!user || !nextUsername || saving) return;
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const token = await getToken();
      if (!token) throw new Error(t("settings.profile.signInAgain"));
      const updated = await api.updateProfile(nextUsername, token);
      onUserUpdated(updated);
      setUsername(updated.displayName);
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2500);
    } catch (error_) {
      setError(error_ instanceof Error ? error_.message : t("settings.profile.updateFailed"));
    } finally {
      setSaving(false);
    }
  }

  if (!user) {
    return (
      <SettingsSection title={t("settings.layout.profile")}>
        <SettingsRow label={t("settings.profile.fallbackName")} description={t("settings.profile.signInHint")} />
      </SettingsSection>
    );
  }

  function focusAvatarUpload() {
    document.querySelector<HTMLInputElement>(".settings-profile .icon-upload-drop input[type=file]")?.click();
  }

  return (
    <form className="settings-profile" onSubmit={(event) => void handleSave(event)}>
      <SettingsSection
        title={t("settings.layout.profile")}
        footer={<>
          <button type="submit" className="primary-button" disabled={saving || !username.trim()}>
            {saving ? t("settings.common.saving") : t("settings.profile.save")}
          </button>
          {saved && <span className="settings-saved" role="status">{t("settings.common.saved")}</span>}
          {error && <p className="settings-error" role="alert">{error}</p>}
        </>}
      >
        <div className="settings-row settings-profile-summary">
          <EditableAvatar
            person={{ id: user.id, name: user.displayName || user.email, avatarUrl: user.avatarUrl }}
            canEdit
            label={t("settings.profile.avatarLabel")}
            className="settings-profile-avatar-wrap"
            avatarClassName="settings-profile-avatar"
            onOpen={focusAvatarUpload}
          />
          <div>
            <strong>{user.displayName || t("settings.profile.fallbackName")}</strong>
            <span>{user.email}</span>
          </div>
        </div>
        <SettingsRow label={t("settings.profile.photoLabel")} description={t("settings.layout.photoHint")}>
          <IconUpload
            currentIcon={user.avatarUrl || "user"}
            fallback="user"
            disabled={avatarBusy}
            onBusyChange={setAvatarBusy}
            onUploaded={(avatarUrl) => onUserUpdated({ ...user, avatarUrl })}
          />
        </SettingsRow>
        <SettingsRow label={t("settings.profile.usernameLabel")} description={t("settings.layout.usernameHint")} htmlFor="settings-username">
          <div className="field settings-field">
            <input
              id="settings-username"
              value={username}
              onChange={(event) => { setUsername(event.target.value); setSaved(false); setError(null); }}
              minLength={1}
              maxLength={80}
              required
              autoComplete="nickname"
              placeholder={t("settings.profile.usernamePlaceholder")}
            />
          </div>
        </SettingsRow>
      </SettingsSection>
    </form>
  );
}

/* ── Prior Agent ── */

function AssistantSettings() {
  const { t } = useI18n();
  const [apiKey, setApiKey] = useState(() => getAgentSettings().apiKey);
  const [transcriptionApiKey, setTranscriptionApiKey] = useState(() => getAgentSettings().transcriptionApiKey);
  const [provider, setProvider] = useState<AgentProvider>(() => getAgentSettings().provider ?? "openrouter");
  const [showOpenRouterKey, setShowOpenRouterKey] = useState(false);
  const [showTranscriptionKey, setShowTranscriptionKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const settingsDirtyRef = useRef(false);

  // The key follows the account: pull the shared copy when signed in.
  useEffect(() => {
    let live = true;
    void getToken()
      .catch(() => null)
      .then(async (token) => {
        if (!live || !token) return;
        if (await pullAssistantSettings()) {
          if (!live) return;
          if (settingsDirtyRef.current) {
            return;
          }
          const current = getAgentSettings();
          setApiKey(current.apiKey);
          setTranscriptionApiKey(current.transcriptionApiKey);
          setProvider(current.provider ?? "openrouter");
        }
      });
    return () => { live = false; };
  }, []);

  async function handleSaveKeys() {
    if (saving) return;
    setSaving(true);
    const current = getAgentSettings();
    const updated = { ...current, apiKey: apiKey.trim(), transcriptionApiKey: transcriptionApiKey.trim() };
    saveAgentSettings(updated);
    settingsDirtyRef.current = false;
    notifyAgentSettingsChanged();
    await pushAssistantSettings(undefined, updated);
    setSaved(true);
    setSaving(false);
    window.setTimeout(() => setSaved(false), 2500);
  }

  function handleProviderChange(next: AgentProvider) {
    const current = getAgentSettings();
    const updated = { ...current, provider: next };
    setProvider(next);
    saveAgentSettings(updated);
    notifyAgentSettingsChanged();
  }

  return (
    <div className="settings-assistant">
      {supportsCodexDesktop() && <CodexSettings provider={provider} onProviderChange={handleProviderChange} />}
      <SettingsSection
        title={t("settings.layout.apiKeys")}
        footer={<>
          <button type="button" className="primary-button" onClick={() => void handleSaveKeys()} disabled={saving}>
            {saving ? t("settings.common.saving") : t("settings.assistant.saveKeys")}
          </button>
          {saved && <span className="settings-saved" role="status">{t("settings.common.saved")}</span>}
        </>}
      >
        <SettingsRow
          stacked
          htmlFor="settings-openrouter-key"
          label={t("settings.assistant.openRouterLabel")}
          description={<>
            {t("settings.assistant.openRouterPrefix")}{" "}
            <a href="https://openrouter.ai/keys" target="_blank" rel="noopener noreferrer">openrouter.ai/keys</a>
            {t("settings.assistant.openRouterSuffix")}
          </>}
        >
          <div className="field settings-field">
            <Icon name="lock" />
            <input
              id="settings-openrouter-key"
              type={showOpenRouterKey ? "text" : "password"}
              placeholder={t("settings.assistant.openRouterPlaceholder")}
              value={apiKey}
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => { settingsDirtyRef.current = true; setApiKey(event.target.value); setSaved(false); }}
            />
            <button type="button" className="show-key-btn" aria-pressed={showOpenRouterKey} onClick={() => setShowOpenRouterKey((value) => !value)}>
              {showOpenRouterKey ? t("settings.assistant.hide") : t("settings.assistant.show")}
            </button>
          </div>
        </SettingsRow>
        <SettingsRow
          stacked
          htmlFor="settings-transcription-key"
          label={t("settings.assistant.transcriptionLabel")}
          description={<>
            {t("settings.assistant.openRouterPrefix")}{" "}
            <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener noreferrer">platform.openai.com/api-keys</a>
            {t("settings.assistant.transcriptionSuffix")}
          </>}
        >
          <div className="field settings-field">
            <Icon name="microphone" />
            <input
              id="settings-transcription-key"
              type={showTranscriptionKey ? "text" : "password"}
              placeholder={t("settings.assistant.transcriptionPlaceholder")}
              value={transcriptionApiKey}
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => { settingsDirtyRef.current = true; setTranscriptionApiKey(event.target.value); setSaved(false); }}
            />
            <button type="button" className="show-key-btn" aria-pressed={showTranscriptionKey} onClick={() => setShowTranscriptionKey((value) => !value)}>
              {showTranscriptionKey ? t("settings.assistant.hide") : t("settings.assistant.show")}
            </button>
          </div>
        </SettingsRow>
      </SettingsSection>
    </div>
  );
}

type CodexSettingsProps = {
  readonly provider: AgentProvider;
  readonly onProviderChange: (provider: AgentProvider) => void;
};

function CodexSettings({ provider, onProviderChange }: CodexSettingsProps) {
  const { t } = useI18n();
  const [account, setAccount] = useState<CodexAccount | null>(null);
  const [binaryAvailable, setBinaryAvailable] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    // Lazy: cheap PATH probe + localStorage cache only. Never spawn the
    // Codex server here; the server starts only on Connect click.
    void (async () => {
      try {
        if (!supportsCodexDesktop()) {
          if (!live) return;
          setBinaryAvailable(false);
          setAccount({
            available: false,
            authenticated: false,
            authMode: null,
            planType: null,
            email: null,
            error: null,
          });
          return;
        }
        const status = await codexBinaryAvailable();
        if (!live) return;
        setBinaryAvailable(status.available);
        if (!status.available) {
          setAccount({
            available: false,
            authenticated: false,
            authMode: null,
            planType: null,
            email: null,
            error: t("settings.codex.unavailable"),
          });
          return;
        }
        const cached = getCachedCodexAccount();
        if (cached) {
          setAccount(cached);
          setError(null);
        } else {
          // Binary present but no fresh login proof: show "Not connected"
          // without spawning the server.
          setAccount({
            available: true,
            authenticated: false,
            authMode: null,
            planType: null,
            email: null,
            error: null,
          });
        }
      } catch (error_) {
        if (live) setError(error_ instanceof Error ? error_.message : t("settings.codex.notAvailable"));
      } finally {
        if (live) setLoading(false);
      }
    })();
    return () => { live = false; };
  }, []);

  async function handleConnect() {
    if (connecting) return;
    setConnecting(true);
    setError(null);
    try {
      const login = await startCodexLogin();
      const next = await waitForCodexLogin(login.loginId);
      setCachedCodexAccount(next);
      setAccount(next);
      onProviderChange("codex");
    } catch (error_) {
      setError(error_ instanceof Error ? error_.message : t("settings.codex.connectFailed"));
    } finally {
      setConnecting(false);
    }
  }

  async function handleDisconnect() {
    if (connecting) return;
    setConnecting(true);
    setError(null);
    try {
      const next = await logoutCodex();
      clearCachedCodexAccount();
      // Keep a fresh "not connected" placeholder so the UI stays usable
      // without spawning the server again.
      setAccount({ ...next, available: true });
      onProviderChange("openrouter");
    } catch (error_) {
      setError(error_ instanceof Error ? error_.message : t("settings.codex.disconnectFailed"));
    } finally {
      setConnecting(false);
    }
  }

  const chatGptConnected = account?.authMode === "chatgpt";
  const planName = account?.planType ? `${account.planType[0].toUpperCase()}${account.planType.slice(1)}` : null;
  const accountLabel = planName ? t("settings.codex.planLabel", { plan: planName }) : t("settings.codex.fallbackAccount");
  const unavailable = !loading && (binaryAvailable === false || !account?.available);
  const title = <span className="settings-row-title">{t("settings.codex.fallbackAccount")}<span className="settings-badge">{t("settings.codex.beta")}</span></span>;

  let status: ReactNode = null;
  if (loading) status = <span className="settings-row-note">{t("settings.codex.checking")}</span>;
  else if (unavailable) status = <>
    <span className="settings-row-note is-error">{error || t("settings.codex.unavailable")}</span>
    <span className="settings-row-note">{t("settings.codex.installPrefix")}<code>codex</code>{t("settings.codex.installSuffix")}</span>
  </>;
  else if (account) status = <>
    <span className={`settings-connection ${chatGptConnected ? "is-connected" : ""}`}>
      <span className="settings-status-dot" aria-hidden="true" />
      {chatGptConnected ? t("settings.codex.connected", { account: accountLabel }) : t("settings.codex.notConnected")}
    </span>
    <span className="settings-row-note">{chatGptConnected ? (account.email || t("settings.codex.emailFallback")) : account.authMode === "apikey" ? t("settings.codex.apiKeyNote") : t("settings.codex.connectHint")}</span>
  </>;
  const description = <>{t("settings.codex.description")}{status}</>;

  return (
    <SettingsSection title="Codex">
      <SettingsRow label={title} description={description}>
        {!loading && !unavailable && (chatGptConnected ? (
          <button type="button" className="secondary-button settings-danger-text" onClick={() => void handleDisconnect()} disabled={connecting}>{t("settings.codex.disconnect")}</button>
        ) : (
          <button type="button" className="secondary-button" onClick={() => void handleConnect()} disabled={connecting}>
            {connecting ? t("settings.codex.waiting") : t("settings.codex.connect")}
          </button>
        ))}
      </SettingsRow>
      {!loading && !unavailable && chatGptConnected && (
        <SettingsRow label={t("settings.codex.useTitle")} description={t("settings.codex.useHint")}>
          <button
            type="button"
            role="switch"
            className="settings-switch"
            aria-checked={provider === "codex"}
            aria-label={t("settings.codex.useTitle")}
            onClick={() => onProviderChange(provider === "codex" ? "openrouter" : "codex")}
          />
        </SettingsRow>
      )}
      {error && account?.available && <div className="settings-row"><p className="settings-error" role="alert">{error}</p></div>}
    </SettingsSection>
  );
}

/* ── Diagnostics ── */

function DiagnosticsSettings() {
  const { t } = useI18n();
  const [logs, setLogs] = useState(() => logger.getEntries());
  const [showLogs, setShowLogs] = useState(false);
  const [copied, setCopied] = useState(false);
  const [syncState, setSyncState] = useState<{ revision: number; pendingCount: number } | null>(null);

  useEffect(() => {
    return logger.subscribe(() => {
      setLogs(logger.getEntries());
    });
  }, []);

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const [state, pending] = await Promise.all([
          localStore.getSyncState(),
          localStore.pendingMutations(),
        ]);
        if (live) {
          setSyncState({
            revision: state.lastServerRevision,
            pendingCount: pending.length,
          });
        }
      } catch {
        // Safe to ignore in settings preview
      }
    })();
    return () => { live = false; };
  }, []);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(logger.getLogText());
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard can be unavailable (permissions, insecure context).
    }
  }

  function handleClear() {
    logger.clear();
    setLogs([]);
  }

  return (
    <>
      <SettingsSection title={t("settings.layout.sync")}>
        <SettingsRow
          label={t("settings.layout.syncState")}
          description={syncState
            ? <span className="settings-mono">{t("settings.diagnostics.lastSyncRevision", { revision: syncState.revision })} · {t("settings.diagnostics.pendingMutations", { count: syncState.pendingCount })}</span>
            : t("settings.layout.syncStateHint")}
        />
      </SettingsSection>
      <SettingsSection title={t("settings.layout.logs")}>
        <SettingsRow label={t("settings.layout.logFile")} description={t("settings.diagnostics.description")}>
          <div className="settings-inline-actions">
            <button type="button" className="secondary-button" onClick={() => void logger.openLogFile()}>
              <Icon name="download" />{t("settings.diagnostics.downloadLog")}
            </button>
            <button type="button" className="secondary-button" onClick={() => void handleCopy()}>
              <Icon name="clipboard" />{copied ? t("settings.diagnostics.copied") : t("settings.diagnostics.copyLogs")}
            </button>
          </div>
        </SettingsRow>
        <SettingsRow label={t("settings.layout.recentLogs")} stacked={showLogs}>
          <div className="settings-inline-actions">
            {logs.length > 0 && (
              <button type="button" className="secondary-button settings-danger-text" onClick={handleClear}>
                {t("settings.diagnostics.clearLogs")}
              </button>
            )}
            <button type="button" className="secondary-button" aria-expanded={showLogs} aria-controls="settings-log-viewer" onClick={() => setShowLogs((value) => !value)}>
              {showLogs ? t("settings.diagnostics.hideLogs") : t("settings.diagnostics.showLogs", { count: logs.length })}
            </button>
          </div>
          {showLogs && (
            <div id="settings-log-viewer" className="settings-diagnostics-viewer" role="region" aria-label={t("settings.layout.recentLogs")}>
              {logs.length === 0 ? (
                <p className="settings-diagnostics-empty">{t("settings.diagnostics.empty")}</p>
              ) : (
                <pre className="settings-diagnostics-logs">
                  {logs.slice(-50).map((log) => (
                    <div key={log.id} className={`settings-log-line settings-log-${log.level}`}>
                      <span className="settings-log-time">{log.timestamp.slice(11, 19)}</span>
                      <span className="settings-log-level">[{log.level.toUpperCase()}]</span>
                      <span className="settings-log-cat">[{log.category}]</span>
                      <span className="settings-log-msg">{log.message}</span>
                      {log.details && <span className="settings-log-data"> {log.details}</span>}
                    </div>
                  ))}
                </pre>
              )}
            </div>
          )}
        </SettingsRow>
      </SettingsSection>
    </>
  );
}

/* ── Developer (dev builds only) ── */

function DeveloperSettings() {
  const { t, tp } = useI18n();
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(action: "load" | "reset") {
    if (busy) return;
    setBusy(true);
    setStatus(null);
    try {
      const seed = await import("../lib/devSeed");
      if (action === "reset") {
        await seed.clearDevSeedData({ dev: true });
      }
      const result = await seed.seedDevDataIfEmpty({ dev: true, force: true, requireAnonymous: false });
      if (result.seeded) {
        setStatus(t("settings.devSeed.ready", {
          tasks: tp("settings.devSeed.tasks", result.tasks),
          projects: tp("settings.devSeed.projects", result.projects),
        }));
        window.setTimeout(() => window.location.reload(), 600);
      } else {
        setStatus(t("settings.devSeed.skipped", { reason: result.reason }));
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : t("settings.devSeed.loadFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <SettingsSection title={t("settings.layout.demoData")}>
      <SettingsRow
        label={<span className="settings-row-title">{t("settings.devSeed.title")}<span className="settings-badge">{t("settings.devSeed.badge")}</span></span>}
        description={<>
          {t("settings.devSeed.description")}
          {status && <span className="settings-row-note" role="status">{status}</span>}
        </>}
      >
        <div className="settings-inline-actions">
          <button type="button" className="secondary-button" disabled={busy} onClick={() => void run("reset")}>
            {t("settings.devSeed.reset")}
          </button>
          <button type="button" className="secondary-button" disabled={busy} onClick={() => void run("load")}>
            {busy ? t("settings.devSeed.loading") : t("settings.devSeed.load")}
          </button>
        </div>
      </SettingsRow>
    </SettingsSection>
  );
}

/* ── Page ── */

const TABS: ReadonlyArray<{ readonly id: SettingsTab; readonly icon: IconName; readonly devOnly?: boolean }> = [
  { id: "general", icon: "sliders" },
  { id: "profile", icon: "user" },
  { id: "assistant", icon: "sparkles" },
  { id: "diagnostics", icon: "terminal" },
  { id: "developer", icon: "database", devOnly: true },
];

export function SettingsPage({ user, onUserUpdated }: SettingsPageProps) {
  const { t } = useI18n();
  const [tab, setTab] = useState<SettingsTab>("general");
  const tabRefs = useRef(new Map<SettingsTab, HTMLButtonElement>());
  const tabs = TABS.filter((entry) => !entry.devOnly || import.meta.env.DEV);

  function handleTabKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    const index = tabs.findIndex((entry) => entry.id === tab);
    let next = index;
    if (event.key === "ArrowDown" || event.key === "ArrowRight") next = (index + 1) % tabs.length;
    else if (event.key === "ArrowUp" || event.key === "ArrowLeft") next = (index - 1 + tabs.length) % tabs.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = tabs.length - 1;
    else return;
    event.preventDefault();
    const target = tabs[next].id;
    setTab(target);
    tabRefs.current.get(target)?.focus();
  }

  return (
    <section className="settings-page" aria-labelledby="settings-page-title">
      <header className="settings-header">
        <h1 id="settings-page-title">{t("common.views.settings")}</h1>
      </header>
      <div className="settings-layout">
        <div className="settings-nav" role="tablist" aria-orientation="vertical" aria-label={t("settings.page.sectionsLabel")}>
          {tabs.map((entry) => (
            <button
              key={entry.id}
              ref={(node) => { if (node) tabRefs.current.set(entry.id, node); else tabRefs.current.delete(entry.id); }}
              type="button"
              role="tab"
              id={`settings-tab-${entry.id}`}
              aria-selected={tab === entry.id}
              aria-controls={`settings-panel-${entry.id}`}
              tabIndex={tab === entry.id ? 0 : -1}
              className={`settings-nav-item ${tab === entry.id ? "active" : ""}`}
              onClick={() => setTab(entry.id)}
              onKeyDown={handleTabKeyDown}
            >
              <Icon name={entry.icon} />
              <span>{t(`settings.tabs.${entry.id}`)}</span>
            </button>
          ))}
        </div>
        <div className="settings-panel" role="tabpanel" id={`settings-panel-${tab}`} aria-labelledby={`settings-tab-${tab}`}>
          {tab === "general" && <GeneralSettings />}
          {tab === "profile" && <ProfileSettings user={user} onUserUpdated={onUserUpdated} />}
          {tab === "assistant" && <AssistantSettings />}
          {tab === "diagnostics" && <DiagnosticsSettings />}
          {tab === "developer" && <DeveloperSettings />}
        </div>
      </div>
    </section>
  );
}
