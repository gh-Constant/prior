import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { BillingState } from "../../lib/api";
import { PricingView } from "./PricingView";

const startCheckout = vi.fn(async () => undefined);
const openBillingPortal = vi.fn(async () => undefined);
vi.mock("../../lib/billing", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/billing")>()),
  startCheckout: (...args: unknown[]) => startCheckout(...(args as [])),
  openBillingPortal: () => openBillingPortal(),
}));

function state(overrides: Partial<BillingState> = {}): BillingState {
  return {
    plan: "free",
    source: "free",
    subscription: { stripePlan: "free", status: "none", amountCents: 0, currency: "eur", cancelAtPeriodEnd: false },
    entitlements: { plan: "free", hostedAI: false, agentTokensPerMonth: 0, agentTokensUsed: 0, usagePeriodStart: "2026-09-01T00:00:00Z", maxMembersPerProject: 2, maxSharedProjects: 3 },
    plans: [
      { id: "free", name: "Free", monthlyCents: 0, yearlyCents: 0, maxMembersPerProject: 2, maxSharedProjects: 3, hostedAI: false, agentTokensPerMonth: 0 },
      { id: "pro", name: "Pro", monthlyCents: 2000, yearlyCents: 19200, maxMembersPerProject: 10, maxSharedProjects: 0, hostedAI: true, agentTokensPerMonth: 2_000_000 },
      { id: "team", name: "Team", monthlyCents: 5000, yearlyCents: 48000, maxMembersPerProject: 50, maxSharedProjects: 0, hostedAI: true, agentTokensPerMonth: 8_000_000 },
      { id: "enterprise", name: "Enterprise", monthlyCents: 19900, yearlyCents: 191000, maxMembersPerProject: 0, maxSharedProjects: 0, hostedAI: true, agentTokensPerMonth: 30_000_000 },
    ],
    currency: "eur",
    stripeEnabled: true,
    hostedAIReady: true,
    isAdmin: false,
    hasBillingPortal: false,
    ...overrides,
  };
}

beforeAll(() => {
  // jsdom has no WebGL; the shader falls back to its CSS gradient.
  HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext;
});

describe("PricingView", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("shows every plan with honest limits and starts checkout for the chosen interval", async () => {
    render(<PricingView billing={state()} signedIn checkoutReturn={null} onDismissCheckoutReturn={() => undefined} />);
    const pro = screen.getByRole("article", { name: "Pro" });
    expect(within(pro).getByText("€20")).toBeInTheDocument();
    expect(within(pro).getByText("2M assistant tokens a month")).toBeInTheDocument();
    expect(within(screen.getByRole("article", { name: "Free" })).getByText("Share up to 3 projects, 2 people each")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("radio", { name: /Yearly/ }));
    expect(within(pro).getByText("€16")).toBeInTheDocument();
    expect(within(pro).getByText("€192 billed yearly")).toBeInTheDocument();

    fireEvent.click(within(screen.getByRole("article", { name: "Team" })).getByRole("button", { name: "Choose Team" }));
    await waitFor(() => expect(startCheckout).toHaveBeenCalledWith("team", "year", "en"));
  });

  it("marks the current plan, shows usage and sends plan changes to the portal", async () => {
    render(
      <PricingView
        billing={state({
          plan: "pro",
          source: "stripe",
          hasBillingPortal: true,
          subscription: { stripePlan: "pro", status: "active", interval: "month", amountCents: 2000, currency: "eur", cancelAtPeriodEnd: false, currentPeriodEnd: "2026-10-29T00:00:00Z" },
          entitlements: { plan: "pro", hostedAI: true, agentTokensPerMonth: 2_000_000, agentTokensUsed: 500_000, usagePeriodStart: "2026-09-01T00:00:00Z", maxMembersPerProject: 10, maxSharedProjects: 0 },
        })}
        signedIn
        checkoutReturn="success"
        onDismissCheckoutReturn={() => undefined}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("Welcome to Pro");
    expect(screen.getByRole("progressbar", { name: "Assistant tokens this month" })).toHaveAttribute("aria-valuenow", "500000");
    expect(screen.getByText("500K of 2M")).toBeInTheDocument();
    expect(within(screen.getByRole("article", { name: "Pro" })).getByRole("button", { name: "Current plan" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Switch to Team" }));
    await waitFor(() => expect(openBillingPortal).toHaveBeenCalled());
    expect(startCheckout).not.toHaveBeenCalled();
  });

  it("hides checkout buttons when payments are off", () => {
    render(<PricingView billing={state({ stripeEnabled: false })} signedIn checkoutReturn={null} onDismissCheckoutReturn={() => undefined} />);
    expect(screen.getByText("Payments are not available on this server yet.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Choose/ })).not.toBeInTheDocument();
  });
});
