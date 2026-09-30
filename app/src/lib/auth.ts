import { getCurrent, onOpenUrl } from "@tauri-apps/plugin-deep-link";
import { invoke } from "@tauri-apps/api/core";
import { API_URL, api, isAuthError, type AccountUser, type SignInResponse } from "./api";
import { clearAgentSettings } from "./ai";
import { claimAnonymousStorageForAccount, emitAccountScopeChange, migrateLegacyStorageForAccount } from "./accountScope";
import { openExternalUrl } from "./browser";
import { getSecret, removeSecret, setSecret } from "./secureStore";
import { storedLanguage, translateStored } from "./i18n";
import { isAndroid, isTauri } from "./platform";
import { purgeProductionDemoData } from "./productionData";

const USER_KEY = "prior.session.user";

export type SessionUser = Pick<AccountUser, "id" | "email" | "displayName" | "avatarUrl" | "emailVerified" | "hasPassword" | "googleLinked" | "twoFactorEnabled" | "locale">;

/** Whether the server copy of the account differs from the cached one. */
export function sessionUserChanged(current: SessionUser, next: SessionUser): boolean {
  const fields: Array<keyof SessionUser> = ["displayName", "email", "avatarUrl", "emailVerified", "hasPassword", "googleLinked", "twoFactorEnabled"];
  return fields.some((field) => current[field] !== next[field]);
}

/** Fired when sign-in needs a 2FA code: the sign-in surfaces show the code step. */
export const TWO_FACTOR_CHALLENGE_EVENT = "prior-2fa-challenge";

let pendingChallenge: string | null = null;

function emitTwoFactorChallenge(challenge: string): void {
  // Kept until a sign-in surface takes it: a Google return can arrive before
  // the sign-in screen has mounted.
  pendingChallenge = challenge;
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(TWO_FACTOR_CHALLENGE_EVENT, { detail: { challenge } }));
}

/** The challenge waiting for a code, if any (cleared once read). */
export function takePendingChallenge(): string | null {
  const challenge = pendingChallenge;
  pendingChallenge = null;
  return challenge;
}

function pickSessionUser(user: AccountUser): SessionUser {
  const { id, email, displayName, avatarUrl, emailVerified, hasPassword, googleLinked, twoFactorEnabled, locale } = user;
  return { id, email, displayName, avatarUrl, emailVerified, hasPassword, googleLinked, twoFactorEnabled, locale };
}

/**
 * Finishes any sign-in answer: a session is saved, a 2FA challenge is
 * announced (null is returned and the code step takes over).
 */
async function completeSignIn(response: SignInResponse): Promise<SessionUser | null> {
  if ("twoFactorRequired" in response && response.twoFactorRequired) {
    emitTwoFactorChallenge(response.challenge);
    return null;
  }
  return saveSession(response as { token: string; user: AccountUser });
}

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

async function saveSession(result: { token: string; user: AccountUser }): Promise<SessionUser> {
  const user = pickSessionUser(result.user);
  // Clean any local fixtures before anonymous data can be claimed by a real
  // account. The helper is a no-op for local development builds.
  if (import.meta.env.DEV !== true) await purgeProductionFixtures();
  await setSecret("session_token", result.token);
  cachedToken = result.token;
  tokenRead = null;
  saveUser(user);
  migrateLegacyStorageForAccount(user.id);
  claimAnonymousStorageForAccount(user.id);
  if (import.meta.env.DEV !== true) await purgeProductionFixtures();
  emitAccountScopeChange();
  return user;
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

/** Returns null when a 2FA code is needed (see TWO_FACTOR_CHALLENGE_EVENT). */
export async function signInWithPassword(email: string, password: string): Promise<SessionUser | null> {
  return completeSignIn(await api.login(email.trim(), password, storedLanguage()));
}

export async function signUpWithPassword(email: string, password: string, displayName: string): Promise<SessionUser> {
  return saveSession(await api.register(email.trim(), password, displayName.trim(), storedLanguage()));
}

/** Second sign-in step: a TOTP code or a recovery code for a challenge. */
export async function completeTwoFactor(challenge: string, input: { code?: string; recoveryCode?: string }): Promise<SessionUser> {
  return saveSession(await api.verifyTwoFactor(challenge, input));
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

/** Returned by native sign-in when a 2FA code step has taken over. */
export const CHALLENGE_PENDING = "challenge" as const;

// Native Android sign-in via the system account picker. Returns the
// authenticated user, null when the user dismisses the picker, and throws
// when native sign-in is unavailable so the caller can fall back to the
// browser OAuth flow.
export async function startNativeGoogleLogin(): Promise<SessionUser | typeof CHALLENGE_PENDING | null> {
  const raw = await invoke<unknown>("google_sign_in");
  const idToken = typeof raw === "string" ? raw : (raw as { idToken?: unknown } | null)?.idToken;
  if (typeof idToken !== "string" || !idToken) return null;
  const user = await completeSignIn(await api.googleNative(idToken));
  // A 2FA challenge was announced: report it as handled, not dismissed.
  return user ?? CHALLENGE_PENDING;
}

const HANDLED_CODES_KEY = "prior.auth.handled_codes";

function isCodeHandled(code: string): boolean {
  try {
    const raw = localStorage.getItem(HANDLED_CODES_KEY);
    if (!raw) return false;
    const list: unknown = JSON.parse(raw);
    return Array.isArray(list) && list.includes(code);
  } catch {
    return false;
  }
}

function markCodeHandled(code: string): void {
  try {
    const raw = localStorage.getItem(HANDLED_CODES_KEY);
    const list: string[] = raw ? JSON.parse(raw) : [];
    if (!list.includes(code)) {
      localStorage.setItem(HANDLED_CODES_KEY, JSON.stringify([...list.slice(-19), code]));
    }
  } catch {
    // storage unavailable
  }
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
  // Gmail and Google Calendar use the same native deep-link host, but their
  // callback is already completed server-side and carries its result in the
  // hash. It is not a Prior sign-in code.
  if (parsed.hash.startsWith("#/mail-connected") || parsed.hash.startsWith("#/calendar-connected")) return null;
  if (parsed.searchParams.has("error")) throw new Error(translateStored("auth.errors.googleFailed"));
  const code = parsed.searchParams.get("code");
  if (!code) throw new Error(translateStored("auth.errors.missingCode"));
  // Tauri can deliver the same one-use code through both startup and open events,
  // or replay it on Android when resuming from the background.
  if (handledCodes.has(code) || isCodeHandled(code)) return null;
  handledCodes.add(code);
  const result = await api.exchange(code);
  markCodeHandled(code);
  return completeSignIn(result);
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
        // Stale or replayed deep-links must never disrupt an existing authenticated session.
        if (getUser()) {
          console.warn("Prior ignored stale auth callback while already signed in:", error);
          return;
        }
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
