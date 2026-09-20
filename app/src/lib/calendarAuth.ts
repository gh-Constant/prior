import { API_URL } from "./api";
import { openExternalUrl } from "./browser";
import { isTauri } from "./platform";

export type CalendarServerAccount = {
  id: string;
  email: string;
  connectedAt: string;
};

/** Fired when a Google Calendar grant has connected or been disconnected. */
export const CALENDAR_ACCOUNT_EVENT = "prior-calendar-account-changed";

export function emitCalendarAccountChange(): void {
  try {
    window.dispatchEvent(new CustomEvent(CALENDAR_ACCOUNT_EVENT));
  } catch {
    // Non-DOM context: nothing is listening.
  }
}

export async function listCalendarAccounts(sessionToken: string): Promise<CalendarServerAccount[]> {
  const response = await fetch(`${API_URL}/v1/calendar/accounts`, {
    headers: { Authorization: `Bearer ${sessionToken}` },
  });
  if (!response.ok) throw new Error(`calendar-accounts-${response.status}`);
  const data = (await response.json()) as { accounts?: CalendarServerAccount[] };
  return data.accounts ?? [];
}

export async function disconnectCalendarAccount(sessionToken: string, id: string): Promise<void> {
  const response = await fetch(`${API_URL}/v1/calendar/accounts/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${sessionToken}` },
  });
  if (!response.ok && response.status !== 204) throw new Error(`calendar-disconnect-${response.status}`);
}

/** Start the server-owned Google Calendar OAuth grant. */
export async function startGoogleCalendarConnect(): Promise<void> {
  const { getToken } = await import("./auth");
  const session = await getToken();
  if (!session) throw new Error("sign-in-required");
  const returnTo = isTauri()
    ? "prior://auth/callback#/calendar-connected"
    : `${window.location.origin}/#/calendar-connected`;
  const url = `${API_URL}/v1/calendar/connect/start?token=${encodeURIComponent(session)}&return_to=${encodeURIComponent(returnTo)}`;
  if (isTauri()) await openExternalUrl(url);
  else window.location.href = url;
}

/** Resolve an access token without persisting Google's refresh token locally. */
export function makeGoogleCalendarTokenGetter(sessionToken: string, accountId: string): () => Promise<string> {
  let cached: { token: string; expiresAt: number } | null = null;
  return async () => {
    const now = Date.now();
    if (cached && cached.expiresAt - 60_000 > now) return cached.token;
    const response = await fetch(`${API_URL}/v1/calendar/token?account_id=${encodeURIComponent(accountId)}`, {
      headers: { Authorization: `Bearer ${sessionToken}` },
    });
    if (!response.ok) throw new Error(`calendar-token-${response.status}`);
    const data = (await response.json()) as { accessToken: string; expiresIn: number };
    cached = { token: data.accessToken, expiresAt: now + data.expiresIn * 1000 };
    return data.accessToken;
  };
}

export type CalendarConnectedResult = { email: string | null; error: string | null };

/** Parse both web hash returns and native prior:// deep links. */
export function parseCalendarConnectedUrl(raw: string): CalendarConnectedResult | null {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (!parsed.hash.startsWith("#/calendar-connected")) return null;
  const params = new URLSearchParams(parsed.hash.split("?")[1] ?? "");
  return {
    email: params.get("email")?.includes("@") ? params.get("email") : null,
    error: params.get("error"),
  };
}
