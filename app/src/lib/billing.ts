import { api, type BillingInterval, type BillingPlan, type BillingState, type PlanId } from "./api";
import { getToken } from "./auth";
import { openExternalUrl } from "./browser";
import { isTauri } from "./platform";

export const PLAN_ORDER: readonly PlanId[] = ["free", "pro", "team", "enterprise"];

export function planRank(plan: PlanId): number {
  return PLAN_ORDER.indexOf(plan);
}

/** "20 €" / "€20" in the reader's language; cents are dropped when round. */
export function formatMoney(cents: number, lang: string, currency = "eur"): string {
  const amount = cents / 100;
  return new Intl.NumberFormat(lang, {
    style: "currency",
    currency: currency.toUpperCase(),
    minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

/** Monthly price shown on a card: the yearly price is spread over 12 months. */
export function displayMonthlyCents(plan: BillingPlan, interval: BillingInterval): number {
  return interval === "year" ? Math.round(plan.yearlyCents / 12) : plan.monthlyCents;
}

/** Percentage saved by paying yearly, for the interval toggle. */
export function yearlySavingPercent(plans: readonly BillingPlan[]): number {
  const paid = plans.filter((plan) => plan.monthlyCents > 0);
  if (paid.length === 0) return 0;
  const saving = Math.min(...paid.map((plan) => 1 - plan.yearlyCents / (plan.monthlyCents * 12)));
  return Math.round(saving * 100);
}

/** 2000000 → "2M", 1500 → "1.5k". */
export function formatTokens(tokens: number, lang: string): string {
  return new Intl.NumberFormat(lang, { notation: "compact", maximumFractionDigits: 1 }).format(tokens);
}

/** Reads `?billing=success&session_id=…` left by Stripe Checkout. */
export function readCheckoutReturn(search: string): { status: "success" | "cancel" | null; sessionId?: string } {
  const params = new URLSearchParams(search);
  const status = params.get("billing");
  if (status !== "success" && status !== "cancel") return { status: null };
  const sessionId = params.get("session_id") ?? undefined;
  return { status, sessionId: sessionId && sessionId.startsWith("cs_") ? sessionId : undefined };
}

/** Removes the Checkout return parameters from the address bar. */
export function clearCheckoutReturn(): void {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  url.searchParams.delete("billing");
  url.searchParams.delete("session_id");
  window.history.replaceState(window.history.state, "", url.toString());
}

/** Where Stripe sends people back: this page on the web, the web app from native builds. */
function returnUrl(): string | undefined {
  if (isTauri() || typeof window === "undefined") return undefined;
  const url = new URL(window.location.href);
  url.search = "";
  url.hash = "";
  return url.toString();
}

async function requireToken(): Promise<string> {
  const token = await getToken();
  if (!token) throw new Error("Sign in to manage your plan.");
  return token;
}

function go(url: string): Promise<void> {
  if (isTauri()) return openExternalUrl(url);
  window.location.assign(url);
  return Promise.resolve();
}

export async function loadBilling(): Promise<BillingState | null> {
  const token = await getToken();
  if (!token) return null;
  return api.getBilling(token);
}

export async function startCheckout(plan: PlanId, interval: BillingInterval, locale: string): Promise<void> {
  const token = await requireToken();
  const { url } = await api.startCheckout({ plan, interval, returnUrl: returnUrl(), locale }, token);
  await go(url);
}

export async function openBillingPortal(): Promise<void> {
  const token = await requireToken();
  const { url } = await api.openBillingPortal(returnUrl(), token);
  await go(url);
}

export async function syncBilling(sessionId?: string): Promise<BillingState> {
  return api.syncBilling(sessionId, await requireToken());
}
