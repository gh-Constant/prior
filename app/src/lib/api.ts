import type { Habit, Mutation, Task } from "../types";

export const API_URL = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, "") ?? "http://localhost:8080";

type ExchangeResponse = { token: string; user: { id: string; email: string; displayName: string; avatarUrl?: string } };
export type PasswordAuthResponse = ExchangeResponse;
type PushResponse = { applied: Array<{ mutationId: string; entity?: "task" | "habit"; task?: Task; habit?: Habit; revision: number }> };
type PullResponse = { tasks: Task[]; habits?: Habit[]; revision: number };

async function request<T>(path: string, init: RequestInit = {}, token?: string): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...init.headers },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error ?? `Prior API returned ${response.status}`);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export const api = {
  register(email: string, password: string, displayName: string): Promise<PasswordAuthResponse> {
    return request<PasswordAuthResponse>("/v1/auth/register", { method: "POST", body: JSON.stringify({ email, password, displayName, device: "Prior", platform: "web" }) });
  },
  login(email: string, password: string): Promise<PasswordAuthResponse> {
    return request<PasswordAuthResponse>("/v1/auth/login", { method: "POST", body: JSON.stringify({ email, password, device: "Prior", platform: "web" }) });
  },
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
