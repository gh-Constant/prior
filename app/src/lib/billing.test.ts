import { describe, expect, it } from "vitest";
import type { BillingPlan } from "./api";
import { displayMonthlyCents, formatMoney, formatTokens, planRank, readCheckoutReturn, yearlySavingPercent } from "./billing";

const plans: BillingPlan[] = [
  { id: "free", name: "Free", monthlyCents: 0, yearlyCents: 0, maxMembersPerProject: 2, maxSharedProjects: 3, hostedAI: false, agentTokensPerMonth: 0 },
  { id: "pro", name: "Pro", monthlyCents: 2000, yearlyCents: 19200, maxMembersPerProject: 10, maxSharedProjects: 0, hostedAI: true, agentTokensPerMonth: 2_000_000 },
  { id: "team", name: "Team", monthlyCents: 5000, yearlyCents: 48000, maxMembersPerProject: 50, maxSharedProjects: 0, hostedAI: true, agentTokensPerMonth: 8_000_000 },
];

describe("billing helpers", () => {
  it("formats prices without useless cents", () => {
    expect(formatMoney(2000, "en", "eur")).toBe("€20");
    expect(formatMoney(1600, "fr", "eur").replace(/\s/g, " ")).toBe("16 €");
    expect(formatMoney(1999, "en", "eur")).toBe("€19.99");
  });

  it("spreads the yearly price over twelve months", () => {
    expect(displayMonthlyCents(plans[1], "month")).toBe(2000);
    expect(displayMonthlyCents(plans[1], "year")).toBe(1600);
    expect(yearlySavingPercent(plans)).toBe(20);
    expect(yearlySavingPercent([plans[0]])).toBe(0);
  });

  it("formats token budgets compactly", () => {
    expect(formatTokens(2_000_000, "en")).toBe("2M");
    expect(formatTokens(8_000_000, "fr").replace(/\s/g, " ")).toBe("8 M");
  });

  it("orders plans from free to enterprise", () => {
    expect(planRank("free")).toBeLessThan(planRank("pro"));
    expect(planRank("team")).toBeLessThan(planRank("enterprise"));
  });

  it("reads only well-formed checkout returns", () => {
    expect(readCheckoutReturn("?billing=success&session_id=cs_test_123")).toEqual({ status: "success", sessionId: "cs_test_123" });
    expect(readCheckoutReturn("?billing=success&session_id=evil")).toEqual({ status: "success", sessionId: undefined });
    expect(readCheckoutReturn("?billing=cancel")).toEqual({ status: "cancel", sessionId: undefined });
    expect(readCheckoutReturn("?billing=other")).toEqual({ status: null });
    expect(readCheckoutReturn("")).toEqual({ status: null });
  });
});
