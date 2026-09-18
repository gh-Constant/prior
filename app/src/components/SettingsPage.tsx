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
import { EditableAvatar, IconUpload } from "./IconPicker";
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
        setStatus(`Demo data ready (${result.tasks} tasks, ${result.projects} projects). Reloading…`);
        window.setTimeout(() => window.location.reload(), 600);
      } else {
        setStatus(`Demo seed skipped (${result.reason}).`);
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to load demo data.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="settings-codex" aria-label="Demo data (dev only)">
      <div className="settings-codex-heading">
        <div className="settings-codex-icon"><Icon name="sparkles" /></div>
        <div>
          <div className="settings-codex-title"><strong>Demo data</strong><span>Dev only</span></div>
          <p>Loads sample tasks, projects, and icons when local stores are empty. Never runs in production builds.</p>
        </div>
      </div>
      <div className="settings-page-row">
        <button type="button" className="secondary-button" disabled={busy} onClick={() => void run("load")}>
          {busy ? "Loading…" : "Load demo data"}
        </button>
        <button type="button" className="secondary-button" disabled={busy} onClick={() => void run("reset")}>
          Reset demo data
        </button>
      </div>
      {status && <p className="settings-hint" role="status">{status}</p>}
    </section>
  );
}

function GeneralSettings() {
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

  const versionLabel = version ? `v${version}` : latest ?? "Web app";
  return (
    <div className="settings-general">
      <div className="settings-version-row">
        <span>Version</span>
        <strong>{versionLabel}{!version && latest ? " · latest" : ""}</strong>
      </div>
      <UpdateCards />
      <DevSeedPanel />
    </div>
  );
}

function ProfileSettings({ user, onUserUpdated }: SettingsPageProps) {
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
      if (!token) throw new Error("Sign in again to update your profile.");
      const updated = await api.updateProfile(nextUsername, token);
      onUserUpdated(updated);
      setUsername(updated.displayName);
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2500);
    } catch (error_) {
      setError(error_ instanceof Error ? error_.message : "Unable to update your profile.");
    } finally {
      setSaving(false);
    }
  }

  if (!user) {
    return <p className="settings-hint">Sign in to update your profile.</p>;
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
          label="Edit profile photo"
          className="settings-profile-avatar-wrap"
          avatarClassName="settings-profile-avatar"
          onOpen={focusAvatarUpload}
        />
        <div>
          <strong>{user.displayName || "Prior account"}</strong>
          <span>{user.email}</span>
        </div>
      </div>
      <div className="settings-page-field">
        <span>Profile photo</span>
        <IconUpload
          currentIcon={user.avatarUrl || "user"}
          fallback="user"
          disabled={avatarBusy}
          onBusyChange={setAvatarBusy}
          onUploaded={(avatarUrl) => onUserUpdated({ ...user, avatarUrl })}
        />
        <small className="settings-help">Click your photo to change it. Custom photos stay on this device; your Google photo is managed by Google.</small>
      </div>
      <label className="settings-page-field">
        <span>Username</span>
        <div className="field">
          <Icon name="user" />
          <input
            value={username}
            onChange={(event) => { setUsername(event.target.value); setSaved(false); setError(null); }}
            minLength={1}
            maxLength={80}
            required
            autoComplete="nickname"
            placeholder="Your username"
          />
        </div>
        <small className="settings-help">This is the name shown throughout Prior.</small>
      </label>
      <div className="settings-page-row">
        <button type="submit" className="primary-button" disabled={saving || !username.trim()}>
          {saving ? "Saving…" : "Save profile"}
        </button>
        {saved && <span className="settings-saved" role="status">Saved</span>}
      </div>
      {error && <p className="settings-error" role="alert">{error}</p>}
    </form>
  );
}

