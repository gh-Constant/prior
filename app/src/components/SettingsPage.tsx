import { useEffect, useRef, useState } from "react";
import { getAgentSettings, notifyAgentSettingsChanged, saveAgentSettings } from "../lib/ai";
import { clearCachedCodexAccount, codexBinaryAvailable, getCachedCodexAccount, logoutCodex, setCachedCodexAccount, startCodexLogin, supportsCodexDesktop, waitForCodexLogin, type CodexAccount } from "../lib/codex";
import type { AgentProvider } from "../types";
import { getToken, type SessionUser } from "../lib/auth";
import { api } from "../lib/api";
import { pullAssistantSettings, pushAssistantSettings } from "../lib/settingsSync";
import { getAndroidAppVersion, supportsAndroidUpdates } from "../lib/androidUpdater";
import { getAppVersion, supportsDesktopUpdates } from "../lib/updater";
import { UpdateCards } from "./UpdateCards";
import { Icon } from "./Icon";
import { LANGUAGES, useI18n, type Language } from "../lib/i18n";
import { EditableAvatar, IconUpload } from "./IconPicker";
import { CustomSelect } from "./CustomSelect";
import { logger } from "../lib/logger";
import { localStore } from "../lib/localStore";
import "./SettingsPage.css";

type SettingsTab = "general" | "profile" | "assistant";

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

function DevSeedPanel() {
  if (!import.meta.env.DEV) return null;
  return <DevSeedPanelInner />;
}

function DevSeedPanelInner() {
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
    <section className="settings-codex" aria-label={t("settings.devSeed.ariaLabel")}>
      <div className="settings-codex-heading">
        <div className="settings-codex-icon"><Icon name="sparkles" /></div>
        <div>
          <div className="settings-codex-title"><strong>{t("settings.devSeed.title")}</strong><span>{t("settings.devSeed.badge")}</span></div>
          <p>{t("settings.devSeed.description")}</p>
        </div>
      </div>
      <div className="settings-page-row">
        <button type="button" className="secondary-button" disabled={busy} onClick={() => void run("load")}>
          {busy ? t("settings.devSeed.loading") : t("settings.devSeed.load")}
        </button>
        <button type="button" className="secondary-button" disabled={busy} onClick={() => void run("reset")}>
          {t("settings.devSeed.reset")}
        </button>
      </div>
      {status && <p className="settings-hint" role="status">{status}</p>}
    </section>
  );
}

