import { DEFAULT_MODEL, getAgentSettings, notifyAgentSettingsChanged, saveAgentSettings } from "./ai";
import { readAccountDocuments, stageDocument, writeAccountDocuments } from "./accountDocuments";
import type { AgentSettings } from "../types";

export const PREFERENCES_APPLIED = "prior-preferences-applied";
// NB: "prior.ai.open" is intentionally NOT synced: the assistant must never
// reopen on arrival because another device left it open.
export const UI_PREFERENCE_KEYS = ["prior.language", "prior.sidebar.collapsed", "prior.notes.tabs", "prior.notes.library", "prior.notes.collapsed"] as const;

export function initializeAccountPreferences(): void {
  const documents = readAccountDocuments();
  const settings = getAgentSettings();
  if (!("preferences/agent" in documents.records)) stageDocument(documents, "preferences/agent", { model: settings.model, recommendationModel: settings.recommendationModel || DEFAULT_MODEL, codexModel: settings.codexModel ?? "", provider: settings.provider ?? "openrouter", reasoningEffort: settings.reasoningEffort ?? "auto" }, true);
  if (!("preferences/ui" in documents.records)) stageDocument(documents, "preferences/ui", Object.fromEntries(UI_PREFERENCE_KEYS.map((key) => [key, localStorage.getItem(key)])), true);
  writeAccountDocuments(documents, false);
}

export function applyAccountPreferences(): void {
  const documents = readAccountDocuments();
  const agent = documents.records["preferences/agent"];
  if (agent) {
    const current = getAgentSettings();
    const next: AgentSettings = { ...current,
      model: typeof agent.model === "string" ? agent.model : current.model,
      recommendationModel: typeof agent.recommendationModel === "string" && agent.recommendationModel ? agent.recommendationModel : current.recommendationModel,
      codexModel: typeof agent.codexModel === "string" ? agent.codexModel : current.codexModel,
      provider: agent.provider === "codex" ? "codex" as const : "openrouter" as const,
      reasoningEffort: agent.reasoningEffort === "low" || agent.reasoningEffort === "medium" || agent.reasoningEffort === "high" ? agent.reasoningEffort : "auto" as const,
    };
    if (JSON.stringify(next) !== JSON.stringify(current)) { saveAgentSettings(next, false); notifyAgentSettingsChanged(); }
  }
  const ui = documents.records["preferences/ui"];
  let changed = false;
  if (ui) for (const key of UI_PREFERENCE_KEYS) {
    if (typeof ui[key] === "string" && localStorage.getItem(key) !== ui[key]) { localStorage.setItem(key, ui[key]); changed = true; }
  }
  if (changed) window.dispatchEvent(new Event(PREFERENCES_APPLIED));
}
