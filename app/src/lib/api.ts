import { setOnline } from "./connectivity";
import type { AgentChat, AgentMessage, AgentChatSummary, Area, Habit, Mutation, Project, ProjectCycle, ProjectHealth, Task } from "../types";
import type { Note, NoteFolder } from "./notes";
import { translateStored } from "./i18n";
import { isTauri } from "./platform";
import type { DocumentMutation, DocumentValue } from "./accountDocuments";
import type { ChestDrop, GameBoard, GameEquipped, GameLeague, GameProfile, GameSettingsPatch, GameState, InvitePreview, ProjectLeaderboard, ProjectLeaderboardMode } from "./gamification/state";

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

/** The account as GET /v1/me returns it (never a secret). */
export type AccountUser = {
  id: string;
  email: string;
  displayName: string;
  avatarUrl?: string;
  emailVerified?: boolean;
  emailVerifiedAt?: string;
  hasPassword?: boolean;
  googleLinked?: boolean;
  twoFactorEnabled?: boolean;
  locale?: string;
  createdAt?: string;
};
type ExchangeResponse = { token: string; user: AccountUser };
/** Sign-in answers with a session, or a 2FA challenge when 2FA is on. */
export type SignInResponse = ExchangeResponse | { twoFactorRequired: true; challenge: string; expiresAt: string };
export function isTwoFactorChallenge(response: SignInResponse): response is { twoFactorRequired: true; challenge: string; expiresAt: string } {
  return "twoFactorRequired" in response && response.twoFactorRequired === true;
}
/** A refused request with a stable machine code (INVALID_PASSWORD, REAUTH_REQUIRED…). */
export class ApiCodeError extends Error {
  constructor(message: string, public readonly code: string, public readonly status: number) {
    super(message);
    this.name = "ApiCodeError";
  }
}
export function apiErrorCode(error: unknown): string | undefined {
  return error instanceof ApiCodeError ? error.code : undefined;
}
export type CommentAuthor = { id: string; displayName: string; avatarUrl?: string };
export type TaskComment = { id: string; taskId: string; projectId: string; author: CommentAuthor | null; body: string; mentions: string[]; createdAt: string; editedAt?: string };
export type MentionNotification = { commentId: string; taskId: string; taskTitle: string; projectId: string; projectName: string; authorName: string; excerpt: string; createdAt: string; readAt?: string };

/** Planning Poker (specs/SCRUM.md): decks are fixed lists of card values (strings). */
export type PokerDeckId = "fibonacci" | "modified" | "tshirt";
export type PokerItem = { taskId: string; title: string; storyPoints: number | null; finalPoints: number | null };
export type PokerParticipant = {
  userId: string;
  displayName: string;
  avatarUrl?: string | null;
  role: "owner" | "editor" | "viewer";
  online: boolean;
  presence?: "online" | "away" | "offline";
  lastSeenAt?: string;
  voted: boolean;
  /** Other people's cards stay null until the cards are revealed. */
  vote: string | null;
};
export type PokerSession = {
  id: string;
  projectId: string;
  status: "active" | "closed";
  deck: PokerDeckId;
  facilitatorId: string | null;
  /** The signed-in account may reveal, re-vote, accept and move on. */
  canControl: boolean;
  currentIndex: number;
  round: number;
  revealed: boolean;
  items: PokerItem[];
  participants: PokerParticipant[];
  /** The viewer's own card, always visible to them. */
  myVote: string | null;
  createdAt: string;
  updatedAt: string;
};

