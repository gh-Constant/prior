import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../../lib/i18n";
import { memoryStorage } from "../../../test/memoryStorage";
import { petMood } from "../GameSidebarWidget";
import { OnboardingFlow } from "./OnboardingFlow";

const updateSettings = vi.fn();
const setHandle = vi.fn();
vi.mock("../../../lib/gamification/gameStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/gamification/gameStore")>();
  return { ...actual, gameStore: { ...actual.gameStore, updateSettings: (...args: unknown[]) => updateSettings(...args), setHandle: (...args: unknown[]) => setHandle(...args), checkHandle: () => Promise.resolve({ available: true, reason: "" }) } };
});

const user = { id: "u1", email: "ada@example.com", displayName: "Ada Lovelace" };

function renderFlow(returning: boolean, handlers: Partial<Parameters<typeof OnboardingFlow>[0]> = {}) {
  const props = {
    user,
    returning,
    onUserUpdated: vi.fn(),
    onCreateTasks: vi.fn(async (titles: string[]) => titles.map((title, index) => ({ id: `t${index}`, title }) as never)),
    onCompleteTask: vi.fn(async () => undefined),
    onFinish: vi.fn(),
    onLater: vi.fn(),
    ...handlers,
  };
  render(<I18nProvider><OnboardingFlow {...props} /></I18nProvider>);
  return props;
}

describe("OnboardingFlow", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", memoryStorage());
    localStorage.setItem("prior.language", "en");
    vi.clearAllMocks();
    updateSettings.mockResolvedValue({});
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("walks a new account through Calm and its first win", async () => {
    const props = renderFlow(false);
    expect(screen.getByRole("heading", { name: "Welcome to Prior, Ada" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByRole("heading", { name: "Make it yours" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByRole("heading", { name: "How should Prior feel?" })).toBeInTheDocument();
    const next = screen.getByRole("button", { name: "Continue" });
    expect(next).toBeDisabled();
    fireEvent.click(screen.getByRole("radio", { name: /Calm/ }));
    fireEvent.click(next);
    await waitFor(() => expect(updateSettings).toHaveBeenCalledWith(expect.objectContaining({ onboardingVersion: 1, enabled: false })));
    expect(await screen.findByRole("heading", { name: "Your first win" })).toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: "Something on your mind 1" }), { target: { value: "Call the bank" } });
    fireEvent.click(screen.getByRole("button", { name: "Add to Prior" }));
    await waitFor(() => expect(props.onCreateTasks).toHaveBeenCalledWith(["Call the bank"]));
    fireEvent.click(await screen.findByRole("button", { name: "Call the bank" }));
    await waitFor(() => expect(props.onCompleteTask).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(await screen.findByRole("button", { name: "Start using Prior" }));
    expect(props.onFinish).toHaveBeenCalled();
  });

  it("offers returning accounts the game and sets up the player", async () => {
    renderFlow(true);
    expect(screen.getByRole("heading", { name: "Want to make it a game?" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: /Gamified/ }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByRole("heading", { name: "Your player profile" })).toBeInTheDocument();
    // Nothing is saved before the player setup is confirmed.
    expect(updateSettings).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("radio", { name: "Anonymous" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(updateSettings).toHaveBeenCalledWith(expect.objectContaining({ onboardingVersion: 1, enabled: true, visibility: "anonymous", effects: "full", sounds: false })));
    expect(setHandle).not.toHaveBeenCalled();
    expect(await screen.findByRole("heading", { name: "This egg is yours" })).toBeInTheDocument();
  });

  it("can be put off", () => {
    const props = renderFlow(true);
    fireEvent.click(screen.getByRole("button", { name: "Set up later" }));
    expect(props.onLater).toHaveBeenCalled();
  });
});

describe("petMood", () => {
  const noon = new Date(2026, 8, 30, 12, 0);
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const profile = (lastDay?: string) => ({ streak: { current: 1, best: 1, freezes: 0, lastDay }, timeZone: zone });

  it("never suffers: it naps, dozes off, perks up and cheers", () => {
    expect(petMood(profile("2026-09-30"), noon, null)).toBe("happy");
    expect(petMood(profile("2026-09-29"), noon, null)).toBe("content");
    expect(petMood(profile("2026-09-27"), noon, null)).toBe("sleepy");
    expect(petMood(profile("2026-09-30"), new Date(2026, 8, 30, 23, 30), null)).toBe("asleep");
    expect(petMood(profile("2026-09-27"), noon, { reaction: "hop", at: noon.getTime() - 60_000 })).toBe("happy");
    expect(petMood(profile("2026-09-30"), noon, { reaction: "dance", at: noon.getTime() - 60_000 })).toBe("excited");
  });
});