function AssistantSettings() {
  const [apiKey, setApiKey] = useState(() => getAgentSettings().apiKey);
  const [transcriptionApiKey, setTranscriptionApiKey] = useState(() => getAgentSettings().transcriptionApiKey);
  const [webSearch, setWebSearch] = useState(() => getAgentSettings().webSearch !== false);
  const [provider, setProvider] = useState<AgentProvider>(() => getAgentSettings().provider ?? "openrouter");
  const [showOpenRouterKey, setShowOpenRouterKey] = useState(false);
  const [showTranscriptionKey, setShowTranscriptionKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [synced, setSynced] = useState(false);
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
            setSynced(true);
            return;
          }
          const current = getAgentSettings();
          setApiKey(current.apiKey);
          setTranscriptionApiKey(current.transcriptionApiKey);
          setWebSearch(current.webSearch !== false);
          setProvider(current.provider ?? "openrouter");
          setSynced(true);
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
    const syncedNow = await pushAssistantSettings(undefined, updated);
    setSynced(syncedNow);
    setSaved(true);
    setSaving(false);
    window.setTimeout(() => setSaved(false), 2500);
  }

  function handleWebSearch(checked: boolean) {
    setWebSearch(checked);
    const current = getAgentSettings();
    saveAgentSettings({ ...current, webSearch: checked });
    notifyAgentSettingsChanged();
    void pushAssistantSettings();
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
        <span>OpenRouter API key</span>
        <div className="field">
          <Icon name="lock" />
          <input
            type={showOpenRouterKey ? "text" : "password"}
            placeholder="sk-or-v1-..."
            value={apiKey}
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => { settingsDirtyRef.current = true; setApiKey(event.target.value); setSaved(false); }}
          />
          <button type="button" className="show-key-btn" onClick={() => setShowOpenRouterKey((value) => !value)}>
            {showOpenRouterKey ? "Hide" : "Show"}
          </button>
        </div>
        <small className="settings-help">
          Get a key at{" "}
          <a href="https://openrouter.ai/keys" target="_blank" rel="noopener noreferrer">
            openrouter.ai/keys
          </a>
          . It is saved to your account and available on your signed-in devices.
        </small>
      </label>
      <label className="settings-page-field">
        <span>OpenAI API key for voice transcription</span>
        <div className="field">
          <Icon name="microphone" />
          <input
            type={showTranscriptionKey ? "text" : "password"}
            placeholder="sk-..."
            value={transcriptionApiKey}
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => { settingsDirtyRef.current = true; setTranscriptionApiKey(event.target.value); setSaved(false); }}
          />
          <button type="button" className="show-key-btn" onClick={() => setShowTranscriptionKey((value) => !value)}>
            {showTranscriptionKey ? "Hide" : "Show"}
          </button>
        </div>
        <small className="settings-help">
          Get a key at{" "}
          <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener noreferrer">
            platform.openai.com/api-keys
          </a>
          . It is saved to your account and used only for your voice transcriptions.
        </small>
      </label>
      <div className="settings-page-row">
        <button type="button" className="primary-button" onClick={() => void handleSaveKeys()} disabled={saving}>
          {saving ? "Saving…" : "Save keys"}
        </button>
        {saved && <span className="settings-saved" role="status">Saved</span>}
      </div>
      <label className="settings-search-toggle">
        <input type="checkbox" checked={webSearch} onChange={(event) => handleWebSearch(event.target.checked)} />
        <span>
          <strong>Web search when needed</strong>
          <small>Use it for current or niche information. Search provider costs may apply.</small>
        </span>
      </label>
      <p className="settings-hint">Choose the model directly in the Prior Agent sidebar — no dialog needed.{synced ? " Key synced with your account." : ""}</p>
    </div>
  );
}

type CodexSettingsProps = {
  readonly provider: AgentProvider;
  readonly onProviderChange: (provider: AgentProvider) => void;
};

