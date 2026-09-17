import { invoke } from "@tauri-apps/api/core";
import { openExternalUrl } from "./browser";
import type { AgentMessage } from "../types";

export type CodexAccount = {
  available: boolean;
  authenticated: boolean;
  authMode: string | null;
  planType: string | null;
  email: string | null;
  error: string | null;
};

export type CodexModelOption = {
  id: string;
  label: string;
  description: string;
  isDefault: boolean;
};

export type CodexLoginStart = {
  loginId: string;
  authUrl: string;
};

export type CodexRunResult = {
  text: string;
  threadId: string;
  actualModel?: string;
};

export type CodexRunRequest = {
  prompt: string;
  history: Pick<AgentMessage, "role" | "content">[];
  systemPrompt: string;
  model?: string | null;
  threadId?: string | null;
};

export function supportsCodexDesktop(): boolean {
  if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) return false;
  return !/android|iphone|ipad|ipod/i.test(typeof navigator === "undefined" ? "" : navigator.userAgent);
}

function unavailableAccount(error: string | null = null): CodexAccount {
  return {
    available: false,
    authenticated: false,
    authMode: null,
    planType: null,
    email: null,
    error,
  };
}

export async function getCodexAccount(): Promise<CodexAccount> {
  if (!supportsCodexDesktop()) return unavailableAccount();
  try {
    return await invoke<CodexAccount>("codex_account_read");
  } catch (error) {
    return unavailableAccount(error instanceof Error ? error.message : "Codex is not available on this device.");
  }
}

export async function fetchCodexModels(): Promise<CodexModelOption[]> {
  if (!supportsCodexDesktop()) return [];
  try {
    return await invoke<CodexModelOption[]>("codex_model_list");
  } catch {
    return [];
  }
}

export async function startCodexLogin(): Promise<CodexLoginStart> {
  const login = await invoke<CodexLoginStart>("codex_login_start");
  await openExternalUrl(login.authUrl);
  return login;
}

export function waitForCodexLogin(loginId: string): Promise<CodexAccount> {
  return invoke<CodexAccount>("codex_login_wait", { loginId });
}

export function logoutCodex(): Promise<CodexAccount> {
  return invoke<CodexAccount>("codex_logout");
}

export function runCodex(request: CodexRunRequest): Promise<CodexRunResult> {
  return invoke<CodexRunResult>("codex_run", { request });
}
