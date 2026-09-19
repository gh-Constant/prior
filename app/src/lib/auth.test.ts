import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getCurrent, onOpenUrl } from "@tauri-apps/plugin-deep-link";
import { invoke } from "@tauri-apps/api/core";
import { api } from "./api";
import { clearSession, getToken, listenForAuth, startNativeGoogleLogin } from "./auth";
import { getSecret, removeSecret, setSecret } from "./secureStore";

vi.mock("@tauri-apps/plugin-deep-link", () => ({ getCurrent: vi.fn(), onOpenUrl: vi.fn() }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("./api", () => ({ API_URL: "https://api.prior.constantsuchet.fr", api: { exchange: vi.fn(), googleNative: vi.fn() } }));
vi.mock("./secureStore", () => ({ getSecret: vi.fn(), setSecret: vi.fn(), removeSecret: vi.fn() }));

const originalLocalStorage = globalThis.localStorage;
afterAll(() => {
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: originalLocalStorage });
});

const user = { id: "user-1", email: "test@example.com", displayName: "Test" };

describe("Session token reads", () => {
  it("shares concurrent Keychain reads and caches the result", async () => {
    Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { removeItem: vi.fn() } });
    let resolveToken: (token: string | null) => void = () => undefined;
    vi.mocked(getSecret).mockReturnValue(new Promise((resolve) => { resolveToken = resolve; }));

    const first = getToken();
    const second = getToken();
    expect(getSecret).toHaveBeenCalledOnce();

    resolveToken("session-token");
    await expect(Promise.all([first, second])).resolves.toEqual(["session-token", "session-token"]);
    await expect(getToken()).resolves.toBe("session-token");
    expect(getSecret).toHaveBeenCalledOnce();
    await clearSession();
  });

  it("clears keys on sign-out: token secret, cached user, and agent settings", async () => {
    const storageMap = new Map<string, string>([
      ["prior.session.user", JSON.stringify(user)],
      ["prior.ai.settings.v1", JSON.stringify({ apiKey: "sk-test" })],
    ]);
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => storageMap.get(key) ?? null,
        setItem: (key: string, value: string) => { storageMap.set(key, value); },
        removeItem: (key: string) => { storageMap.delete(key); },
      },
    });
    vi.mocked(getSecret).mockResolvedValue(null);
    await clearSession();
    expect(removeSecret).toHaveBeenCalledWith("session_token");
    expect(storageMap.has("prior.session.user")).toBe(false);
    await expect(getToken()).resolves.toBeNull();
  });
});

