import { describe, expect, it } from "vitest";
import { mergeServerSettings } from "./settingsSync";

const local = { apiKey: "sk-local", model: "openrouter/free", webSearch: false };

describe("mergeServerSettings", () => {
  it("prefers the server key and web search when the server holds a key", () => {
    const { merged, shouldPush } = mergeServerSettings(local, { openrouterApiKey: "sk-server", webSearch: true });
    expect(merged).toEqual({ apiKey: "sk-server", model: "openrouter/free", webSearch: true });
    expect(shouldPush).toBe(false);
  });

  it("keeps the local key and seeds the server when the server is empty", () => {
    const { merged, shouldPush } = mergeServerSettings(local, { openrouterApiKey: "", webSearch: true });
    expect(merged).toEqual(local);
    expect(shouldPush).toBe(true);
  });

  it("does nothing when both sides are empty", () => {
    const { merged, shouldPush } = mergeServerSettings(
      { apiKey: "", model: "openrouter/free", webSearch: true },
      { openrouterApiKey: "", webSearch: true },
    );
    expect(merged.apiKey).toBe("");
    expect(shouldPush).toBe(false);
  });
});
