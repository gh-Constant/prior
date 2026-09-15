import type { Mutation, Task } from "../types";

export const API_URL = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, "") ?? "http://localhost:8080";

type ExchangeResponse = { token: string; user: { id: string; email: string; displayName: string; avatarUrl?: string } };
type PushResponse = { applied: Array<{ mutationId: string; task: Task; revision: number }> };
type PullResponse = { tasks: Task[]; revision: number };

async function request<T>(path: string, init: RequestInit = {}, token?: string): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...init.headers },
  });
  if (!response.ok) throw new Error(`Prior API returned ${response.status}`);
  return (await response.json()) as T;
}

export const api = {
  exchange(code: string): Promise<ExchangeResponse> {
    return request<ExchangeResponse>("/v1/auth/exchange", { method: "POST", body: JSON.stringify({ code }) });
  },
  logout(token: string): Promise<void> {
    return request<void>("/v1/auth/logout", { method: "POST" }, token);
  },
  push(mutations: Mutation[], token: string): Promise<PushResponse> {
    return request<PushResponse>("/v1/sync/push", { method: "POST", body: JSON.stringify({ mutations }) }, token);
  },
  pull(since: number, token: string): Promise<PullResponse> {
    return request<PullResponse>(`/v1/sync/pull?since=${encodeURIComponent(since)}`, {}, token);
  },
};
