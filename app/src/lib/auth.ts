import { getCurrent, onOpenUrl } from "@tauri-apps/plugin-deep-link";
import { openUrl } from "@tauri-apps/plugin-opener";
import { API_URL, api } from "./api";
import { getSecret, removeSecret, setSecret } from "./secureStore";

const USER_KEY = "prior.session.user";

export type SessionUser = { id: string; email: string; displayName: string; avatarUrl?: string };

export function getToken(): Promise<string | null> {
  return getSecret("session_token");
}

export function getUser(): SessionUser | null {
  const value = localStorage.getItem(USER_KEY);
  if (!value) return null;
  try { return JSON.parse(value) as SessionUser; } catch { localStorage.removeItem(USER_KEY); return null; }
}

export async function clearSession(): Promise<void> {
  await removeSecret("session_token");
  localStorage.removeItem(USER_KEY);
}

export async function startGoogleLogin(): Promise<void> {
  const returnTarget = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window ? "prior://auth/callback" : `${window.location.origin}/auth/callback`;
  const returnTo = encodeURIComponent(returnTarget);
  const url = `${API_URL}/auth/google/start?return_to=${returnTo}`;
  if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) await openUrl(url);
  else window.location.href = url;
}

async function finish(url: string): Promise<SessionUser | null> {
  const parsed = new URL(url);
  if (parsed.pathname !== "/auth/callback" || !parsed.searchParams.has("code")) return null;
  const code = parsed.searchParams.get("code");
  if (!code) return null;
  const result = await api.exchange(code);
  await setSecret("session_token", result.token);
  localStorage.setItem(USER_KEY, JSON.stringify(result.user));
  return result.user;
}

export async function listenForAuth(onAuthenticated: (user: SessionUser) => void): Promise<() => void> {
  const cleanup: Array<() => void> = [];
  if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
    const initial = await getCurrent();
    if (initial?.[0]) {
      const user = await finish(initial[0]);
      if (user) onAuthenticated(user);
    }
    cleanup.push(await onOpenUrl(async (urls) => {
      const user = urls[0] ? await finish(urls[0]) : null;
      if (user) onAuthenticated(user);
    }));
  } else if (window.location.pathname === "/auth/callback") {
    const user = await finish(window.location.href);
    if (user) onAuthenticated(user);
    window.history.replaceState({}, "", "/");
  }
  return () => cleanup.forEach((dispose) => dispose());
}
