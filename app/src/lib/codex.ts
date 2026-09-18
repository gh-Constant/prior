import { invoke } from "@tauri-apps/api/core";
import { openExternalUrl } from "./browser";
import { supportsCodex } from "./platform";
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
  /** OpenRouter-style effort (low/medium/high) forwarded as Codex modelReasoningEffort. Null = provider default. */
  reasoningEffort?: string | null;
};

export type CodexBinaryStatus = {
  available: boolean;
  path: string | null;
};

export type CodexStreamOptions = {
  onDelta?: (delta: string) => void;
  signal?: AbortSignal;
};

type CodexDeltaPayload = { turnId: string; delta: string };
type CodexCompletedPayload = { turnId: string; text: string; threadId: string; model?: string | null };
type CodexErrorPayload = { turnId: string; message: string };

const ACCOUNT_CACHE_KEY = "prior.codex.account.v1";
const MODELS_CACHE_KEY = "prior.codex.models.v1";
const CACHE_TTL_MS = 5 * 60 * 1000;

export function supportsCodexDesktop(): boolean {
  return supportsCodex();
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

function readCache<T>(key: string): { value: T; ts: number } | null {
  try {
    if (typeof localStorage === "undefined") return null;
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as { value: T; ts: number };
  } catch {
    return null;
  }
}

function writeCache<T>(key: string, value: T): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(key, JSON.stringify({ value, ts: Date.now() }));
  } catch {
    // Cache is best-effort; ignore quota/private-mode failures.
  }
}

export function getCachedCodexAccount(): CodexAccount | null {
  const entry = readCache<CodexAccount>(ACCOUNT_CACHE_KEY);
  if (!entry || !entry.value) return null;
  if (Date.now() - entry.ts > CACHE_TTL_MS) return null;
  return entry.value;
}

export function setCachedCodexAccount(account: CodexAccount): void {
  writeCache(ACCOUNT_CACHE_KEY, account);
}

export function clearCachedCodexAccount(): void {
  try {
    if (typeof localStorage !== "undefined") localStorage.removeItem(ACCOUNT_CACHE_KEY);
  } catch {
    // ignore
  }
}

export async function codexBinaryAvailable(): Promise<CodexBinaryStatus> {
  if (!supportsCodexDesktop()) return { available: false, path: null };
  try {
    const status = await invoke<{ available: boolean; path?: string | null }>("codex_binary_available");
    return { available: Boolean(status.available), path: status.path ?? null };
  } catch {
    return { available: false, path: null };
  }
}

export async function getCodexAccount(): Promise<CodexAccount> {
  if (!supportsCodexDesktop()) return unavailableAccount();
  try {
    const account = await invoke<CodexAccount>("codex_account_read");
    setCachedCodexAccount(account);
    return account;
  } catch (error) {
    return unavailableAccount(error instanceof Error ? error.message : "Codex is not available on this device.");
  }
}

function getCachedCodexModels(): CodexModelOption[] | null {
  const entry = readCache<CodexModelOption[]>(MODELS_CACHE_KEY);
  if (!entry || !Array.isArray(entry.value)) return null;
  if (Date.now() - entry.ts > CACHE_TTL_MS) return null;
  return entry.value;
}

function setCachedCodexModels(models: CodexModelOption[]): void {
  writeCache(MODELS_CACHE_KEY, models);
}

export async function fetchCodexModels(): Promise<CodexModelOption[]> {
  if (!supportsCodexDesktop()) return [];
  const cached = getCachedCodexModels();
  if (cached) return cached;
  try {
    const models = await invoke<CodexModelOption[]>("codex_model_list");
    setCachedCodexModels(models);
    return models;
  } catch {
    return cached ?? [];
  }
}

export function clearCachedCodexModels(): void {
  try {
    if (typeof localStorage !== "undefined") localStorage.removeItem(MODELS_CACHE_KEY);
  } catch {
    // ignore
  }
}

export async function startCodexLogin(): Promise<CodexLoginStart> {
  const login = await invoke<CodexLoginStart>("codex_login_start");
  await openExternalUrl(login.authUrl);
  return login;
}

export async function waitForCodexLogin(loginId: string): Promise<CodexAccount> {
  const account = await invoke<CodexAccount>("codex_login_wait", { loginId });
  setCachedCodexAccount(account);
  return account;
}

export async function logoutCodex(): Promise<CodexAccount> {
  const account = await invoke<CodexAccount>("codex_logout");
  setCachedCodexAccount(account);
  clearCachedCodexModels();
  return account;
}

export function runCodex(request: CodexRunRequest): Promise<CodexRunResult> {
  return invoke<CodexRunResult>("codex_run", { request });
}

export async function runCodexStream(
  request: CodexRunRequest,
  options: CodexStreamOptions = {},
): Promise<CodexRunResult> {
  if (!supportsCodexDesktop()) throw new Error("Codex is not available on this device.");
  if (options.signal?.aborted) throw new DOMException("Request cancelled.", "AbortError");
  const turnId = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `turn-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
  const { listen } = await import("@tauri-apps/api/event");

  return new Promise<CodexRunResult>((resolve, reject) => {
    let settled = false;
    const unlistens: Array<() => void> = [];
    const cleanup = () => {
      for (const unlisten of unlistens.splice(0)) {
        try { unlisten(); } catch { /* ignore */ }
      }
      options.signal?.removeEventListener("abort", handleAbort);
    };
    const settleResolve = (result: CodexRunResult) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(result);
    };
    const settleReject = (error: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const handleAbort = () => {
      void invoke("codex_cancel", { turnId }).catch(() => undefined);
      settleReject(new DOMException("Request cancelled.", "AbortError"));
    };

    options.signal?.addEventListener("abort", handleAbort, { once: true });

    void (async () => {
      try {
        unlistens.push(
          await listen<CodexDeltaPayload>("codex-delta", (event) => {
            if (event.payload?.turnId !== turnId) return;
            options.onDelta?.(event.payload.delta ?? "");
          }),
        );
        unlistens.push(
          await listen<CodexCompletedPayload>("codex-completed", (event) => {
            if (event.payload?.turnId !== turnId) return;
            settleResolve({
              text: event.payload.text ?? "",
              threadId: event.payload.threadId ?? "",
              actualModel: event.payload.model ?? undefined,
            });
          }),
        );
        unlistens.push(
          await listen<CodexErrorPayload>("codex-error", (event) => {
            if (event.payload?.turnId !== turnId) return;
            settleReject(new Error(event.payload.message || "Codex could not complete the request."));
          }),
        );
        await invoke("codex_run_stream", { request, turnId });
      } catch (error) {
        settleReject(error instanceof Error ? error : new Error("Codex could not start the request."));
      }
    })();
  });
}
