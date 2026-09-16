import { getCurrent, onOpenUrl } from "@tauri-apps/plugin-deep-link";
import { openUrl } from "@tauri-apps/plugin-opener";
import { API_URL, api } from "./api";
import { getSecret, removeSecret, setSecret } from "./secureStore";

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
  }
  if (failure) throw failure;
}

async function saveSession(result: { token: string; user: SessionUser }): Promise<SessionUser> {
  await setSecret("session_token", result.token);
  cachedToken = result.token;
  tokenRead = null;
  localStorage.setItem(USER_KEY, JSON.stringify(result.user));
  return result.user;
}

export async function signInWithPassword(email: string, password: string): Promise<SessionUser> {
  return saveSession(await api.login(email.trim(), password));
}

export async function signUpWithPassword(email: string, password: string, displayName: string): Promise<SessionUser> {
  return saveSession(await api.register(email.trim(), password, displayName.trim()));
}

export async function startGoogleLogin(): Promise<void> {
  const returnTarget = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window ? "prior://auth/callback" : `${window.location.origin}/auth/callback`;
  const returnTo = encodeURIComponent(returnTarget);
  const url = `${API_URL}/auth/google/start?return_to=${returnTo}`;
  if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) await openUrl(url);
  else window.location.href = url;
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
  if (parsed.searchParams.has("error")) throw new Error("Google sign-in failed or was cancelled. Please try again.");
  const code = parsed.searchParams.get("code");
  if (!code) throw new Error("The sign-in link is missing its code. Please sign in again.");
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
    if ("__TAURI_INTERNALS__" in window) {
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
