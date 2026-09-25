import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mergeServerSettings } from "./settingsSync";
import { getAgentSettings, saveAgentSettings } from "./ai";
import { memoryStorage } from "../test/memoryStorage";

const local = { apiKey: "sk-local", transcriptionApiKey: "sk-openai-local", model: "openrouter/free", webSearch: false };

describe("mergeServerSettings", () => {
  beforeEach(() => vi.stubGlobal("localStorage", memoryStorage()));
  afterEach(() => vi.unstubAllGlobals());
  it("propagates intentional key deletion instead of reseeding from another device", () => {
    const { merged, shouldPush } = mergeServerSettings(local, { initialized: true, openrouterApiKey: "", openaiApiKey: "", webSearch: true });
    expect(merged.apiKey).toBe("");
    expect(merged.transcriptionApiKey).toBe("");
    expect(shouldPush).toBe(false);
  });
  it("prefers the server key and web search when the server holds a key", () => {
    const { merged, shouldPush } = mergeServerSettings(local, { openrouterApiKey: "sk-server", openaiApiKey: "sk-openai-server", webSearch: true });
    expect(merged).toEqual({ apiKey: "sk-server", transcriptionApiKey: "sk-openai-server", model: "openrouter/free", webSearch: true });
    expect(shouldPush).toBe(false);
  });

  it("keeps the local key and seeds the server when the server is empty", () => {
    const { merged, shouldPush } = mergeServerSettings(local, { openrouterApiKey: "", openaiApiKey: "", webSearch: true });
    expect(merged).toEqual({ ...local, webSearch: true });
    expect(shouldPush).toBe(true);
  });

  it("does nothing when both sides are empty", () => {
    const { merged, shouldPush } = mergeServerSettings(
      { apiKey: "", transcriptionApiKey: "", model: "openrouter/free", webSearch: true },
      { openrouterApiKey: "", openaiApiKey: "", webSearch: true },
    );
    expect(merged.apiKey).toBe("");
    expect(shouldPush).toBe(false);
  });

  it("syncs the optional recommendation key and preserves it against an older server", () => {
    const configured = { ...local, recommendationApiKey: "sk-today", recommendationModel: "vendor/planner" };
    expect(mergeServerSettings(configured, { initialized: true, openrouterApiKey: "sk-server", recommendationOpenrouterApiKey: "sk-remote", openaiApiKey: "", webSearch: false }).merged.recommendationApiKey).toBe("sk-remote");
    expect(mergeServerSettings(configured, { initialized: true, openrouterApiKey: "sk-server", openaiApiKey: "", webSearch: false }).merged.recommendationApiKey).toBe("sk-today");
    expect(mergeServerSettings(configured, { openrouterApiKey: "", recommendationOpenrouterApiKey: "", openaiApiKey: "", webSearch: false }).shouldPush).toBe(true);
  });

  it("keeps the saved web-search setting after reading the local cache", () => {
    saveAgentSettings({ ...local, webSearch: true }, false);
    expect(getAgentSettings().webSearch).toBe(true);
  });
});
