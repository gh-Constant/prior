import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { getSecret, removeSecret, setSecret } from "./secureStore";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

describe("secureStore", () => {
  const storageMap = new Map<string, string>();

  beforeEach(() => {
    storageMap.clear();
    vi.resetAllMocks();
    const storage = {
      getItem: (key: string) => storageMap.get(key) ?? null,
      setItem: (key: string, value: string) => { storageMap.set(key, value); },
      removeItem: (key: string) => { storageMap.delete(key); },
      clear: () => storageMap.clear(),
      key: (index: number) => [...storageMap.keys()][index] ?? null,
      get length() { return storageMap.size; },
    } as Storage;
    Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });
    vi.stubGlobal("__TAURI_INTERNALS__", {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("stores session_token both in native store and localStorage", async () => {
    vi.mocked(invoke).mockResolvedValue(undefined);
    await setSecret("session_token", "test-token-123");
    expect(invoke).toHaveBeenCalledWith("session_set", { token: "test-token-123" });
    expect(storageMap.get("prior.secret.session_token")).toBe("test-token-123");
  });

  it("returns native token and mirrors it to localStorage when available", async () => {
    vi.mocked(invoke).mockResolvedValue("native-token-abc");
    const token = await getSecret("session_token");
    expect(token).toBe("native-token-abc");
    expect(storageMap.get("prior.secret.session_token")).toBe("native-token-abc");
  });

  it("falls back to localStorage when native session_get returns null and re-seeds native", async () => {
    storageMap.set("prior.secret.session_token", "fallback-token-xyz");
    vi.mocked(invoke).mockResolvedValue(null);
    const token = await getSecret("session_token");
    expect(token).toBe("fallback-token-xyz");
    expect(invoke).toHaveBeenCalledWith("session_set", { token: "fallback-token-xyz" });
  });

  it("falls back to localStorage when native session_get throws an error", async () => {
    storageMap.set("prior.secret.session_token", "fallback-token-err");
    vi.mocked(invoke).mockRejectedValue(new Error("Keystore unavailable"));
    const token = await getSecret("session_token");
    expect(token).toBe("fallback-token-err");
  });

  it("removes session_token from both native store and localStorage", async () => {
    storageMap.set("prior.secret.session_token", "token-to-delete");
    vi.mocked(invoke).mockResolvedValue(undefined);
    await removeSecret("session_token");
    expect(invoke).toHaveBeenCalledWith("session_clear");
    expect(storageMap.has("prior.secret.session_token")).toBe(false);
  });

  it("handles non-session_token keys purely in localStorage", async () => {
    await setSecret("other_key", "secret_value");
    expect(invoke).not.toHaveBeenCalled();
    expect(await getSecret("other_key")).toBe("secret_value");
    await removeSecret("other_key");
    expect(await getSecret("other_key")).toBeNull();
  });
});
