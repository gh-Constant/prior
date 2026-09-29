import { useCallback, useEffect, useState } from "react";
import type { BillingState } from "../lib/api";
import { clearCheckoutReturn, loadBilling, readCheckoutReturn, syncBilling } from "../lib/billing";
import { logger } from "../lib/logger";

export type CheckoutReturn = "success" | "cancel" | null;

/**
 * The signed-in account's plan. On return from Stripe Checkout it asks the
 * API to pull the subscription from Stripe, so the new plan shows even
 * before the webhook lands.
 */
export function useBilling(signedIn: boolean) {
  const [billing, setBilling] = useState<BillingState | null>(null);
  const [checkoutReturn, setCheckoutReturn] = useState<CheckoutReturn>(() => (typeof window === "undefined" ? null : readCheckoutReturn(window.location.search).status));

  const refresh = useCallback(async () => {
    try {
      setBilling(await loadBilling());
    } catch (error) {
      logger.warn("billing", "Unable to load the plan", { error: error instanceof Error ? error.message : String(error) });
    }
  }, []);

  const sync = useCallback(async (sessionId?: string) => {
    const next = await syncBilling(sessionId);
    setBilling(next);
    return next;
  }, []);

  useEffect(() => {
    if (!signedIn) {
      setBilling(null);
      return;
    }
    const pending = typeof window === "undefined" ? { status: null } : readCheckoutReturn(window.location.search);
    if (pending.status) clearCheckoutReturn();
    if (pending.status === "success") {
      void sync(pending.sessionId).catch(() => refresh());
    } else {
      void refresh();
    }
  }, [signedIn, refresh, sync]);

  return { billing, refresh, sync, checkoutReturn, dismissCheckoutReturn: () => setCheckoutReturn(null) };
}