function pokerBase(projectId: string): string {
  return `/v1/collaboration/projects/${encodeURIComponent(projectId)}/poker`;
}
export type TwoFactorStatus = { enabled: boolean; available: boolean; recoveryCodesLeft: number };
export type ReauthInput = { email?: string; password?: string; code?: string; recoveryCode?: string };
type PushResponse = { applied: Array<{ mutationId: string; entity?: "task" | "habit"; task?: Task; habit?: Habit; revision: number }>; results?: Array<{ mutationId: string; ok: boolean; revision?: number; entity?: string; task?: Task; habit?: Habit; error?: { code: string; message: string } }> };
type PullResponse = { tasks: Task[]; habits?: Habit[]; revision: number; nextSince?: number; hasMore?: boolean; workspaceRevision?: number; profile?: { displayName: string; profileRevision: number; updatedAt: string } };
export type ServerSettings = { openrouterApiKey: string; recommendationOpenrouterApiKey?: string; openaiApiKey: string; webSearch: boolean; initialized?: boolean };
export type ProfileUser = AccountUser;
export type CollaborationMember = { userId: string; email: string; displayName: string; avatarUrl?: string; role: "owner" | "editor" | "viewer"; status: "active" | "revoked"; createdAt: string; /** A live realtime connection right now. */ online?: boolean; /** online (active), away (idle or hidden) or offline; absent on older servers. */ presence?: "online" | "away" | "offline"; /** When an offline member last disconnected, if the API knows. */ lastSeenAt?: string };
export type CollaborationInvite = { id: string; email: string; role: "editor" | "viewer"; expiresAt: string; inviteToken?: string; projectId: string };
/** A pending invite addressed to the signed-in account. */
export type IncomingProjectInvite = { id: string; projectId: string; projectName: string; inviterName: string; inviterId: string; role: "editor" | "viewer"; expiresAt: string; createdAt: string };
export type CollaborationProject = { project: Project; role: "owner" | "editor" | "viewer"; members: CollaborationMember[]; pendingInvites?: CollaborationInvite[] };
export type CollaborativeProjectUpdate = Pick<Project, "health" | "startDate" | "targetDate" | "cycles"> & Partial<Pick<Project, "name" | "description" | "status" | "icon" | "projectType" | "methodology" | "milestones">> & {
  health?: ProjectHealth | null;
  cycles?: ProjectCycle[];
};
/** A partial PATCH of a shared project: only the keys present are changed. */
export type CollaborativeProjectPatch = {
  name?: string;
  description?: string;
  status?: Project["status"];
  icon?: string | null;
  projectType?: NonNullable<Project["projectType"]>;
  methodology?: NonNullable<Project["methodology"]> | null;
  health?: ProjectHealth | null;
  startDate?: string | null;
  targetDate?: string | null;
  cycles?: ProjectCycle[];
  milestones?: NonNullable<Project["milestones"]>;
};
/** What the share dialog needs to confirm an invitation. */
/** A reusable invitation link of a project (the secret itself is shown once, at creation). */
export type ShareLink = { id: string; projectId: string; role: "editor" | "viewer"; createdAt: string; expiresAt?: string; useCount: number; maxUses?: number };
/** What joining with an invitation token did: new member, viewer made editor, or nothing to change. */
export type JoinResult = { projectId: string; result?: "joined" | "upgraded" | "already_member"; role?: "owner" | "editor" | "viewer" };
export type ProjectInviteResult = { invite: CollaborationInvite; inviteLink: string; emailSent: boolean };
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
      if (response.status === 429) {
        if (body.code === "TWO_FACTOR_LOCKED") throw new ApiCodeError(message, body.code, response.status);
        throw new ApiRequestError("rate_limited", message, response.status);
      }
      if (response.status >= 500) {
        if (body.code === "BILLING_CANCEL_FAILED" || body.code === "TWO_FACTOR_UNAVAILABLE") throw new ApiCodeError(message, body.code, response.status);
        throw new ApiRequestError("server", message, response.status);
      }
      if (body.code) throw new ApiCodeError(message, body.code, response.status);
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

function externalAbort(init: RequestInit): boolean {
  return Boolean(init.signal?.aborted);
}