function CodexSettings({ provider, onProviderChange }: CodexSettingsProps) {
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
            error: "Codex CLI is not available on this desktop.",
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
        if (live) setError(error_ instanceof Error ? error_.message : "Codex is not available.");
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
      setError(error_ instanceof Error ? error_.message : "Unable to connect Codex.");
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
      setError(error_ instanceof Error ? error_.message : "Unable to disconnect Codex.");
    } finally {
      setConnecting(false);
    }
  }

  const chatGptConnected = account?.authMode === "chatgpt";
  const accountLabel = account?.planType ? `${account.planType[0].toUpperCase()}${account.planType.slice(1)} plan` : "ChatGPT account";

  return (
    <section className="settings-codex" aria-label="Codex beta">
      <div className="settings-codex-heading">
        <div className="settings-codex-icon"><Icon name="sparkles" /></div>
        <div>
          <div className="settings-codex-title"><strong>Codex</strong><span>Beta</span></div>
          <p>Use your ChatGPT subscription in the Prior Agent. Tokens stay on this desktop.</p>
        </div>
      </div>

      {loading ? (
        <p className="settings-codex-status">Checking...</p>
      ) : binaryAvailable === false || !account?.available ? (
        <div className="settings-codex-unavailable">
          <p>{error || "Codex CLI is not available on this desktop."}</p>
          <small>Install Codex and make the <code>codex</code> command available, then reopen Settings.</small>
        </div>
      ) : (
        <>
          <div className={`settings-codex-connection ${chatGptConnected ? "connected" : ""}`}>
            <span className="settings-codex-dot" aria-hidden="true" />
            <div>
              <strong>{chatGptConnected ? `Connected · ${accountLabel}` : "Not connected"}</strong>
              <small>{chatGptConnected ? (account.email || "ChatGPT subscription available") : account.authMode === "apikey" ? "Codex is using an API key. Connect with ChatGPT to use subscription quota." : "Connect with ChatGPT to enable Codex."}</small>
            </div>
            {chatGptConnected ? (
              <button type="button" className="text-button settings-codex-disconnect" onClick={() => void handleDisconnect()} disabled={connecting}>Disconnect</button>
            ) : (
              <button type="button" className="secondary-button settings-codex-connect" onClick={() => void handleConnect()} disabled={connecting}>
                {connecting ? "Waiting…" : "Connect"}
              </button>
            )}
          </div>
          {chatGptConnected && (
            <label className="settings-codex-use">
              <input type="checkbox" checked={provider === "codex"} onChange={(event) => onProviderChange(event.target.checked ? "codex" : "openrouter")} />
              <span><strong>Use Codex for Prior Agent</strong><small>Runs locally using your ChatGPT/Codex allowance.</small></span>
            </label>
          )}
        </>
      )}
      {error && account?.available && <p className="settings-error" role="alert">{error}</p>}
    </section>
  );
}

export function SettingsPage({ user, onUserUpdated }: SettingsPageProps) {
  const [tab, setTab] = useState<SettingsTab>("general");
  return (
    <section className="settings-page" aria-label="Settings">
      <div className="workhub-intro">
        <div>
          <p className="eyebrow">WORKSPACE</p>
          <h2>Settings</h2>
          <p>Tune the app and the Prior Agent.</p>
        </div>
      </div>
      <div className="settings-tabs" role="tablist" aria-label="Settings sections">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "general"}
          className={tab === "general" ? "active" : ""}
          onClick={() => setTab("general")}
        >
          General
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "profile"}
          className={tab === "profile" ? "active" : ""}
          onClick={() => setTab("profile")}
        >
          Profile
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "assistant"}
          className={tab === "assistant" ? "active" : ""}
          onClick={() => setTab("assistant")}
        >
          Assistant
        </button>
      </div>
      <section className="settings-card" aria-label={tab === "general" ? "General" : tab === "profile" ? "Profile" : "Assistant"}>
        {tab === "general" ? <GeneralSettings /> : tab === "profile" ? <ProfileSettings user={user} onUserUpdated={onUserUpdated} /> : <AssistantSettings />}
      </section>
    </section>
  );
}
