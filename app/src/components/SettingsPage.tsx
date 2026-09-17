import { useEffect, useState } from "react";
import { getAgentSettings, notifyAgentSettingsChanged, saveAgentSettings } from "../lib/ai";
import { getToken, type SessionUser } from "../lib/auth";
import { api } from "../lib/api";
import { pullAssistantSettings, pushAssistantSettings } from "../lib/settingsSync";
import { getAndroidAppVersion, supportsAndroidUpdates } from "../lib/androidUpdater";
import { getAppVersion, supportsDesktopUpdates } from "../lib/updater";
import { UpdateCards } from "./UpdateCards";
import { Icon } from "./Icon";
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
    </div>
  );
}

function ProfileSettings({ user, onUserUpdated }: SettingsPageProps) {
  const [username, setUsername] = useState(user?.displayName ?? "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <form className="settings-profile" onSubmit={(event) => void handleSave(event)}>
      <div className="settings-profile-summary">
        <div className="settings-profile-avatar">
          {user.avatarUrl ? <img src={user.avatarUrl} alt="" /> : <Icon name="user" />}
        </div>
        <div>
          <strong>{user.displayName || "Prior account"}</strong>
          <span>{user.email}</span>
        </div>
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
  const [webSearch, setWebSearch] = useState(() => getAgentSettings().webSearch !== false);
  const [showKey, setShowKey] = useState(false);
  const [saved, setSaved] = useState(false);
  const [synced, setSynced] = useState(false);

  // The key follows the account: pull the shared copy when signed in.
  useEffect(() => {
    let live = true;
    void getToken()
      .catch(() => null)
      .then(async (token) => {
        if (!live || !token) return;
        if (await pullAssistantSettings()) {
          if (!live) return;
          const current = getAgentSettings();
          setApiKey(current.apiKey);
          setWebSearch(current.webSearch !== false);
          setSynced(true);
        }
      });
    return () => { live = false; };
  }, []);

  function handleSaveKey() {
    const current = getAgentSettings();
    saveAgentSettings({ ...current, apiKey: apiKey.trim() });
    notifyAgentSettingsChanged();
    void pushAssistantSettings();
    setSaved(true);
    window.setTimeout(() => setSaved(false), 2500);
  }

  function handleWebSearch(checked: boolean) {
    setWebSearch(checked);
    const current = getAgentSettings();
    saveAgentSettings({ ...current, webSearch: checked });
    notifyAgentSettingsChanged();
    void pushAssistantSettings();
  }

  return (
    <div className="settings-assistant">
      <label className="settings-page-field">
        <span>OpenRouter API key</span>
        <div className="field">
          <Icon name="lock" />
          <input
            type={showKey ? "text" : "password"}
            placeholder="sk-or-v1-..."
            value={apiKey}
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => { setApiKey(event.target.value); setSaved(false); }}
          />
          <button type="button" className="show-key-btn" onClick={() => setShowKey((value) => !value)}>
            {showKey ? "Hide" : "Show"}
          </button>
        </div>
        <small className="settings-help">
          Get a key at{" "}
          <a href="https://openrouter.ai/keys" target="_blank" rel="noopener noreferrer">
            openrouter.ai/keys
          </a>
          . It stays on this device.
        </small>
      </label>
      <div className="settings-page-row">
        <button type="button" className="primary-button" onClick={handleSaveKey}>
          Save key
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
