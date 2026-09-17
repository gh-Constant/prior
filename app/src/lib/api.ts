import type { AgentChat, AgentMessage, AgentChatSummary, Habit, Mutation, Task } from "../types";

const isNativeApp = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
const productionApiUrl = "https://api.prior.constantsuchet.fr";
const defaultApiUrl = isNativeApp ? productionApiUrl : "http://localhost:8080";
const configuredApiUrl = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, "");

function isLocalApiUrl(value: string | undefined): boolean {
  if (!value) return false;
  try {
    const parsed = new URL(value);
    return parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1" || parsed.hostname === "[::1]";
  } catch {
    return false;
  }
}

// A local .env is useful for browser/Tauri development, but it must never leak
// into a packaged native build. Vite's DEV flag distinguishes those cases.
const useConfiguredApiUrl = !isNativeApp || import.meta.env.DEV || !isLocalApiUrl(configuredApiUrl);
export const API_URL = useConfiguredApiUrl ? (configuredApiUrl ?? defaultApiUrl) : defaultApiUrl;
export const FALLBACK_API_URL = isNativeApp && API_URL !== productionApiUrl ? productionApiUrl : undefined;
const REQUEST_TIMEOUT_MS = 15_000;

class ApiRequestError extends Error {
  constructor(public readonly kind: "network" | "timeout", message: string) {
    super(message);
    this.name = "ApiRequestError";
  }
}

function isNetworkFailure(error: unknown): boolean {
  return error instanceof TypeError || (error instanceof Error && /load failed|failed to fetch|networkerror|network request failed/i.test(error.message));
}

type ExchangeResponse = { token: string; user: { id: string; email: string; displayName: string; avatarUrl?: string } };
type PushResponse = { applied: Array<{ mutationId: string; entity?: "task" | "habit"; task?: Task; habit?: Habit; revision: number }> };
type PullResponse = { tasks: Task[]; habits?: Habit[]; revision: number };
export type ServerSettings = { openrouterApiKey: string; webSearch: boolean };

async function requestOnce<T>(url: string, path: string, init: RequestInit, token: string | undefined, timeoutMs: number): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const externalSignal = init.signal;
  const abortFromCaller = () => controller.abort();
  if (externalSignal) {
    if (externalSignal.aborted) controller.abort();
    else externalSignal.addEventListener("abort", abortFromCaller, { once: true });
  }

  try {
    const response = await fetch(`${url}${path}`, {
      ...init,
      signal: controller.signal,
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...init.headers },
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({})) as { error?: string };
      throw new Error(body.error ?? `Prior API returned ${response.status}`);
    }
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  } catch (error) {
    if (externalSignal?.aborted) throw error;
    if (controller.signal.aborted) throw new ApiRequestError("timeout", "Prior API request timed out. Check your connection and try again.");
    if (isNetworkFailure(error)) throw new ApiRequestError("network", "Prior could not reach the server. Check your connection and try again.");
    throw error;
  } finally {
    clearTimeout(timeout);
    externalSignal?.removeEventListener("abort", abortFromCaller);
  }
}

async function request<T>(path: string, init: RequestInit = {}, token?: string, timeoutMs = REQUEST_TIMEOUT_MS): Promise<T> {
  const urls = FALLBACK_API_URL ? [API_URL, FALLBACK_API_URL] : [API_URL];
  let lastError: unknown;
  for (const url of urls) {
    try {
      return await requestOnce<T>(url, path, init, token, timeoutMs);
    } catch (error) {
      lastError = error;
      if (!(error instanceof ApiRequestError) || error.kind !== "network" || url === urls.at(-1)) throw error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Prior could not reach the server. Check your connection and try again.");
}

export const api = {
  register(email: string, password: string, displayName: string): Promise<ExchangeResponse> {
    return request<ExchangeResponse>("/v1/auth/register", { method: "POST", body: JSON.stringify({ email, password, displayName, device: "Prior", platform: "web" }) });
  },
  login(email: string, password: string): Promise<ExchangeResponse> {
    return request<ExchangeResponse>("/v1/auth/login", { method: "POST", body: JSON.stringify({ email, password, device: "Prior", platform: "web" }) });
  },
  async exchange(code: string): Promise<ExchangeResponse> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    try {
      return await request<ExchangeResponse>("/v1/auth/exchange", { method: "POST", body: JSON.stringify({ code }), signal: controller.signal }, undefined, 30_000);
    } catch (error) {
      if (controller.signal.aborted) throw new Error("Sign-in timed out. Check your connection and try again.");
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  },
  logout(token: string): Promise<void> {
    return request<void>("/v1/auth/logout", { method: "POST" }, token, 5_000);
  },
  googleNative(idToken: string): Promise<ExchangeResponse> {
    return request<ExchangeResponse>("/v1/auth/google/native", { method: "POST", body: JSON.stringify({ id_token: idToken, device: "Prior", platform: "android" }) });
  },
  push(mutations: Mutation[], token: string): Promise<PushResponse> {
    return request<PushResponse>("/v1/sync/push", { method: "POST", body: JSON.stringify({ mutations }) }, token);
  },
  pull(since: number, token: string): Promise<PullResponse> {
    return request<PullResponse>(`/v1/sync/pull?since=${encodeURIComponent(since)}`, {}, token);
  },
  listAgentChats(token: string): Promise<AgentChatSummary[]> {
    return request<AgentChatSummary[]>("/v1/agent/chats", {}, token);
  },
  createAgentChat(title: string, token: string): Promise<AgentChatSummary> {
    return request<AgentChatSummary>("/v1/agent/chats", { method: "POST", body: JSON.stringify({ title }) }, token);
  },
  getAgentChat(chatId: string, token: string): Promise<AgentChat> {
    return request<AgentChat>(`/v1/agent/chats/${encodeURIComponent(chatId)}`, {}, token);
  },
  saveAgentChatMessage(chatId: string, message: AgentMessage, token: string): Promise<AgentMessage> {
    return request<AgentMessage>(`/v1/agent/chats/${encodeURIComponent(chatId)}/messages`, { method: "POST", body: JSON.stringify(message) }, token);
  },
  getSettings(token: string): Promise<ServerSettings> {
    return request<ServerSettings>("/v1/settings", {}, token);
  },
  saveSettings(settings: ServerSettings, token: string): Promise<ServerSettings> {
    return request<ServerSettings>("/v1/settings", { method: "POST", body: JSON.stringify(settings) }, token);
  },
};
