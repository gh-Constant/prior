import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { api } from "../../lib/api";
import { AdminView } from "./AdminView";

vi.mock("../../lib/api", () => ({
  api: { adminOverview: vi.fn(), adminUsers: vi.fn(), adminSetPlan: vi.fn() },
}));
vi.mock("../../lib/auth", () => ({ getToken: vi.fn(async () => "token") }));

const days = Array.from({ length: 30 }, (_, index) => `2026-09-${String(index + 1).padStart(2, "0")}`);

function overview() {
  return {
    overview: {
      generatedAt: new Date().toISOString(),
      totals: { users: 40, newUsers7d: 6, newUsers30d: 20, activeUsers7d: 22, payingUsers: 5, grantedUsers: 1, cancelingUsers: 1, mrrCents: 13000, revenue30dCents: 11000, revenueAllCents: 42000, aiCost30dMicros: 3_450_000, aiCostAllMicros: 9_000_000, aiRequests30d: 1200, aiTokens30d: 3_000_000, aiUsers30d: 9, sharedProjects: 4, tasksCreated30d: 300 },
      planCounts: { free: 35, pro: 3, team: 1, enterprise: 1 },
      signups: days.map((day, index) => ({ day, count: index % 3 })),
      activeDaily: days.map((day, index) => ({ day, count: 10 + index })),
      revenue: [{ month: "2026-08", cents: 20000 }, { month: "2026-09", cents: 11000 }],
      aiCost: days.map((day) => ({ day, micros: 100_000, tokens: 1000 })),
      aiByPurpose: [{ purpose: "agent", requests: 800, tokens: 2_500_000, micros: 2_000_000 }],
      topSpenders: [{ userId: "u1", email: "ada@example.com", displayName: "Ada", plan: "pro", micros: 1_200_000, tokens: 900_000, requests: 200 }],
      recentPayments: [{ invoiceId: "in_1", email: "ada@example.com", amountCents: 2000, currency: "eur", paidAt: new Date().toISOString() }],
    },
    plans: [],
    stripeMode: "live",
    hostedAIReady: true,
  };
}

beforeAll(() => {
  // jsdom has no WebGL; the shader falls back to its CSS gradient.
  HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext;
});

describe("AdminView", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders the key numbers, charts and the user list, and grants a plan", async () => {
    vi.mocked(api.adminOverview).mockResolvedValue(overview() as never);
    vi.mocked(api.adminUsers).mockResolvedValue({
      total: 1,
      users: [{ id: "u1", email: "ada@example.com", displayName: "Ada", createdAt: "2026-09-01T00:00:00Z", lastLoginAt: new Date().toISOString(), plan: "free", source: "free", stripeStatus: "none", amountCents: 0, cancelAtPeriodEnd: false, revenueCents: 0, aiCost30dMicros: 0, agentTokensMonth: 0, aiRequests30d: 0, tasks: 3, sharedProjects: 0 }],
    });
    vi.mocked(api.adminSetPlan).mockResolvedValue({ plan: "team" });

    render(<AdminView />);
    expect(await screen.findByText("Stripe live")).toBeInTheDocument();
    expect(screen.getByText("€130")).toBeInTheDocument();
    expect(screen.getByText("$3.45")).toBeInTheDocument();
    expect(screen.getByRole("figure", { name: "Sign-ups" })).toBeInTheDocument();

    const select = await screen.findByRole("combobox", { name: "Plan for Ada" });
    fireEvent.change(select, { target: { value: "team" } });
    await waitFor(() => expect(api.adminSetPlan).toHaveBeenCalledWith("u1", "team", "token"));
  });

  it("explains when the account is not an admin", async () => {
    vi.mocked(api.adminOverview).mockRejectedValue(new Error("admin access required"));
    vi.mocked(api.adminUsers).mockResolvedValue({ users: [], total: 0 });
    render(<AdminView />);
    expect(await screen.findByText("This page is only for Prior administrators.")).toBeInTheDocument();
  });
});
