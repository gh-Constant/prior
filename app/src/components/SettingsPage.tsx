import { useEffect, useState } from "react";
import { getAgentSettings, notifyAgentSettingsChanged, saveAgentSettings } from "../lib/ai";
import { getAndroidAppVersion, supportsAndroidUpdates } from "../lib/androidUpdater";
import { getAppVersion, supportsDesktopUpdates } from "../lib/updater";
import { UpdateCards } from "./UpdateCards";
import { Icon } from "./Icon";
import "./SettingsPage.css";

type SettingsTab = "general" | "assistant";

function GeneralSettings() {
  const [version, setVersion] = useState<string | null>(null);

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
    })();
    return () => { live = false; };
  }, []);

  return (
    <div className="settings-general">
      <div className="settings-version-row">
        <span>Version</span>
        <strong>{version ? `v${version}` : "Web app"}</strong>
      </div>
      <UpdateCards />
    </div>
  );
}

function AssistantSettings() {
  const [apiKey, setApiKey] = useState(() => getAgentSettings().apiKey);
  const [webSearch, setWebSearch] = useState(() => getAgentSettings().webSearch !== false);
  const [showKey, setShowKey] = useState(false);
  const [saved, setSaved] = useState(false);

  function handleSaveKey() {
    const current = getAgentSettings();
    saveAgentSettings({ ...current, apiKey: apiKey.trim() });
    notifyAgentSettingsChanged();
    setSaved(true);
    window.setTimeout(() => setSaved(false), 2500);
  }

  function handleWebSearch(checked: boolean) {
    setWebSearch(checked);
    const current = getAgentSettings();
    saveAgentSettings({ ...current, webSearch: checked });
    notifyAgentSettingsChanged();
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
      <p className="settings-hint">Choose the model directly in the Prior Agent sidebar — no dialog needed.</p>
    </div>
  );
}

export function SettingsPage() {
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
          aria-selected={tab === "assistant"}
          className={tab === "assistant" ? "active" : ""}
          onClick={() => setTab("assistant")}
        >
          Assistant
        </button>
      </div>
      <section className="settings-card" aria-label={tab === "general" ? "General" : "Assistant"}>
        {tab === "general" ? <GeneralSettings /> : <AssistantSettings />}
      </section>
    </section>
  );
}
