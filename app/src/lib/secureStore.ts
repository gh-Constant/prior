import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "./platform";

export async function getSecret(key: string): Promise<string | null> {
  if (isTauri() && key === "session_token") {
    try {
      const nativeToken = await invoke<string | null>("session_get");
      if (nativeToken) {
        try { localStorage.setItem(`prior.secret.${key}`, nativeToken); } catch { /* storage unavailable */ }
        return nativeToken;
      }
    } catch (err) {
      console.warn("Prior could not read native session token:", err);
    }
    const fallback = localStorage.getItem(`prior.secret.${key}`);
    if (fallback) {
      void invoke("session_set", { token: fallback }).catch(() => undefined);
      return fallback;
    }
    return null;
  }
  return localStorage.getItem(`prior.secret.${key}`);
}

export async function setSecret(key: string, value: string): Promise<void> {
  try {
    localStorage.setItem(`prior.secret.${key}`, value);
  } catch {
    // storage unavailable
  }
  if (isTauri() && key === "session_token") {
    await invoke("session_set", { token: value });
  }
}

export async function removeSecret(key: string): Promise<void> {
  try {
    localStorage.removeItem(`prior.secret.${key}`);
  } catch {
    // storage unavailable
  }
  if (isTauri() && key === "session_token") {
    await invoke("session_clear");
  }
}
