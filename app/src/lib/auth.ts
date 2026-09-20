import { getCurrent, onOpenUrl } from "@tauri-apps/plugin-deep-link";
import { invoke } from "@tauri-apps/api/core";
import { API_URL, api, isAuthError } from "./api";
import { clearAgentSettings } from "./ai";
import { claimAnonymousStorageForAccount, emitAccountScopeChange, migrateLegacyStorageForAccount } from "./accountScope";
import { openExternalUrl } from "./browser";
import { getSecret, removeSecret, setSecret } from "./secureStore";
import { translateStored } from "./i18n";
import { isAndroid, isTauri } from "./platform";
import { purgeProductionDemoData } from "./productionData";

const USER_KEY = "prior.session.user";

export type SessionUser = { id: string; email: string; displayName: string; avatarUrl?: string };

let cachedToken: string | null | undefined;
let tokenRead: Promise<string | null> | null = null;

export function getToken(): Promise<string | null> {
  if (cachedToken !== undefined) return Promise.resolve(cachedToken);
  // Several startup paths need the token at once (sync, realtime, and chat
  // history). Share one Keychain request so macOS shows at most one prompt.
  tokenRead ??= getSecret("session_token").then((token) => {
    cachedToken = token;
    return token;
  });
  return tokenRead;
}

export function getUser(): SessionUser | null {
  const value = localStorage.getItem(USER_KEY);
  if (!value) return null;
  try { return JSON.parse(value) as SessionUser; } catch { localStorage.removeItem(USER_KEY); return null; }
}

export function saveUser(user: SessionUser): void {
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export async function clearSession(): Promise<void> {
  let failure: unknown;
  try {
    await removeSecret("session_token");
  } catch (error) {
    failure = error;
  } finally {
    // The UI must leave the authenticated state even if the keychain is
    // temporarily unavailable. The caller can report the storage failure.
    cachedToken = null;
    tokenRead = null;
    localStorage.removeItem(USER_KEY);
    clearAgentSettings();
    emitAccountScopeChange();
  }
  if (failure) throw failure;
}

async function saveSession(result: { token: string; user: SessionUser }): Promise<SessionUser> {
  // Clean any local fixtures before anonymous data can be claimed by a real
  // account. The helper is a no-op for local development builds.
  if (import.meta.env.DEV !== true) await purgeProductionFixtures();
  await setSecret("session_token", result.token);
  cachedToken = result.token;
  tokenRead = null;
  saveUser(result.user);
  migrateLegacyStorageForAccount(result.user.id);
  claimAnonymousStorageForAccount(result.user.id);
  if (import.meta.env.DEV !== true) await purgeProductionFixtures();
  emitAccountScopeChange();
  return result.user;
}

async function purgeProductionFixtures(): Promise<void> {
  try {
    await purgeProductionDemoData();
  } catch (error) {
    // Sign-in must remain usable if a local cache is unavailable. Production
    // reads still filter demo sources, and the next startup retries cleanup.
    console.warn("Prior could not clean local demo data:", error);
  }
}

export async function signInWithPassword(email: string, password: string): Promise<SessionUser> {
  return saveSession(await api.login(email.trim(), password));
}

export async function signUpWithPassword(email: string, password: string, displayName: string): Promise<SessionUser> {
  return saveSession(await api.register(email.trim(), password, displayName.trim()));
}

export async function startGoogleLogin(): Promise<void> {
  const returnTarget = isTauri() ? "prior://auth/callback" : `${window.location.origin}/auth/callback`;
  const returnTo = encodeURIComponent(returnTarget);
  const url = `${API_URL}/auth/google/start?return_to=${returnTo}`;
  if (isTauri()) await openExternalUrl(url);
  else window.location.href = url;
}

export function isAndroidTauri(): boolean {
  return isAndroid();
}

/** Shared refresh() deduplication: concurrent callers share one Keychain read. */
export function resetTokenCache(): void {
  cachedToken = undefined;
  tokenRead = null;
}

export const AUTH_REQUIRED_EVENT = "prior-auth-required";

/**
 * Central auth-failure handler. Clears the local session and notifies the UI
 * (App opens AccountDialog + toast) so sync and assistant surfaces behave the
 * same way. Returns true when the error was an auth failure.
 */
export async function handleAuthError(error: unknown): Promise<boolean> {
  if (!isAuthError(error)) return false;
  try {
    await clearSession();
  } catch (clearError) {
    console.warn("Prior could not clear the expired session:", clearError);
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(AUTH_REQUIRED_EVENT, {
      detail: { message: error instanceof Error ? error.message : "Your session has expired. Please sign in again." },
    }));
  }
  return true;
}

// Native Android sign-in via the system account picker. Returns the
// authenticated user, null when the user dismisses the picker, and throws
// when native sign-in is unavailable so the caller can fall back to the
// browser OAuth flow.
export async function startNativeGoogleLogin(): Promise<SessionUser | null> {
  const raw = await invoke<unknown>("google_sign_in");
  const idToken = typeof raw === "string" ? raw : (raw as { idToken?: unknown } | null)?.idToken;
  if (typeof idToken !== "string" || !idToken) return null;
  return saveSession(await api.googleNative(idToken));
}

async function finish(url: string, handledCodes: Set<string>): Promise<SessionUser | null> {
  let parsed: URL;
  try { parsed = new URL(url); } catch { return null; }
  const nativeCallback = parsed.protocol === "prior:" && parsed.host === "auth" && parsed.pathname === "/callback";
  const webCallback = parsed.pathname === "/auth/callback" && (
    parsed.origin === "https://app.prior.constantsuchet.fr" ||
    (parsed.origin === window.location.origin && ["http:", "https:"].includes(parsed.protocol))
  );
  if ((!nativeCallback && !webCallback) || parsed.username || parsed.password) return null;
  if (parsed.searchParams.has("error")) throw new Error(translateStored("auth.errors.googleFailed"));
  const code = parsed.searchParams.get("code");
  if (!code) throw new Error(translateStored("auth.errors.missingCode"));
  // Tauri can deliver the same one-use code through both startup and open events.
  if (handledCodes.has(code)) return null;
  handledCodes.add(code);
  return saveSession(await api.exchange(code));
}

export function listenForAuth(onAuthenticated: (user: SessionUser) => void, onError: (error: Error) => void): () => void {
  let disposed = false;
  let unlisten: (() => void) | undefined;
  const handledCodes = new Set<string>();
  const reportError = (error: unknown) => {
    if (disposed) return;
    // Callback URLs contain one-use credentials; never log them.
    console.warn("Prior could not complete Google sign-in.");
    onError(error instanceof Error ? error : new Error("Unable to complete Google sign-in. Please try again."));
  };
  const handleUrls = async (urls: string[]) => {
    for (const url of urls) {
      if (disposed) return;
      try {
        const user = await finish(url, handledCodes);
        if (user && !disposed) onAuthenticated(user);
      } catch (error) {
        reportError(error);
      }
    }
  };
  const attach = async () => {
    if (isTauri()) {
      // Subscribe before reading startup URLs so a return cannot fall in between.
      unlisten = await onOpenUrl((urls) => { void handleUrls(urls); });
      if (disposed) { unlisten(); return; }
      await handleUrls(await getCurrent() ?? []);
    } else if (window.location.pathname === "/auth/callback") {
      const url = window.location.href;
      window.history.replaceState({}, "", "/");
      await handleUrls([url]);
    }
  };
  // Let React dispose a development StrictMode mount before consuming a code.
  void Promise.resolve().then(() => { if (!disposed) return attach(); }).catch(reportError);
  return () => { disposed = true; unlisten?.(); };
}
