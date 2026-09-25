import { api, isAuthError, isRetriableError, type ServerSettings } from "./api";
import { getAgentSettings, notifyAgentSettingsChanged, saveAgentSettings } from "./ai";
import type { AgentSettings } from "../types";
import { getToken } from "./auth";
import { getAccountId, readScopedStorage, writeScopedStorage } from "./accountScope";

const SETTINGS_KEY = "prior.ai.settings.v1";

// The OpenRouter key lives in the account (server database) so it follows
// the user across devices, with local storage as the offline cache.
// Merge rule: when the server holds a key it wins (shared copy); otherwise
// a local key seeds the server on next push.
export function mergeServerSettings(local: AgentSettings, server: ServerSettings): { merged: AgentSettings; shouldPush: boolean } {
  const merged: AgentSettings = {
    apiKey: server.initialized ? server.openrouterApiKey : server.openrouterApiKey || local.apiKey,
    recommendationApiKey: server.recommendationOpenrouterApiKey === undefined ? local.recommendationApiKey : server.initialized ? server.recommendationOpenrouterApiKey : server.recommendationOpenrouterApiKey || local.recommendationApiKey,
    recommendationModel: local.recommendationModel,
    transcriptionApiKey: server.initialized ? server.openaiApiKey : server.openaiApiKey || local.transcriptionApiKey,
    model: local.model,
    webSearch: server.webSearch,
  };
  if (local.codexModel !== undefined) merged.codexModel = local.codexModel;
  if (local.provider) merged.provider = local.provider;
  if (local.reasoningEffort) merged.reasoningEffort = local.reasoningEffort;
  return {
    merged,
    shouldPush: !server.initialized && ((!server.openrouterApiKey && local.apiKey !== "") || (!server.recommendationOpenrouterApiKey && !!local.recommendationApiKey) || (!server.openaiApiKey && local.transcriptionApiKey !== "")),
  };
}

// Pull the shared settings into the local cache. Returns true when a
// server round-trip succeeded. Auth failures propagate so callers can sign
// the user out; network/server failures are retried once and then reported
// as false (with a warning, never swallowed silently).
export async function pullAssistantSettings(): Promise<boolean> {
  const account = getAccountId();
  const token = await getToken().catch(() => null);
  if (!token || account !== getAccountId()) return false;
  const pending = JSON.parse(readScopedStorage(SETTINGS_KEY) ?? "{}") as { pendingId?: string };
  if (pending.pendingId && !await pushAssistantSettings(token)) return false;
  const maxAttempts = 2;
  let lastError: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      const server = await api.getSettings(token);
      if (account !== getAccountId()) return false;
      if ((JSON.parse(readScopedStorage(SETTINGS_KEY) ?? "{}") as { pendingId?: string }).pendingId) return false;
      const current = getAgentSettings();
      const { merged, shouldPush } = mergeServerSettings(current, server);
      if (JSON.stringify(merged) !== JSON.stringify(current)) {
        saveAgentSettings(merged, false);
        notifyAgentSettingsChanged();
      }
      if (shouldPush && !await pushAssistantSettings(token)) return false;
      return true;
    } catch (error) {
      lastError = error;
      if (isAuthError(error)) throw error;
      if (isRetriableError(error) && attempt + 1 < maxAttempts) continue;
      console.warn("Prior assistant settings sync failed:", error);
      return false;
    }
  }
  console.warn("Prior assistant settings sync failed:", lastError);
  return false;
}

// Push the local settings to the account. Best-effort: local storage stays
// authoritative while offline.
export async function pushAssistantSettings(token?: string, settings?: AgentSettings): Promise<boolean> {
  const account = getAccountId();
  const resolved = token ?? await getToken().catch(() => null);
  if (!resolved || account !== getAccountId()) return false;
  const local = settings ?? getAgentSettings();
  const pendingId = (JSON.parse(readScopedStorage(SETTINGS_KEY) ?? "{}") as { pendingId?: string }).pendingId;
  try {
    await api.saveSettings({ openrouterApiKey: local.apiKey, recommendationOpenrouterApiKey: local.recommendationApiKey ?? "", openaiApiKey: local.transcriptionApiKey, webSearch: local.webSearch !== false }, resolved);
    if (account !== getAccountId()) return false;
    const latest = JSON.parse(readScopedStorage(SETTINGS_KEY) ?? "{}") as { pendingId?: string };
    if (latest.pendingId === pendingId) { delete latest.pendingId; writeScopedStorage(SETTINGS_KEY, JSON.stringify(latest)); }
    return true;
  } catch (error) {
    if (isAuthError(error)) throw error;
    // Offline: the local copy remains the source of truth until next sync.
    console.warn("Prior assistant settings push failed:", error);
    return false;
  }
}
