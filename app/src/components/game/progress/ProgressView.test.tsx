import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EffectsProvider } from "../../../lib/gamification/effects";
import type { GameSnapshot } from "../../../lib/gamification/gameStore";
import { memoryStorage } from "../../../test/memoryStorage";
import { boardFixture, leagueFixture, projectBoardFixture, veteranState } from "./fixtures";

const mocks = vi.hoisted(() => ({
  snapshot: null as unknown as GameSnapshot,
  store: { refresh: vi.fn(), equip: vi.fn(), pinAchievements: vi.fn(), setPetName: vi.fn(), craft: vi.fn(), openChest: vi.fn() },
  api: { getLeague: vi.fn(), getLeaderboard: vi.fn(), getProjectLeaderboard: vi.fn(), setProjectLeaderboard: vi.fn(), setProjectLeaderboardChoice: vi.fn() },
}));

vi.mock("../../../lib/gamification/gameStore", () => ({ useGame: () => mocks.snapshot, gameStore: mocks.store }));
vi.mock("../../../lib/api", () => ({ api: mocks.api }));
vi.mock("../../../lib/auth", () => ({ getToken: () => Promise.resolve("token") }));

const { ProgressView } = await import("./ProgressView");
const { ProjectLeaderboardPanel } = await import("./ProjectLeaderboardPanel");

function snapshot(enabled = true): GameSnapshot {
  const state = veteranState();
  const profile = { ...state.profile, enabled };
  return { state: { ...state, profile }, profile, enabled, needsOnboarding: false, loading: false };
}

beforeEach(() => {
  vi.stubGlobal("localStorage", memoryStorage());
  localStorage.setItem("prior.language", "en");
  mocks.snapshot = snapshot();
  mocks.store.refresh.mockResolvedValue(null);
  mocks.store.equip.mockResolvedValue(undefined);
  mocks.api.getLeague.mockResolvedValue(leagueFixture());
  mocks.api.getLeaderboard.mockImplementation((board: "level" | "streak") => Promise.resolve(boardFixture(board)));
  mocks.api.getProjectLeaderboard.mockResolvedValue(projectBoardFixture());
  mocks.api.setProjectLeaderboardChoice.mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("ProgressView", () => {
  it("refreshes on open, fetches leagues only when their tab opens, and equips through the store", async () => {
    render(
      <EffectsProvider intensity="off">
        <ProgressView onOpenGameSettings={vi.fn()} />
      </EffectsProvider>,
    );
    expect(mocks.store.refresh).toHaveBeenCalledTimes(1);
    expect(mocks.api.getLeague).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("tab", { name: /Leagues/ }));
    expect(await screen.findByRole("region", { name: "Sapphire league" })).toBeInTheDocument();
    expect(mocks.api.getLeague).toHaveBeenCalledWith("token");
    expect(mocks.api.getLeaderboard).toHaveBeenCalledWith("level", "token", 50);
    expect(mocks.api.getLeaderboard).toHaveBeenCalledWith("streak", "token", 50);

    fireEvent.click(screen.getByRole("tab", { name: /Inventory/ }));
    const silver = screen.getByText("Silver", { selector: ".gi-inv-name" }).closest("li")!;
    fireEvent.click(within(silver).getByRole("button", { name: "Equip" }));
    expect(mocks.store.equip).toHaveBeenCalledWith("nameEffect", "silver");
  });

  it("opens a chest in a dialog", async () => {
    mocks.store.openChest.mockReturnValue(new Promise(() => undefined));
    render(
      <EffectsProvider intensity="off">
        <ProgressView onOpenGameSettings={vi.fn()} />
      </EffectsProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Open: Rare chest" }));
    expect(screen.getByRole("dialog", { name: "Rare chest" })).toBeInTheDocument();
    await waitFor(() => expect(mocks.store.openChest).toHaveBeenCalledWith("chest-rare"));
  });
});

describe("ProjectLeaderboardPanel", () => {
  it("records a member's opt-in and reloads the board", async () => {
    mocks.api.getProjectLeaderboard.mockResolvedValueOnce(projectBoardFixture({ isOwner: false, myChoice: null }));
    render(<ProjectLeaderboardPanel projectId="p1" />);
    fireEvent.click(await screen.findByRole("button", { name: "Join" }));
    await waitFor(() => expect(mocks.api.setProjectLeaderboardChoice).toHaveBeenCalledWith("p1", true, "token"));
    await waitFor(() => expect(mocks.api.getProjectLeaderboard).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole("button", { name: "Leave" })).toBeInTheDocument();
  });

  it("stays hidden from calm members but not from a calm owner", async () => {
    mocks.snapshot = snapshot(false);
    mocks.api.getProjectLeaderboard.mockResolvedValueOnce(projectBoardFixture({ isOwner: false }));
    const { container, unmount } = render(<ProjectLeaderboardPanel projectId="p1" />);
    await waitFor(() => expect(mocks.api.getProjectLeaderboard).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(container).toBeEmptyDOMElement();
    unmount();

    mocks.api.getProjectLeaderboard.mockResolvedValueOnce(projectBoardFixture({ isOwner: true }));
    render(<ProjectLeaderboardPanel projectId="p2" />);
    expect(await screen.findByRole("radiogroup", { name: "Leaderboard mode" })).toBeInTheDocument();
    expect(screen.getByText("You're in Calm mode, so you won't appear on it yourself.")).toBeInTheDocument();
  });
});
