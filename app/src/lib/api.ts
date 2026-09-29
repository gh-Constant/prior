import type { AgentChat, AgentMessage, AgentChatSummary, Area, Habit, Mutation, Project, ProjectCycle, ProjectHealth, Task } from "../types";
import type { Note, NoteFolder } from "./notes";
import { translateStored } from "./i18n";
import { isTauri } from "./platform";
import type { DocumentMutation, DocumentValue } from "./accountDocuments";

export type WorkspaceSnapshot = {
  areas: Area[];
  projects: Project[];
  folders: NoteFolder[];
  notes: Note[];
};

const isNativeApp = isTauri();
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

export class ApiRequestError extends Error {
  constructor(public readonly kind: "network" | "timeout" | "server" | "rate_limited", message: string, public readonly status?: number) {
    super(message);
    this.name = "ApiRequestError";
  }
}

export class ApiAuthError extends Error {
  readonly status = 401;
  constructor(message = "Your session has expired. Please sign in again.") {
    super(message);
    this.name = "ApiAuthError";
  }
}

/** The owner's plan does not allow this (402 PLAN_LIMIT). */
export class PlanLimitError extends Error {
  constructor(message: string, public readonly limit: "members" | "projects") {
    super(message);
    this.name = "PlanLimitError";
  }
}

export function isAuthError(error: unknown): boolean {
  return error instanceof ApiAuthError;
}

export function isRateLimitedError(error: unknown): boolean {
  return error instanceof ApiRequestError && error.kind === "rate_limited";
}

export function isRetriableError(error: unknown): boolean {
  if (error instanceof ApiRequestError) return error.kind === "network" || error.kind === "server";
  return false;
}

function isNetworkFailure(error: unknown): boolean {
  return error instanceof TypeError || (error instanceof Error && /load failed|failed to fetch|networkerror|network request failed/i.test(error.message));
}

type ExchangeResponse = { token: string; user: { id: string; email: string; displayName: string; avatarUrl?: string } };
type PushResponse = { applied: Array<{ mutationId: string; entity?: "task" | "habit"; task?: Task; habit?: Habit; revision: number }>; results?: Array<{ mutationId: string; ok: boolean; revision?: number; entity?: string; task?: Task; habit?: Habit; error?: { code: string; message: string } }> };
type PullResponse = { tasks: Task[]; habits?: Habit[]; revision: number; nextSince?: number; hasMore?: boolean; workspaceRevision?: number; profile?: { displayName: string; profileRevision: number; updatedAt: string } };
export type ServerSettings = { openrouterApiKey: string; recommendationOpenrouterApiKey?: string; openaiApiKey: string; webSearch: boolean; initialized?: boolean };
export type ProfileUser = { id: string; email: string; displayName: string; avatarUrl?: string };
export type CollaborationMember = { userId: string; email: string; displayName: string; avatarUrl?: string; role: "owner" | "editor" | "viewer"; status: "active" | "revoked"; createdAt: string };
export type CollaborationInvite = { id: string; email: string; role: "editor" | "viewer"; expiresAt: string; inviteToken?: string; projectId: string };
export type CollaborationProject = { project: Project; role: "owner" | "editor" | "viewer"; members: CollaborationMember[]; pendingInvites?: CollaborationInvite[] };
export type CollaborativeProjectUpdate = Pick<Project, "health" | "startDate" | "targetDate" | "cycles"> & {
  health?: ProjectHealth | null;
  cycles?: ProjectCycle[];
};
export type SessionInfo = {
  id: string;
  deviceName: string;
  platform: string;
  createdAt: string;
  lastUsedAt: string;
  expiresAt: string;
  current: boolean;
};

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
    const headers = new Headers(init.headers);
    if (!headers.has("Content-Type") && !(typeof FormData !== "undefined" && init.body instanceof FormData)) {
      headers.set("Content-Type", "application/json");
    }
    if (token) headers.set("Authorization", `Bearer ${token}`);
    const response = await fetch(`${url}${path}`, {
      ...init,
      signal: controller.signal,
      headers,
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({})) as { error?: string; code?: string; limit?: string };
      const message = body.error ?? `Prior API returned ${response.status}`;
      if (response.status === 401) throw new ApiAuthError(message);
      if (response.status === 402 && body.code === "PLAN_LIMIT") throw new PlanLimitError(message, body.limit === "projects" ? "projects" : "members");
      if (response.status === 429) throw new ApiRequestError("rate_limited", message, response.status);
      if (response.status >= 500) throw new ApiRequestError("server", message, response.status);
      throw new Error(message);
    }
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  } catch (error) {
    if (error instanceof ApiAuthError) throw error;
    if (externalSignal?.aborted) throw error;
    if (controller.signal.aborted) throw new ApiRequestError("timeout", "Prior API request timed out. Check your connection and try again.");
    if (error instanceof ApiRequestError) throw error;
    if (isNetworkFailure(error)) throw new ApiRequestError("network", "Prior could not reach the server. Check your connection and try again.");
    throw error;
  } finally {
    clearTimeout(timeout);
    externalSignal?.removeEventListener("abort", abortFromCaller);
  }
}