async function request<T>(path: string, init: RequestInit = {}, token?: string, timeoutMs = REQUEST_TIMEOUT_MS): Promise<T> {
  const urls = FALLBACK_API_URL ? [API_URL, FALLBACK_API_URL] : [API_URL];
  let lastError: unknown;
  for (const url of urls) {
    try {
      const result = await requestWithRetry<T>(url, path, init, token, timeoutMs);
      setOnline(true);
      return result;
    } catch (error) {
      lastError = error;
      if (error instanceof ApiRequestError && (error.kind === "network" || error.kind === "timeout")) {
        if (url === urls.at(-1)) setOnline(false);
      } else if (!(externalAbort(init))) setOnline(true);
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

/** Downloads an authenticated binary response (the data export). */
async function requestBlob(path: string, token: string, timeoutMs = 120_000): Promise<{ blob: Blob; filename: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${API_URL}${path}`, { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal });
    if (!response.ok) {
      const body = await response.json().catch(() => ({})) as { error?: string; code?: string };
      const message = body.error ?? `Prior API returned ${response.status}`;
      if (response.status === 401) throw new ApiAuthError(message);
      if (response.status === 429) throw new ApiRequestError("rate_limited", message, response.status);
      throw new Error(message);
    }
    const disposition = response.headers.get("Content-Disposition") ?? "";
    const filename = /filename="([^"]+)"/.exec(disposition)?.[1] ?? "prior-export.zip";
    return { blob: await response.blob(), filename };
  } catch (error) {
    if (controller.signal.aborted) throw new ApiRequestError("timeout", "Prior API request timed out. Check your connection and try again.");
    if (isNetworkFailure(error)) throw new ApiRequestError("network", "Prior could not reach the server. Check your connection and try again.");
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export const api = {
  register(email: string, password: string, displayName: string, language?: string): Promise<ExchangeResponse> {
    return request<ExchangeResponse>("/v1/auth/register", { method: "POST", body: JSON.stringify({ email, password, displayName, device: "Prior", platform: "web", language }) });
  },
  login(email: string, password: string, language?: string): Promise<SignInResponse> {
    return request<SignInResponse>("/v1/auth/login", { method: "POST", body: JSON.stringify({ email, password, device: "Prior", platform: "web", language }) });
  },
  verifyTwoFactor(challenge: string, input: { code?: string; recoveryCode?: string }): Promise<ExchangeResponse> {
    return request<ExchangeResponse>("/v1/auth/2fa/verify", { method: "POST", body: JSON.stringify({ challenge, ...input }) });
  },
  forgotPassword(email: string, language: string): Promise<void> {
    return request<void>("/v1/auth/password/forgot", { method: "POST", body: JSON.stringify({ email, language }) });
  },
  resetPassword(resetToken: string, password: string): Promise<void> {
    return request<void>("/v1/auth/password/reset", { method: "POST", body: JSON.stringify({ token: resetToken, password }) });
  },
  verifyEmail(verifyToken: string): Promise<{ verified: boolean }> {
    return request<{ verified: boolean }>("/v1/auth/email/verify", { method: "POST", body: JSON.stringify({ token: verifyToken }) });
  },
  resendVerification(language: string, token: string): Promise<{ alreadyVerified?: boolean } | undefined> {
    return request<{ alreadyVerified?: boolean } | undefined>("/v1/auth/email/verify/resend", { method: "POST", body: JSON.stringify({ language }) }, token);
  },
  twoFactorStatus(token: string): Promise<TwoFactorStatus> {
    return request<TwoFactorStatus>("/v1/auth/2fa", {}, token);
  },
  twoFactorSetup(token: string): Promise<{ secret: string; otpauthUrl: string }> {
    return request<{ secret: string; otpauthUrl: string }>("/v1/auth/2fa/setup", { method: "POST" }, token);
  },
  twoFactorEnable(code: string, token: string): Promise<{ recoveryCodes: string[] }> {
    return request<{ recoveryCodes: string[] }>("/v1/auth/2fa/enable", { method: "POST", body: JSON.stringify({ code }) }, token);
  },
  twoFactorDisable(input: ReauthInput, token: string): Promise<void> {
    return request<void>("/v1/auth/2fa/disable", { method: "POST", body: JSON.stringify({ password: input.password, code: input.code, recoveryCode: input.recoveryCode }) }, token);
  },
  twoFactorRecoveryCodes(code: string, token: string): Promise<{ recoveryCodes: string[] }> {
    return request<{ recoveryCodes: string[] }>("/v1/auth/2fa/recovery-codes", { method: "POST", body: JSON.stringify({ code }) }, token);
  },
  deleteAccount(input: ReauthInput, token: string): Promise<void> {
    return request<void>("/v1/me", { method: "DELETE", body: JSON.stringify({ email: input.email ?? "", password: input.password, code: input.code, recoveryCode: input.recoveryCode }) }, token, 60_000);
  },
  exportAccount(token: string): Promise<{ blob: Blob; filename: string }> {
    return requestBlob("/v1/me/export", token);
  },
  async exchange(code: string): Promise<SignInResponse> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    try {
      return await request<SignInResponse>("/v1/auth/exchange", { method: "POST", body: JSON.stringify({ code }), signal: controller.signal }, undefined, 30_000);
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
  googleNative(idToken: string): Promise<SignInResponse> {
    return request<SignInResponse>("/v1/auth/google/native", { method: "POST", body: JSON.stringify({ id_token: idToken, device: "Prior", platform: "android" }) });
  },
  updateProfile(displayName: string, token: string): Promise<AccountUser> {
    return request<AccountUser>("/v1/me", { method: "PATCH", body: JSON.stringify({ displayName }) }, token);
  },
  getProfile(token: string): Promise<AccountUser> {
    return request<AccountUser>("/v1/me", {}, token);
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
      ...(project.name !== undefined ? { name: project.name } : {}),
      ...(project.description !== undefined ? { description: project.description } : {}),
      ...(project.status !== undefined ? { status: project.status } : {}),
      ...(project.icon !== undefined ? { icon: project.icon ?? null } : {}),
      ...(project.projectType !== undefined ? { projectType: project.projectType } : {}),
      ...(project.methodology !== undefined ? { methodology: project.methodology } : {}),
      health: project.health ?? null,
      startDate: project.startDate ?? null,
      targetDate: project.targetDate ?? null,
      cycles: project.cycles ?? [],
      ...(project.milestones !== undefined ? { milestones: project.milestones } : {}),
    };
    return request<CollaborationProject>(`/v1/collaboration/projects/${encodeURIComponent(projectId)}`, { method: "PATCH", body: JSON.stringify(planning) }, token);
  },
  /**
   * Sends exactly the fields in `patch` (omitted fields keep the server value,
   * null clears one). Shared projects save through this so a field nobody
   * touched, such as the project type, is never rewritten from a local copy.
   */
  patchCollaborativeProject(projectId: string, patch: CollaborativeProjectPatch, token: string): Promise<CollaborationProject> {
    return request<CollaborationProject>(`/v1/collaboration/projects/${encodeURIComponent(projectId)}`, { method: "PATCH", body: JSON.stringify(patch) }, token);
  },
  listProjectMembers(projectId: string, token: string): Promise<{ members: CollaborationMember[]; pendingInvites: CollaborationInvite[]; role: CollaborationProject["role"] }> {
    return request<{ members: CollaborationMember[]; pendingInvites: CollaborationInvite[]; role: CollaborationProject["role"] }>(`/v1/collaboration/projects/${encodeURIComponent(projectId)}/members`, {}, token);
  },
  /** Invites an email (emailed with a link) or changes an existing member's role. */
  shareProject(projectId: string, email: string, role: "editor" | "viewer", token: string, language?: string): Promise<{ member?: CollaborationMember } & Partial<ProjectInviteResult>> {
    return request<{ member?: CollaborationMember } & Partial<ProjectInviteResult>>(`/v1/collaboration/projects/${encodeURIComponent(projectId)}/members`, { method: "POST", body: JSON.stringify({ email, role, language }) }, token);
  },
  /** Tasks completed/created per day and person in a project (activity grid). */
  projectActivity(projectId: string, timeZone: string, token: string): Promise<{ entries: Array<{ date: string; userId: string | null; completed: number; created: number }> }> {
    return request(`/v1/collaboration/projects/${encodeURIComponent(projectId)}/activity?tz=${encodeURIComponent(timeZone)}`, {}, token);
  },
  /** Rotates a pending invite's link; emails it again unless `email` is false. */
  resendProjectInvite(projectId: string, inviteId: string, options: { email: boolean; language?: string }, token: string): Promise<ProjectInviteResult> {
    return request<ProjectInviteResult>(`/v1/collaboration/projects/${encodeURIComponent(projectId)}/invites/${encodeURIComponent(inviteId)}/resend`, { method: "POST", body: JSON.stringify(options) }, token);
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
  /** Joins with an invitation token: an email invitation or a share link. */
  acceptProjectInvite(tokenValue: string, token: string): Promise<JoinResult> {
    return request<JoinResult>("/v1/collaboration/invites/accept", { method: "POST", body: JSON.stringify({ token: tokenValue }) }, token);
  },
  listShareLinks(projectId: string, token: string): Promise<{ links: ShareLink[] }> {
    return request<{ links: ShareLink[] }>(`/v1/collaboration/projects/${encodeURIComponent(projectId)}/share-links`, {}, token);
  },
  /** Creates the link of a role, replacing (disabling) the previous one of that role. */
  createShareLink(projectId: string, input: { role: "editor" | "viewer"; expiresInDays?: number }, token: string): Promise<{ link: ShareLink; inviteLink: string }> {
    return request<{ link: ShareLink; inviteLink: string }>(`/v1/collaboration/projects/${encodeURIComponent(projectId)}/share-links`, { method: "POST", body: JSON.stringify(input) }, token);
  },
  revokeShareLink(projectId: string, linkId: string, token: string): Promise<void> {
    return request<void>(`/v1/collaboration/projects/${encodeURIComponent(projectId)}/share-links/${encodeURIComponent(linkId)}`, { method: "DELETE" }, token);
  },
  listIncomingInvites(token: string): Promise<{ invites: IncomingProjectInvite[] }> {
    return request<{ invites: IncomingProjectInvite[] }>("/v1/collaboration/invites", {}, token);
  },
  respondToInvite(inviteId: string, accept: boolean, token: string): Promise<{ projectId: string }> {
    return request<{ projectId: string }>(`/v1/collaboration/invites/${encodeURIComponent(inviteId)}/${accept ? "accept" : "decline"}`, { method: "POST" }, token);
  },
  listTaskComments(projectId: string, taskId: string, token: string): Promise<{ comments: TaskComment[] }> {
    return request(`/v1/collaboration/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}/comments`, {}, token);
  },
  createTaskComment(projectId: string, taskId: string, input: { id: string; body: string; mentions: string[] }, token: string): Promise<TaskComment> {
    return request(`/v1/collaboration/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}/comments`, { method: "POST", body: JSON.stringify(input) }, token);
  },
  updateTaskComment(projectId: string, taskId: string, commentId: string, input: { body: string; mentions: string[] }, token: string): Promise<TaskComment> {
    return request(`/v1/collaboration/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}/comments/${encodeURIComponent(commentId)}`, { method: "PATCH", body: JSON.stringify(input) }, token);
  },
  deleteTaskComment(projectId: string, taskId: string, commentId: string, token: string): Promise<void> {
    return request<void>(`/v1/collaboration/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}/comments/${encodeURIComponent(commentId)}`, { method: "DELETE" }, token);
  },
  listMentions(token: string): Promise<{ mentions: MentionNotification[]; unread: number }> {
    return request("/v1/collaboration/mentions", {}, token);
  },
  readMentions(commentIds: string[], token: string): Promise<void> {
    return request<void>("/v1/collaboration/mentions/read", { method: "POST", body: JSON.stringify({ commentIds }) }, token);
  },
  pokerActive(projectId: string, token: string): Promise<{ session: PokerSession | null }> {
    return request(pokerBase(projectId), {}, token);
  },
  pokerStart(projectId: string, input: { taskIds: string[]; deck: PokerDeckId }, token: string): Promise<PokerSession> {
    return request(pokerBase(projectId), { method: "POST", body: JSON.stringify(input) }, token);
  },
  pokerGet(projectId: string, sessionId: string, token: string): Promise<PokerSession> {
    return request(`${pokerBase(projectId)}/${encodeURIComponent(sessionId)}`, {}, token);
  },
  pokerVote(projectId: string, sessionId: string, taskId: string, value: string | null, token: string): Promise<PokerSession> {
    return request(`${pokerBase(projectId)}/${encodeURIComponent(sessionId)}/vote`, { method: "PUT", body: JSON.stringify({ taskId, value }) }, token);
  },
  pokerReveal(projectId: string, sessionId: string, token: string): Promise<PokerSession> {
    return request(`${pokerBase(projectId)}/${encodeURIComponent(sessionId)}/reveal`, { method: "POST" }, token);
  },
  pokerRevote(projectId: string, sessionId: string, token: string): Promise<PokerSession> {
    return request(`${pokerBase(projectId)}/${encodeURIComponent(sessionId)}/revote`, { method: "POST" }, token);
  },
  pokerSetCurrent(projectId: string, sessionId: string, index: number, token: string): Promise<PokerSession> {
    return request(`${pokerBase(projectId)}/${encodeURIComponent(sessionId)}/current`, { method: "POST", body: JSON.stringify({ index }) }, token);
  },
  pokerEstimate(projectId: string, sessionId: string, input: { taskId: string; storyPoints: number | null; advance: boolean }, token: string): Promise<{ session: PokerSession; task: Task }> {
    return request(`${pokerBase(projectId)}/${encodeURIComponent(sessionId)}/estimate`, { method: "POST", body: JSON.stringify(input) }, token);
  },
  pokerClose(projectId: string, sessionId: string, token: string): Promise<PokerSession> {
    return request(`${pokerBase(projectId)}/${encodeURIComponent(sessionId)}/close`, { method: "POST" }, token);
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
  createMcpToken(name: string, token: string): Promise<{ token: string; name: string; expiresAt: string }> {
    return request<{ token: string; name: string; expiresAt: string }>("/v1/mcp/tokens", { method: "POST", body: JSON.stringify({ name }) }, token);
  },
  revokeAllSessions(token: string): Promise<void> {
    return request<void>("/v1/sessions", { method: "DELETE" }, token);
  },
  agentComplete(
    input: {
      model: string; prompt: string; system: string; history: Array<{ role: string; content: string }>; webSearch: boolean; reasoningEffort?: string;
      purpose?: "agent" | "recommendations" | "mail" | "calendar" | "import" | "planning";
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
  // Gamified mode (specs/GAMIFICATION.md). XP is earned through sync only.
  getGame(token: string): Promise<GameState> {
    return request<GameState>("/v1/game", {}, token);
  },
  updateGameSettings(settings: GameSettingsPatch, token: string): Promise<GameProfile> {
    return request<GameProfile>("/v1/game/settings", { method: "PATCH", body: JSON.stringify(settings) }, token);
  },
  checkGameHandle(handle: string, token: string): Promise<{ available: boolean; reason: "" | "format" | "reserved" | "blocked" | "taken" }> {
    return request(`/v1/game/handle?handle=${encodeURIComponent(handle)}`, {}, token);
  },
  setGameHandle(handle: string, token: string): Promise<{ handle: string }> {
    return request("/v1/game/handle", { method: "PUT", body: JSON.stringify({ handle }) }, token);
  },
  equipGameItem(slot: keyof GameEquipped, itemId: string, token: string): Promise<{ equipped: GameEquipped }> {
    return request("/v1/game/equip", { method: "PUT", body: JSON.stringify({ slot, itemId }) }, token);
  },
  pinAchievements(achievements: string[], token: string): Promise<{ pinnedAchievements: string[] }> {
    return request("/v1/game/pinned", { method: "PUT", body: JSON.stringify({ achievements }) }, token);
  },
  setPetName(name: string, token: string): Promise<{ name: string }> {
    return request("/v1/game/pet", { method: "PUT", body: JSON.stringify({ name }) }, token);
  },
  openChest(chestId: string, token: string): Promise<{ drops: ChestDrop[] }> {
    return request(`/v1/game/chests/${encodeURIComponent(chestId)}/open`, { method: "POST" }, token);
  },
  craftItem(itemId: string, token: string): Promise<{ stardust: number }> {
    return request("/v1/game/craft", { method: "POST", body: JSON.stringify({ itemId }) }, token);
  },
  ackGameEvents(upTo: number, token: string): Promise<void> {
    return request<void>("/v1/game/events/ack", { method: "POST", body: JSON.stringify({ upTo }) }, token);
  },
  getLeaderboard(board: "level" | "streak", token: string, limit = 50): Promise<GameBoard> {
    return request<GameBoard>(`/v1/game/leaderboards/${board}?limit=${limit}`, {}, token);
  },
  getLeague(token: string): Promise<GameLeague> {
    return request<GameLeague>("/v1/game/league", {}, token);
  },
  getProjectLeaderboard(projectId: string, token: string): Promise<ProjectLeaderboard> {
    return request<ProjectLeaderboard>(`/v1/game/projects/${encodeURIComponent(projectId)}/leaderboard`, {}, token);
  },
  setProjectLeaderboard(projectId: string, mode: ProjectLeaderboardMode, teamGoalXp: number, token: string): Promise<void> {
    return request<void>(`/v1/game/projects/${encodeURIComponent(projectId)}/leaderboard`, { method: "PUT", body: JSON.stringify({ mode, teamGoalXp }) }, token);
  },
  setProjectLeaderboardChoice(projectId: string, joined: boolean, token: string): Promise<void> {
    return request<void>(`/v1/game/projects/${encodeURIComponent(projectId)}/leaderboard/choice`, { method: "PUT", body: JSON.stringify({ joined }) }, token);
  },
  giveKudos(taskId: string, token: string): Promise<void> {
    return request<void>("/v1/game/kudos", { method: "POST", body: JSON.stringify({ taskId }) }, token);
  },
  /** Public: the invite landing shows it before sign-in. With a session it also says whether the caller already belongs to the project. */
  getInvitePreview(inviteToken: string, token?: string): Promise<InvitePreview> {
    return request<InvitePreview>(`/v1/collaboration/invites/preview?token=${encodeURIComponent(inviteToken)}`, {}, token);
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
  /** The API has a Prior AI provider key, whatever the user's plan. */
  configured?: boolean;
  /** Whether this account may use Prior AI (paid plan or staff). */
  entitlement?: { allowed: boolean; plan?: string; agentTokensPerMonth?: number };
  transcription: boolean;
  dailyLimit: number;
  usedToday: number;
  models?: Record<"agent" | "recommendations" | "mail" | "calendar" | "import", string>;
};
