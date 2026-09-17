import { api, type ServerSettings } from "./api";
import { getAgentSettings, notifyAgentSettingsChanged, saveAgentSettings } from "./ai";
import type { AgentSettings } from "../types";
import { getToken } from "./auth";

// The OpenRouter key lives in the account (server database) so it follows
// the user across devices, with local storage as the offline cache.
// Merge rule: when the server holds a key it wins (shared copy); otherwise
// a local key seeds the server on next push.
export function mergeServerSettings(local: AgentSettings, server: ServerSettings): { merged: AgentSettings; shouldPush: boolean } {
  const merged: AgentSettings = {
    apiKey: server.openrouterApiKey || local.apiKey,
    transcriptionApiKey: server.openaiApiKey || local.transcriptionApiKey,
    model: local.model,
    webSearch: server.webSearch,
  };
  if (local.codexModel !== undefined) merged.codexModel = local.codexModel;
  if (local.provider) merged.provider = local.provider;
  return {
    merged,
    shouldPush: (!server.openrouterApiKey && local.apiKey !== "") || (!server.openaiApiKey && local.transcriptionApiKey !== ""),
  };
}

// Pull the shared settings into the local cache. Returns true when a
// server round-trip succeeded.
export async function pullAssistantSettings(): Promise<boolean> {
  const token = await getToken().catch(() => null);
  if (!token) return false;
  try {
    const server = await api.getSettings(token);
    const { merged, shouldPush } = mergeServerSettings(getAgentSettings(), server);
    saveAgentSettings(merged);
    notifyAgentSettingsChanged();
    if (shouldPush) await pushAssistantSettings(token);
    return true;
  } catch {
    return false;
  }
}

// Push the local settings to the account. Best-effort: local storage stays
// authoritative while offline.
export async function pushAssistantSettings(token?: string, settings?: AgentSettings): Promise<boolean> {
  const resolved = token ?? await getToken().catch(() => null);
  if (!resolved) return false;
  const local = settings ?? getAgentSettings();
  try {
    await api.saveSettings({ openrouterApiKey: local.apiKey, openaiApiKey: local.transcriptionApiKey, webSearch: local.webSearch !== false }, resolved);
    return true;
  } catch {
    // Offline: the local copy remains the source of truth until next sync.
    return false;
  }
}