function backoffDelayMs(attempt: number): number {
  const base = 500 * 2 ** attempt;
  const capped = Math.min(base, 4000);
  return capped + Math.floor(Math.random() * 250);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}

async function requestWithRetry<T>(url: string, path: string, init: RequestInit, token: string | undefined, timeoutMs: number, maxRetries = 2): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      return await requestOnce<T>(url, path, init, token, timeoutMs);
    } catch (error) {
      lastError = error;
      if (error instanceof ApiAuthError) throw error;
      // Only network failures and 5xx are retried with backoff. 4xx (validation,
      // auth, rate-limit) must surface immediately so callers can react.
      if (!isRetriableError(error) || attempt === maxRetries) throw error;
      await delay(backoffDelayMs(attempt));
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Prior could not reach the server. Check your connection and try again.");
}

async function request<T>(path: string, init: RequestInit = {}, token?: string, timeoutMs = REQUEST_TIMEOUT_MS): Promise<T> {
  const urls = FALLBACK_API_URL ? [API_URL, FALLBACK_API_URL] : [API_URL];
  let lastError: unknown;
  for (const url of urls) {
    try {
      return await requestWithRetry<T>(url, path, init, token, timeoutMs);
    } catch (error) {
      lastError = error;
      // The fallback URL only helps when the primary is unreachable. Auth and
      // client errors must not spill over to the production endpoint.
      if (error instanceof ApiAuthError || !(error instanceof ApiRequestError) || error.kind !== "network" || url === urls.at(-1)) throw error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Prior could not reach the server. Check your connection and try again.");
}

export type PlanId = "free" | "pro" | "team" | "enterprise";
export type BillingInterval = "month" | "year";
export type BillingPlan = { id: PlanId; name: string; monthlyCents: number; yearlyCents: number; maxMembersPerProject: number; maxSharedProjects: number; hostedAI: boolean; agentTokensPerMonth: number };
export type BillingState = {
  plan: PlanId;
  source: "free" | "stripe" | "admin";
  subscription: { stripePlan: PlanId; status: string; interval?: BillingInterval; amountCents: number; currency: string; currentPeriodEnd?: string; cancelAtPeriodEnd: boolean; adminPlan?: PlanId };
  entitlements: { plan: PlanId; hostedAI: boolean; agentTokensPerMonth: number; agentTokensUsed: number; usagePeriodStart: string; maxMembersPerProject: number; maxSharedProjects: number };
  plans: BillingPlan[];
  currency: string;
  stripeEnabled: boolean;
  hostedAIReady: boolean;
  isAdmin: boolean;
  hasBillingPortal: boolean;
};
export type AdminTotals = {
  users: number; newUsers7d: number; newUsers30d: number; activeUsers7d: number; payingUsers: number; grantedUsers: number; cancelingUsers: number;
  mrrCents: number; revenue30dCents: number; revenueAllCents: number; aiCost30dMicros: number; aiCostAllMicros: number; aiRequests30d: number; aiTokens30d: number; aiUsers30d: number;
  sharedProjects: number; tasksCreated30d: number;
};
export type AdminOverview = {
  generatedAt: string;
  totals: AdminTotals;
  planCounts: Record<PlanId, number>;
  signups: Array<{ day: string; count: number }>;
  activeDaily: Array<{ day: string; count: number }>;
  revenue: Array<{ month: string; cents: number }>;
  aiCost: Array<{ day: string; micros: number; tokens: number }>;
  aiByPurpose: Array<{ purpose: string; requests: number; tokens: number; micros: number }> | null;
  topSpenders: Array<{ userId: string; email: string; displayName: string; plan: PlanId; micros: number; tokens: number; requests: number }> | null;
  recentPayments: Array<{ invoiceId: string; email: string; amountCents: number; currency: string; paidAt: string }> | null;
};
export type AdminUser = {
  id: string; email: string; displayName: string; avatarUrl?: string; createdAt: string; lastLoginAt: string;
  plan: PlanId; source: "free" | "stripe" | "admin"; stripeStatus: string; interval?: string; amountCents: number; currentPeriodEnd?: string; cancelAtPeriodEnd: boolean;
  adminPlan?: PlanId; revenueCents: number; aiCost30dMicros: number; agentTokensMonth: number; aiRequests30d: number; tasks: number; sharedProjects: number;
};

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
      if (controller.signal.aborted) throw new Error(translateStored("auth.errors.signInTimeout"));
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
  updateProfile(displayName: string, token: string): Promise<ProfileUser> {
    return request<ProfileUser>("/v1/me", { method: "PATCH", body: JSON.stringify({ displayName }) }, token);
  },
  getProfile(token: string): Promise<ProfileUser> {
    return request<ProfileUser>("/v1/me", {}, token);
  },
  transcribe(audio: Blob, filename: string, token: string, signal?: AbortSignal): Promise<{ text: string }> {
    const form = new FormData();
    form.append("file", audio, filename);
    return request<{ text: string }>("/transcribe", { method: "POST", body: form, signal }, token, 120_000);
  },
  push(mutations: Mutation[], token: string): Promise<PushResponse> {
    return request<PushResponse>("/v1/sync/push", { method: "POST", body: JSON.stringify({ mutations }) }, token);
  },
  pull(since: number, token: string): Promise<PullResponse> {
    return request<PullResponse>(`/v1/sync/pull?since=${encodeURIComponent(since)}`, {}, token);
  },
  syncWorkspace(snapshot: WorkspaceSnapshot, token: string): Promise<WorkspaceSnapshot> {
    return request<WorkspaceSnapshot>("/v1/workspace/sync", { method: "POST", body: JSON.stringify(snapshot) }, token, 30_000);
  },
  syncAccountData(mutations: DocumentMutation[], token: string): Promise<{ records: Array<{ key: string; value: DocumentValue | null }>; applied: string[] }> {
    return request("/v1/account-data/sync", { method: "POST", body: JSON.stringify({ mutations }) }, token, 60_000);
  },
  listCollaborativeProjects(token: string): Promise<{ projects: CollaborationProject[] }> {
    return request<{ projects: CollaborationProject[] }>("/v1/collaboration/projects", {}, token, 30_000);
  },
  updateCollaborativeProject(projectId: string, project: CollaborativeProjectUpdate | Project, token: string): Promise<CollaborationProject> {
    const planning = {
      health: project.health ?? null,
      startDate: project.startDate ?? null,
      targetDate: project.targetDate ?? null,
      cycles: project.cycles ?? [],
    };
    return request<CollaborationProject>(`/v1/collaboration/projects/${encodeURIComponent(projectId)}`, { method: "PATCH", body: JSON.stringify(planning) }, token);
  },
  listProjectMembers(projectId: string, token: string): Promise<{ members: CollaborationMember[]; pendingInvites: CollaborationInvite[]; role: CollaborationProject["role"] }> {
    return request<{ members: CollaborationMember[]; pendingInvites: CollaborationInvite[]; role: CollaborationProject["role"] }>(`/v1/collaboration/projects/${encodeURIComponent(projectId)}/members`, {}, token);
  },
  shareProject(projectId: string, email: string, role: "editor" | "viewer", token: string): Promise<{ member?: CollaborationMember; invite?: CollaborationInvite }> {
    return request<{ member?: CollaborationMember; invite?: CollaborationInvite }>(`/v1/collaboration/projects/${encodeURIComponent(projectId)}/members`, { method: "POST", body: JSON.stringify({ email, role }) }, token);
  },
  updateProjectMember(projectId: string, userId: string, role: "editor" | "viewer", token: string): Promise<void> {
    return request<void>(`/v1/collaboration/projects/${encodeURIComponent(projectId)}/members/${encodeURIComponent(userId)}`, { method: "PATCH", body: JSON.stringify({ role }) }, token);
  },
  removeProjectMember(projectId: string, userId: string, token: string): Promise<void> {
    return request<void>(`/v1/collaboration/projects/${encodeURIComponent(projectId)}/members/${encodeURIComponent(userId)}`, { method: "DELETE" }, token);
  },
  revokeProjectInvite(projectId: string, inviteId: string, token: string): Promise<void> {
    return request<void>(`/v1/collaboration/projects/${encodeURIComponent(projectId)}/invites/${encodeURIComponent(inviteId)}`, { method: "DELETE" }, token);
  },
  acceptProjectInvite(tokenValue: string, token: string): Promise<{ projectId: string }> {
    return request<{ projectId: string }>("/v1/collaboration/invites/accept", { method: "POST", body: JSON.stringify({ token: tokenValue }) }, token);
  },
  listAgentChats(token: string): Promise<AgentChatSummary[]> {
    return request<AgentChatSummary[]>("/v1/agent/chats", {}, token);
  },
  createAgentChat(title: string, token: string, id?: string): Promise<AgentChatSummary> {
    return request<AgentChatSummary>("/v1/agent/chats", { method: "POST", body: JSON.stringify({ title, id }) }, token);
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
  listSessions(token: string): Promise<SessionInfo[]> {
    return request<SessionInfo[]>("/v1/sessions", {}, token);
  },
  revokeSession(sessionId: string, token: string): Promise<void> {
    return request<void>(`/v1/sessions/${encodeURIComponent(sessionId)}`, { method: "DELETE" }, token);
  },
  revokeAllSessions(token: string): Promise<void> {
    return request<void>("/v1/sessions", { method: "DELETE" }, token);
  },
  agentComplete(
    input: {
      model: string; prompt: string; system: string; history: Array<{ role: string; content: string }>; webSearch: boolean; reasoningEffort?: string;
      purpose?: "agent" | "recommendations" | "mail" | "calendar";
      /** "hosted" forces Prior AI; omitted uses the stored key, then Prior AI. */
      provider?: "hosted";
      /** Ask the model for a JSON object (response_format). */
      json?: boolean;
    },
    token: string,
  ): Promise<{ content: string; actualModel: string; provider?: "hosted" | "openrouter" }> {
    return request<{ content: string; actualModel: string; provider?: "hosted" | "openrouter" }>("/v1/agent/complete", { method: "POST", body: JSON.stringify(input) }, token, 90_000);
  },
  /** Whether this API offers Prior AI (hosted assistant and dictation). */
  hostedAiStatus(token: string): Promise<HostedAiStatus> {
    return request<HostedAiStatus>("/v1/agent/hosted", {}, token);
  },
  getBilling(token: string): Promise<BillingState> {
    return request<BillingState>("/v1/billing", {}, token);
  },
  startCheckout(input: { plan: PlanId; interval: BillingInterval; returnUrl?: string; locale?: string }, token: string): Promise<{ url: string; kind: "checkout" | "portal" }> {
    return request<{ url: string; kind: "checkout" | "portal" }>("/v1/billing/checkout", { method: "POST", body: JSON.stringify(input) }, token, 30_000);
  },
  openBillingPortal(returnUrl: string | undefined, token: string): Promise<{ url: string }> {
    return request<{ url: string }>("/v1/billing/portal", { method: "POST", body: JSON.stringify({ returnUrl }) }, token, 30_000);
  },
  syncBilling(sessionId: string | undefined, token: string): Promise<BillingState> {
    return request<BillingState>("/v1/billing/sync", { method: "POST", body: JSON.stringify({ sessionId }) }, token, 30_000);
  },
  adminOverview(token: string): Promise<{ overview: AdminOverview; plans: BillingPlan[]; stripeMode: string; hostedAIReady: boolean }> {
    return request("/v1/admin/overview", {}, token, 30_000);
  },
  adminUsers(query: { q?: string; plan?: string; sort?: string; limit?: number; offset?: number }, token: string): Promise<{ users: AdminUser[]; total: number }> {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) if (value !== undefined && value !== "") params.set(key, String(value));
    return request(`/v1/admin/users?${params.toString()}`, {}, token, 30_000);
  },
  adminSetPlan(userId: string, plan: PlanId | "", token: string): Promise<{ plan: string }> {
    return request(`/v1/admin/users/${encodeURIComponent(userId)}/plan`, { method: "PUT", body: JSON.stringify({ plan }) }, token);
  },
};

export type HostedAiStatus = {
  available: boolean;
  transcription: boolean;
  dailyLimit: number;
  usedToday: number;
  models?: Record<"agent" | "recommendations" | "mail" | "calendar", string>;
};
