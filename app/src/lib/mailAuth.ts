import { API_URL } from "./api";
import { isAndroid, isTauri } from "./platform";
import { openExternalUrl } from "./browser";
import { readScopedStorage, writeScopedStorage, removeScopedStorage } from "./accountScope";
import { GMAIL_SCOPES } from "./mail";

/**
 * Gmail account connection.
 *
 * The Gmail connection is intentionally separate from the Prior sign-in: a
 * user can sign in to Prior with any method and still attach a Gmail account
 * for the inbox. We request a dedicated OAuth grant with Gmail scopes and an
 * offline refresh token, which is stored sealed on the server. The client only
 * ever holds a short-lived access token (fetched via the server proxy), so the
 * refresh token never touches device storage.
 *
 * When no Google OAuth client id is configured (local dev without `.env`), the
 * connection is skipped and the inbox falls back to the demo mailbox.
 */

const ACCOUNT_KEY = "prior.mail.account.v1";

export type MailAccount = { email: string; connectedAt: string };

export function getMailAccount(): MailAccount | null {
  try {
    const raw = readScopedStorage(ACCOUNT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as MailAccount;
    return parsed && typeof parsed.email === "string" ? parsed : null;
  } catch {
    return null;
  }
}

export function saveMailAccount(account: MailAccount): void {
  writeScopedStorage(ACCOUNT_KEY, JSON.stringify(account));
}

export function clearMailAccount(): void {
  removeScopedStorage(ACCOUNT_KEY);
}

/** Fired when the Gmail connection changes (connect, reconnect, disconnect).
 * Native shells never reload on OAuth return, so views must refresh their
 * provider from this instead of relying on a page load. */
export const MAIL_ACCOUNT_EVENT = "prior-mail-account-changed";

export function emitMailAccountChange(): void {
  try {
    window.dispatchEvent(new CustomEvent(MAIL_ACCOUNT_EVENT));
  } catch {
    // Non-DOM context: nothing is listening.
  }
}

export type MailServerAccount = { id: string; email: string; connectedAt: string };

export async function listMailAccounts(sessionToken: string): Promise<MailServerAccount[]> {
  const res = await fetch(`${API_URL}/v1/mail/accounts`, {
    headers: { Authorization: `Bearer ${sessionToken}` },
  });
  if (!res.ok) throw new Error(`mail-accounts-${res.status}`);
  const data = (await res.json()) as { accounts?: MailServerAccount[] };
  return data.accounts ?? [];
}

export async function disconnectMailAccount(sessionToken: string, id: string): Promise<void> {
  const res = await fetch(`${API_URL}/v1/mail/accounts/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${sessionToken}` },
  });
  if (!res.ok && res.status !== 204) throw new Error(`mail-disconnect-${res.status}`);
}

/** Open the server-owned Gmail OAuth grant (offline access + PKCE). Needs the
 * current Prior session token so the grant binds to this account, and a
 * return URL that lands back on the mail view. */
export async function startGmailConnect(): Promise<void> {
  const { getToken } = await import("./auth");
  const session = await getToken();
  if (!session) throw new Error("sign-in-required");
  // Web returns to the hash route (no backend routing needed); native shells
  // use the deep link, which Tauri picks up via onOpenUrl.
  const returnTo = isTauri()
    ? "prior://auth/callback#/mail-connected"
    : `${window.location.origin}/#/mail-connected`;
  const url = `${API_URL}/v1/mail/connect/start?token=${encodeURIComponent(session)}&return_to=${encodeURIComponent(returnTo)}`;
  if (isTauri()) await openExternalUrl(url);
  else window.location.href = url;
}

/**
 * Resolve a Gmail access token through the server proxy. The server refreshes
 * the stored offline token and returns a short-lived access token, so the
 * client never persists the powerful refresh token.
 */
export function makeGmailTokenGetter(sessionToken: string): () => Promise<string> {
  let cached: { token: string; expiresAt: number } | null = null;
  return async () => {
    const now = Date.now();
    if (cached && cached.expiresAt - 60_000 > now) return cached.token;
    const res = await fetch(`${API_URL}/v1/mail/token`, {
      headers: { Authorization: `Bearer ${sessionToken}` },
    });
    if (!res.ok) throw new Error(`mail-token-${res.status}`);
    const data = (await res.json()) as { accessToken: string; expiresIn: number };
    cached = { token: data.accessToken, expiresAt: now + data.expiresIn * 1000 };
    return data.accessToken;
  };
}

/** Android native Gmail connect via the system account manager. */
export function supportsNativeGmailConnect(): boolean {
  return isAndroid();
}

export { GMAIL_SCOPES };

/** A Gmail return that arrived via the native deep link (prior://…). The auth
 * listener only understands /auth/callback with a code, so mail returns carry
 * the email in the hash instead. */
export function parseMailConnectedUrl(raw: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (!parsed.hash.startsWith("#/mail-connected")) return null;
  const email = new URLSearchParams(parsed.hash.split("?")[1] ?? "").get("email");
  return email && email.includes("@") ? email : null;
}