describe("OAuth return", () => {
  let dispose: (() => void) | undefined;
  const onAuthenticated = vi.fn();
  const onError = vi.fn();
  const unlisten = vi.fn();
  let emit: (urls: string[]) => void;

  beforeEach(() => {
    dispose = undefined;
    vi.resetAllMocks();
    const storageMap = new Map<string, string>();
    const storage = {
      getItem: (key: string) => storageMap.get(key) ?? null,
      setItem: (key: string, value: string) => { storageMap.set(key, value); },
      removeItem: (key: string) => { storageMap.delete(key); },
      clear: () => storageMap.clear(),
      key: (index: number) => [...storageMap.keys()][index] ?? null,
      get length() { return storageMap.size; },
    } as Storage;
    Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });
    window.history.replaceState({}, "", "/");
    vi.stubGlobal("__TAURI_INTERNALS__", {});
    vi.mocked(getCurrent).mockResolvedValue(null);
    vi.mocked(onOpenUrl).mockImplementation(async (handler) => { emit = handler; return unlisten; });
    vi.mocked(api.exchange).mockResolvedValue({ token: "session-token", user });
    vi.mocked(setSecret).mockResolvedValue(undefined);
  });

  afterEach(() => { dispose?.(); vi.unstubAllGlobals(); });

  it("finishes the native prior://auth/callback return when the app is already open", async () => {
    dispose = listenForAuth(onAuthenticated, onError);
    await vi.waitFor(() => expect(onOpenUrl).toHaveBeenCalled());
    emit(["prior://auth/callback?code=native-code"]);
    await vi.waitFor(() => expect(onAuthenticated).toHaveBeenCalledWith(user));
    expect(api.exchange).toHaveBeenCalledWith("native-code");
    expect(setSecret).toHaveBeenCalledWith("session_token", "session-token");
    expect(JSON.parse(localStorage.getItem("prior.session.user")!)).toEqual(user);
    expect(onError).not.toHaveBeenCalled();
  });

  it("handles a native cold start and exchanges duplicate deliveries only once", async () => {
    const url = "prior://auth/callback?code=cold-start";
    vi.mocked(getCurrent).mockImplementation(async () => { emit([url]); return [url]; });
    dispose = listenForAuth(onAuthenticated, onError);
    await vi.waitFor(() => expect(onAuthenticated).toHaveBeenCalledOnce());
    emit([url]);
    await Promise.resolve();
    expect(api.exchange).toHaveBeenCalledOnce();
    expect(api.exchange).toHaveBeenCalledWith("cold-start");
    expect(onError).not.toHaveBeenCalled();
  });

  it("finishes a browser return and removes the code from the address bar", async () => {
    vi.unstubAllGlobals();
    window.history.replaceState({}, "", "/auth/callback?code=browser-code");
    dispose = listenForAuth(onAuthenticated, onError);
    await vi.waitFor(() => expect(onAuthenticated).toHaveBeenCalledWith(user));
    expect(api.exchange).toHaveBeenCalledWith("browser-code");
    expect(window.location.pathname).toBe("/");
    expect(window.location.search).toBe("");
    expect(onOpenUrl).not.toHaveBeenCalled();
  });

  it("accepts the configured mobile app link, even after an unrelated URL", async () => {
    vi.mocked(getCurrent).mockResolvedValue(["prior://tasks", "https://app.prior.constantsuchet.fr/auth/callback?code=mobile-code"]);
    dispose = listenForAuth(onAuthenticated, onError);
    await vi.waitFor(() => expect(onAuthenticated).toHaveBeenCalledWith(user));
    expect(api.exchange).toHaveBeenCalledWith("mobile-code");
  });

  it.each([
    "not a url", "prior://evil/callback?code=bad", "prior://auth/other?code=bad",
    "https://evil.example/auth/callback?code=bad", "prior://user@auth/callback?code=bad",
    "prior://auth:123/callback?code=bad", "https://app.prior.constantsuchet.fr.evil.example/auth/callback?code=bad",
  ])("ignores unrelated or untrusted links: %s", async (url) => {
    vi.mocked(getCurrent).mockResolvedValue([url]);
    dispose = listenForAuth(onAuthenticated, onError);
    await vi.waitFor(() => expect(getCurrent).toHaveBeenCalled());
    expect(api.exchange).not.toHaveBeenCalled();
    expect(onAuthenticated).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  it.each(["?error=auth_failed", "?code="])("reports a failed return instead of silently ignoring it: %s", async (query) => {
    vi.mocked(getCurrent).mockResolvedValue([`prior://auth/callback${query}`]);
    dispose = listenForAuth(onAuthenticated, onError);
    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith(expect.any(Error)));
    expect(api.exchange).not.toHaveBeenCalled();
    expect(onAuthenticated).not.toHaveBeenCalled();
  });

  it.each(["exchange", "storage"])("reports %s errors and can handle a fresh login afterwards", async (failure) => {
    if (failure === "exchange") vi.mocked(api.exchange).mockRejectedValueOnce(new Error("Exchange code expired"));
    else vi.mocked(setSecret).mockRejectedValueOnce(new Error("Unable to save session"));
    vi.mocked(getCurrent).mockResolvedValue(["prior://auth/callback?code=failed-code"]);
    dispose = listenForAuth(onAuthenticated, onError);
    await vi.waitFor(() => expect(onError).toHaveBeenCalledOnce());
    expect(onAuthenticated).not.toHaveBeenCalled();
    expect(localStorage.getItem("prior.session.user")).toBeNull();
    emit(["prior://auth/callback?code=fresh-code"]);
    await vi.waitFor(() => expect(onAuthenticated).toHaveBeenCalledWith(user));
  });

  it("disposes a late subscription without consuming the startup code", async () => {
    let register: ((cleanup: () => void) => void) | undefined;
    vi.mocked(onOpenUrl).mockImplementation(() => new Promise((resolve) => { register = resolve; }));
    dispose = listenForAuth(onAuthenticated, onError);
    await vi.waitFor(() => expect(onOpenUrl).toHaveBeenCalled());
    dispose();
    register?.(unlisten);
    await vi.waitFor(() => expect(unlisten).toHaveBeenCalledOnce());
    expect(getCurrent).not.toHaveBeenCalled();
  });

  it("does not consume a browser code in a disposed StrictMode mount", async () => {
    vi.unstubAllGlobals();
    window.history.replaceState({}, "", "/auth/callback?code=one-use-code");
    listenForAuth(onAuthenticated, onError)();
    dispose = listenForAuth(onAuthenticated, onError);
    await vi.waitFor(() => expect(onAuthenticated).toHaveBeenCalledOnce());
    expect(api.exchange).toHaveBeenCalledOnce();
    expect(api.exchange).toHaveBeenCalledWith("one-use-code");
  });

  it("reports listener setup failures", async () => {
    vi.mocked(onOpenUrl).mockRejectedValueOnce(new Error("Listener unavailable"));
    dispose = listenForAuth(onAuthenticated, onError);
    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith(expect.any(Error)));
  });
});

describe("Native Google sign-in", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    const storageMap = new Map<string, string>();
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => storageMap.get(key) ?? null,
        setItem: (key: string, value: string) => { storageMap.set(key, value); },
        removeItem: (key: string) => { storageMap.delete(key); },
      },
    });
    vi.mocked(setSecret).mockResolvedValue(undefined);
    vi.mocked(api.googleNative).mockResolvedValue({ token: "session-token", user });
  });

  it("exchanges the native ID token for a session", async () => {
    vi.mocked(invoke).mockResolvedValue({ idToken: "native-id-token" });
    await expect(startNativeGoogleLogin()).resolves.toEqual(user);
    expect(invoke).toHaveBeenCalledWith("google_sign_in");
    expect(api.googleNative).toHaveBeenCalledWith("native-id-token");
    expect(setSecret).toHaveBeenCalledWith("session_token", "session-token");
  });

  it("returns null without contacting the API when the picker is dismissed", async () => {
    vi.mocked(invoke).mockResolvedValue({ idToken: null });
    await expect(startNativeGoogleLogin()).resolves.toBeNull();
    expect(api.googleNative).not.toHaveBeenCalled();
  });

  it("propagates native failures so the caller can fall back to the browser", async () => {
    vi.mocked(invoke).mockRejectedValue(new Error("No Google accounts on device"));
    await expect(startNativeGoogleLogin()).rejects.toThrow("No Google accounts on device");
    expect(api.googleNative).not.toHaveBeenCalled();
  });
});
