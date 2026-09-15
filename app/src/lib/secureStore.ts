import { invoke } from "@tauri-apps/api/core";

function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export async function getSecret(key: string): Promise<string | null> {
  if (isTauri() && key === "session_token") {
    return invoke<string | null>("session_get");
  }
  return localStorage.getItem(`prior.secret.${key}`);
}

export async function setSecret(key: string, value: string): Promise<void> {
  if (isTauri() && key === "session_token") {
    await invoke("session_set", { token: value });
    return;
  }
  localStorage.setItem(`prior.secret.${key}`, value);
}

export async function removeSecret(key: string): Promise<void> {
  if (isTauri() && key === "session_token") {
    await invoke("session_clear");
    return;
  }
  localStorage.removeItem(`prior.secret.${key}`);
}