function DiagnosticsPanel() {
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
      // Fallback
    }
  }

  function handleDownload() {
    void logger.openLogFile();
  }

  function handleClear() {
    logger.clear();
    setLogs([]);
  }

  return (
    <section className="settings-diagnostics" aria-label={t("settings.diagnostics.title")}>
      <div className="settings-diagnostics-heading">
        <div className="settings-diagnostics-icon"><Icon name="terminal" /></div>
        <div>
          <div className="settings-diagnostics-title">
            <strong>{t("settings.diagnostics.title")}</strong>
          </div>
          <p>{t("settings.diagnostics.description")}</p>
        </div>
      </div>

      {syncState && (
        <div className="settings-diagnostics-meta">
          <span>{t("settings.diagnostics.lastSyncRevision", { revision: syncState.revision })}</span>
          <span>{t("settings.diagnostics.pendingMutations", { count: syncState.pendingCount })}</span>
        </div>
      )}

      <div className="settings-page-row">
        <button type="button" className="secondary-button" onClick={handleDownload}>
          <Icon name="download" /> {t("settings.diagnostics.downloadLog")}
        </button>
        <button type="button" className="secondary-button" onClick={() => void handleCopy()}>
          <Icon name="clipboard" /> {copied ? t("settings.diagnostics.copied") : t("settings.diagnostics.copyLogs")}
        </button>
        {logs.length > 0 && (
          <button type="button" className="secondary-button settings-diagnostics-clear" onClick={handleClear}>
            {t("settings.diagnostics.clearLogs")}
          </button>
        )}
      </div>

      <div className="settings-diagnostics-viewer-toggle">
        <button
          type="button"
          onClick={() => setShowLogs(!showLogs)}
        >
          {showLogs
            ? t("settings.diagnostics.hideLogs")
            : t("settings.diagnostics.showLogs", { count: logs.length })}
        </button>
      </div>

      {showLogs && (
        <div className="settings-diagnostics-viewer" role="region" aria-label="Recent Logs">
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
    </section>
  );
}

function GeneralSettings() {
  const { t, lang, setLang } = useI18n();
  const [version, setVersion] = useState<string | null>(null);
  const [latest, setLatest] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const detected = supportsDesktopUpdates()
          ? await getAppVersion()
          : supportsAndroidUpdates()
            ? await getAndroidAppVersion()
            : null;
        if (live) setVersion(detected);
      } catch {
        if (live) setVersion(null);
      }
      // Web builds have no bundled version: show the latest published one.
      if (live && !supportsDesktopUpdates() && !supportsAndroidUpdates()) {
        setLatest(await fetchLatestReleaseVersion());
      }
    })();
    return () => { live = false; };
  }, []);

  const versionLabel = version ? `v${version}` : latest ?? t("settings.general.webApp");
  return (
    <div className="settings-general">
      <div className="settings-version-row">
        <label htmlFor="settings-language-select">{t("settings.language.label")}</label>
        <div className="settings-language-select-wrap">
          <CustomSelect
            id="settings-language-select"
            ariaLabel={t("settings.language.label")}
            value={lang}
            onChange={(next) => setLang(next as Language)}
            options={LANGUAGES.map((entry) => ({ value: entry.code, label: entry.nativeName }))}
          />
        </div>
      </div>
      <div className="settings-version-row">
        <span>{t("settings.general.version")}</span>
        <strong>{versionLabel}{!version && latest ? t("settings.general.latestSuffix") : ""}</strong>
      </div>
      <UpdateCards />
      <DiagnosticsPanel />
      <DevSeedPanel />
    </div>
  );
}

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
    return <p className="settings-hint">{t("settings.profile.signInHint")}</p>;
  }

  function focusAvatarUpload() {
    document.querySelector<HTMLInputElement>(".settings-profile .icon-upload-drop input[type=file]")?.click();
  }

  return (
    <form className="settings-profile" onSubmit={(event) => void handleSave(event)}>
      <div className="settings-profile-summary">
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
      <div className="settings-page-field">
        <span>{t("settings.profile.photoLabel")}</span>
        <IconUpload
          currentIcon={user.avatarUrl || "user"}
          fallback="user"
          disabled={avatarBusy}
          onBusyChange={setAvatarBusy}
          onUploaded={(avatarUrl) => onUserUpdated({ ...user, avatarUrl })}
        />
      </div>
      <label className="settings-page-field">
        <span>{t("settings.profile.usernameLabel")}</span>
        <div className="field">
          <Icon name="user" />
          <input
            value={username}
            onChange={(event) => { setUsername(event.target.value); setSaved(false); setError(null); }}
            minLength={1}
            maxLength={80}
            required
            autoComplete="nickname"
            placeholder={t("settings.profile.usernamePlaceholder")}
          />
        </div>
      </label>
      <div className="settings-page-row">
        <button type="submit" className="primary-button" disabled={saving || !username.trim()}>
          {saving ? t("settings.common.saving") : t("settings.profile.save")}
        </button>
        {saved && <span className="settings-saved" role="status">{t("settings.common.saved")}</span>}
      </div>
      {error && <p className="settings-error" role="alert">{error}</p>}
    </form>
  );
}

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
      <label className="settings-page-field">
        <span>{t("settings.assistant.openRouterLabel")}</span>
        <div className="field">
          <Icon name="lock" />
          <input
            type={showOpenRouterKey ? "text" : "password"}
            placeholder={t("settings.assistant.openRouterPlaceholder")}
            value={apiKey}
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => { settingsDirtyRef.current = true; setApiKey(event.target.value); setSaved(false); }}
          />
          <button type="button" className="show-key-btn" onClick={() => setShowOpenRouterKey((value) => !value)}>
            {showOpenRouterKey ? t("settings.assistant.hide") : t("settings.assistant.show")}
          </button>
        </div>
        <small className="settings-help">
          {t("settings.assistant.openRouterPrefix")}{" "}
          <a href="https://openrouter.ai/keys" target="_blank" rel="noopener noreferrer">
            openrouter.ai/keys
          </a>
          {t("settings.assistant.openRouterSuffix")}
        </small>
      </label>
      <label className="settings-page-field">
        <span>{t("settings.assistant.transcriptionLabel")}</span>
        <div className="field">
          <Icon name="microphone" />
          <input
            type={showTranscriptionKey ? "text" : "password"}
            placeholder={t("settings.assistant.transcriptionPlaceholder")}
            value={transcriptionApiKey}
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => { settingsDirtyRef.current = true; setTranscriptionApiKey(event.target.value); setSaved(false); }}
          />
          <button type="button" className="show-key-btn" onClick={() => setShowTranscriptionKey((value) => !value)}>
            {showTranscriptionKey ? t("settings.assistant.hide") : t("settings.assistant.show")}
          </button>
        </div>
        <small className="settings-help">
          {t("settings.assistant.openRouterPrefix")}{" "}
          <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener noreferrer">
            platform.openai.com/api-keys
          </a>
          {t("settings.assistant.transcriptionSuffix")}
        </small>
      </label>
      <div className="settings-page-row">
        <button type="button" className="primary-button" onClick={() => void handleSaveKeys()} disabled={saving}>
          {saving ? t("settings.common.saving") : t("settings.assistant.saveKeys")}
        </button>
        {saved && <span className="settings-saved" role="status">{t("settings.common.saved")}</span>}
      </div>
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
        const cached = getCachedCodexAccount();        if (cached) {
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

  return (
    <section className="settings-codex" aria-label={t("settings.codex.sectionLabel")}>
      <div className="settings-codex-heading">
        <div className="settings-codex-icon"><Icon name="sparkles" /></div>
        <div>
          <div className="settings-codex-title"><strong>Codex</strong><span>{t("settings.codex.beta")}</span></div>
          <p>{t("settings.codex.description")}</p>
        </div>
      </div>

      {loading ? (
        <p className="settings-codex-status">{t("settings.codex.checking")}</p>
      ) : binaryAvailable === false || !account?.available ? (
        <div className="settings-codex-unavailable">
          <p>{error || t("settings.codex.unavailable")}</p>
          <small>{t("settings.codex.installPrefix")}<code>codex</code>{t("settings.codex.installSuffix")}</small>
        </div>
      ) : (
        <>
          <div className={`settings-codex-connection ${chatGptConnected ? "connected" : ""}`}>
            <span className="settings-codex-dot" aria-hidden="true" />
            <div>
              <strong>{chatGptConnected ? t("settings.codex.connected", { account: accountLabel }) : t("settings.codex.notConnected")}</strong>
              <small>{chatGptConnected ? (account.email || t("settings.codex.emailFallback")) : account.authMode === "apikey" ? t("settings.codex.apiKeyNote") : t("settings.codex.connectHint")}</small>
            </div>
            {chatGptConnected ? (
              <button type="button" className="text-button settings-codex-disconnect" onClick={() => void handleDisconnect()} disabled={connecting}>{t("settings.codex.disconnect")}</button>
            ) : (
              <button type="button" className="secondary-button settings-codex-connect" onClick={() => void handleConnect()} disabled={connecting}>
                {connecting ? t("settings.codex.waiting") : t("settings.codex.connect")}
              </button>
            )}
          </div>
          {chatGptConnected && (
            <label className="settings-codex-use">
              <input type="checkbox" checked={provider === "codex"} onChange={(event) => onProviderChange(event.target.checked ? "codex" : "openrouter")} />
              <span><strong>{t("settings.codex.useTitle")}</strong><small>{t("settings.codex.useHint")}</small></span>
            </label>
          )}
        </>
      )}
      {error && account?.available && <p className="settings-error" role="alert">{error}</p>}
    </section>
  );
}

