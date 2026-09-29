import { useEffect, useState } from "react";
import { api, type HostedAiStatus } from "../lib/api";
import { getToken } from "../lib/auth";

// One status request per session token: availability only changes when the
// API is redeployed, and every caller needs the same answer.
const statusByToken = new Map<string, Promise<HostedAiStatus | null>>();

export function fetchHostedAiStatus(token: string): Promise<HostedAiStatus | null> {
  let pending = statusByToken.get(token);
  if (!pending) {
    pending = Promise.resolve().then(() => api.hostedAiStatus(token)).catch(() => {
      statusByToken.delete(token);
      return null;
    });
    statusByToken.set(token, pending);
  }
  return pending;
}

/**
 * Whether Prior AI (the hosted assistant) can serve this user: they are
 * signed in and the API has a provider key. `null` while unknown.
 */
export function useHostedAiAvailable(): boolean | null {
  const [available, setAvailable] = useState<boolean | null>(null);
  const [authVersion, setAuthVersion] = useState(0);
  useEffect(() => {
    const bump = () => setAuthVersion((value) => value + 1);
    window.addEventListener("prior-auth-change", bump);
    return () => window.removeEventListener("prior-auth-change", bump);
  }, []);
  useEffect(() => {
    let live = true;
    void getToken().catch(() => null).then(async (token) => {
      if (!token) {
        if (live) setAvailable(false);
        return;
      }
      const status = await fetchHostedAiStatus(token);
      if (live) setAvailable(Boolean(status?.available));
    });
    return () => { live = false; };
  }, [authVersion]);
  return available;
}