export function SettingsPage({ user, onUserUpdated }: SettingsPageProps) {
  const { t } = useI18n();
  const [tab, setTab] = useState<SettingsTab>("general");
  const tabLabel = tab === "general" ? t("settings.tabs.general") : tab === "profile" ? t("settings.tabs.profile") : t("settings.tabs.assistant");
  return (
    <section className="settings-page" aria-label={t("settings.page.ariaLabel")}>
      <div className="workhub-intro">
        <div>
          <p className="eyebrow">{t("settings.page.eyebrow")}</p>
          <h2>{t("settings.page.title")}</h2>
          <p>{t("settings.page.subtitle")}</p>
        </div>
      </div>
      <div className="settings-tabs" role="tablist" aria-label={t("settings.page.sectionsLabel")}>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "general"}
          className={tab === "general" ? "active" : ""}
          onClick={() => setTab("general")}
        >
          {t("settings.tabs.general")}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "profile"}
          className={tab === "profile" ? "active" : ""}
          onClick={() => setTab("profile")}
        >
          {t("settings.tabs.profile")}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "assistant"}
          className={tab === "assistant" ? "active" : ""}
          onClick={() => setTab("assistant")}
        >
          {t("settings.tabs.assistant")}
        </button>
      </div>
      <section className="settings-card" aria-label={tabLabel}>
        {tab === "general" ? <GeneralSettings /> : tab === "profile" ? <ProfileSettings user={user} onUserUpdated={onUserUpdated} /> : <AssistantSettings />}
      </section>
    </section>
  );
}
