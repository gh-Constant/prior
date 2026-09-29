import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EffectsProvider } from "../../../lib/gamification/effects";
import type { GameState } from "../../../lib/gamification/state";
import { memoryStorage } from "../../../test/memoryStorage";
import { ChestDialog } from "./ChestDialog";
import { CHEST_DROPS, FIXTURE_NOW, boardFixture, leagueFixture, newcomerState, projectBoardFixture, veteranState } from "./fixtures";
import { IDLE_LEAGUES, ProgressPage, type LeagueData, type ProgressPageProps } from "./ProgressPage";
import { ProjectLeaderboardCard } from "./ProjectLeaderboardPanel";

beforeEach(() => {
  vi.stubGlobal("localStorage", memoryStorage());
  localStorage.setItem("prior.language", "en");
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const still = (node: ReactNode) => <EffectsProvider intensity="off">{node}</EffectsProvider>;

const READY_LEAGUES: LeagueData = { status: "ready", league: leagueFixture(), level: boardFixture("level"), streak: boardFixture("streak") };

function renderPage(overrides: Partial<ProgressPageProps> = {}, state: GameState | null = veteranState()) {
  const props: ProgressPageProps = {
    state,
    enabled: state?.profile.enabled ?? false,
    leagues: READY_LEAGUES,
    now: FIXTURE_NOW,
    onOpenGameSettings: vi.fn(),
    onOpenChest: vi.fn(),
    onEquip: vi.fn(),
    onPinAchievements: vi.fn(),
    onRenamePet: vi.fn(),
    onCraft: vi.fn(() => Promise.resolve()),
    ...overrides,
  };
  return { props, ...render(still(<ProgressPage {...props} />)) };
}

const tab = (name: RegExp) => screen.getByRole("tab", { name });

describe("ProgressPage", () => {
  it("opens on the overview with identity, level, streak, pet and chests", () => {
    const { props } = renderPage();
    expect(tab(/Overview/)).toHaveAttribute("aria-selected", "true");
    const panel = screen.getByRole("tabpanel");
    expect(within(panel).getAllByText("constant").length).toBeGreaterThan(0);
    expect(within(panel).getAllByText("The Planner").length).toBeGreaterThan(0);
    expect(within(panel).getByRole("progressbar", { name: "Level 27" })).toBeInTheDocument();
    expect(within(panel).getByText("Pixel")).toBeInTheDocument();
    expect(within(panel).getByText("Best: 41 days")).toBeInTheDocument();
    fireEvent.click(within(panel).getByRole("button", { name: "Open: Epic chest" }));
    expect(props.onOpenChest).toHaveBeenCalledWith(expect.objectContaining({ id: "chest-epic" }));
  });

  it("switches tabs by click and with the arrow keys", () => {
    const onTabChange = vi.fn();
    renderPage({ onTabChange });
    fireEvent.click(tab(/Achievements/));
    expect(tab(/Achievements/)).toHaveAttribute("aria-selected", "true");
    expect(onTabChange).toHaveBeenLastCalledWith("achievements");
    expect(screen.getByText("13 of 32 unlocked")).toBeInTheDocument();
    fireEvent.keyDown(tab(/Achievements/), { key: "ArrowRight" });
    expect(tab(/Inventory/)).toHaveAttribute("aria-selected", "true");
    expect(tab(/Inventory/)).toHaveFocus();
    fireEvent.keyDown(tab(/Inventory/), { key: "End" });
    expect(tab(/Pet/)).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(tab(/Pet/), { key: "ArrowRight" });
    expect(tab(/Overview/)).toHaveAttribute("aria-selected", "true");
  });

  it("opens the pet tab from the overview's pet card", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /Visit the den/ }));
    expect(tab(/Pet/)).toHaveAttribute("aria-selected", "true");
    expect(screen.getByLabelText("Name")).toHaveValue("Pixel");
  });

  it("shows progress on locked achievements and keeps secrets anonymous", () => {
    renderPage({ defaultTab: "achievements" });
    const veteran = screen.getByRole("heading", { name: "Veteran" }).closest("li")!;
    expect(veteran).toHaveClass("is-locked");
    expect(within(veteran).getByText("312/500")).toBeInTheDocument();
    expect(within(veteran).queryByRole("button")).toBeNull();
    // Locked secrets say nothing about themselves; unlocked ones are revealed.
    expect(screen.queryByText("Clean slate")).toBeNull();
    expect(screen.queryByText("Night owl")).toBeNull();
    expect(screen.getAllByRole("heading", { name: "Secret achievement" }).length).toBe(5);
    expect(screen.getByRole("heading", { name: "Early bird" })).toBeInTheDocument();
  });

  it("pins achievements, replacing the oldest when three are pinned", () => {
    const { props } = renderPage({ defaultTab: "achievements" });
    fireEvent.click(screen.getByRole("button", { name: "Pin First step to your profile" }));
    expect(props.onPinAchievements).toHaveBeenCalledWith(["unbreakable", "centurion", "first-step"]);
    fireEvent.click(screen.getByRole("button", { name: "Unpin Centurion" }));
    expect(props.onPinAchievements).toHaveBeenLastCalledWith(["the-planner", "unbreakable"]);
  });

  it("equips from the inventory through the right slot", () => {
    const { props } = renderPage({ defaultTab: "inventory" });
    const silver = screen.getByText("Silver", { selector: ".gi-inv-name" }).closest("li")!;
    fireEvent.click(within(silver).getByRole("button", { name: "Equip" }));
    expect(props.onEquip).toHaveBeenCalledWith("nameEffect", "silver");
    const gold = screen.getByText("Gold", { selector: ".gi-inv-name" }).closest("li")!;
    fireEvent.click(within(gold).getByRole("button", { name: "Equipped" }));
    expect(props.onEquip).toHaveBeenLastCalledWith("nameEffect", "");
    fireEvent.click(screen.getByRole("tab", { name: /Borders/ }));
    const flame = screen.getByText("Flame ring", { selector: ".gi-inv-name" }).closest("li")!;
    fireEvent.click(within(flame).getByRole("button", { name: "Equip" }));
    expect(props.onEquip).toHaveBeenLastCalledWith("border", "border-flame");
  });

  it("crafts an unowned chest item with stardust", async () => {
    const { props } = renderPage({ defaultTab: "inventory" });
    fireEvent.click(screen.getByRole("button", { name: "Craft" }));
    const dialog = screen.getByRole("dialog", { name: "Craft an item" });
    const beanie = within(dialog).getByText("Beanie").closest("li")!;
    await act(async () => {
      fireEvent.click(within(beanie).getByRole("button"));
    });
    expect(props.onCraft).toHaveBeenCalledWith("hat-beanie");
    expect(within(dialog).getByRole("status")).toHaveTextContent("Beanie crafted");
    const crown = within(dialog).getByText("Crown").closest("li")!;
    expect(within(crown).getByRole("button")).toBeDisabled();
  });

  it("changes the pet's outfit and saves its name once typing pauses", () => {
    vi.useFakeTimers();
    const { props } = renderPage({ defaultTab: "pet" });
    fireEvent.click(screen.getByRole("button", { name: /Party hat/ }));
    expect(props.onEquip).toHaveBeenCalledWith("petHat", "hat-party");
    fireEvent.click(screen.getByRole("button", { name: /^Rug$/ }));
    expect(props.onEquip).toHaveBeenLastCalledWith("petRoom", "room-rug");
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "  Pixel   the Great " } });
    expect(props.onRenamePet).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(900);
    });
    expect(props.onRenamePet).toHaveBeenCalledWith("Pixel the Great");
  });

  it("shows the egg before hatching", () => {
    renderPage({ defaultTab: "pet" }, newcomerState());
    expect(screen.getByRole("heading", { name: "Your egg is waiting" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Name")).toBeNull();
  });

  it("explains hidden leagues and links to the settings", () => {
    const state = veteranState();
    const { props } = renderPage({ defaultTab: "leagues" }, { ...state, profile: { ...state.profile, visibility: "hidden" } });
    expect(screen.getByRole("heading", { name: "You're hidden from leaderboards" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Change visibility" }));
    expect(props.onOpenGameSettings).toHaveBeenCalled();
  });

  it("renders the league with zones, a countdown and last week's result", () => {
    renderPage({ defaultTab: "leagues" });
    const league = screen.getByRole("region", { name: "Sapphire league" });
    expect(within(league).getByText("Ends in 4d 10h")).toBeInTheDocument();
    expect(within(league).getByText("Promotion zone")).toBeInTheDocument();
    expect(within(league).getByText("Anonymous Heron")).toBeInTheDocument();
    expect(screen.getByText("Promoted to the Sapphire league!")).toBeInTheDocument();
    const allTime = screen.getByRole("region", { name: "All-time" });
    expect(within(allTime).getByText("412,000 XP")).toBeInTheDocument();
    fireEvent.click(within(allTime).getByRole("button", { name: "Streak" }));
    expect(within(allTime).getByText("290 days")).toBeInTheDocument();
  });

  it("waits for a first XP before placing the player, and survives failures", () => {
    const { rerender, props } = renderPage({ defaultTab: "leagues", leagues: { ...READY_LEAGUES, league: leagueFixture({ joined: false, members: [], lastResult: null }) } });
    expect(screen.getByRole("heading", { name: "Your Sapphire league is waiting" })).toBeInTheDocument();
    const onRetryLeagues = vi.fn();
    rerender(still(<ProgressPage {...props} defaultTab="leagues" leagues={{ status: "error", league: null, level: null, streak: null, offline: true }} onRetryLeagues={onRetryLeagues} />));
    expect(screen.getByText("You're offline. Leagues need a connection.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetryLeagues).toHaveBeenCalled();
  });

  it("invites calm players to turn the game on", () => {
    const state = veteranState();
    const { props } = renderPage({}, { ...state, profile: { ...state.profile, enabled: false } });
    expect(screen.queryByRole("tablist")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Turn on the gamified experience" }));
    expect(props.onOpenGameSettings).toHaveBeenCalled();
  });

  it("shows a skeleton while loading and a retry when nothing could load", () => {
    const onRetry = vi.fn();
    const { rerender, props } = renderPage({ loading: true, leagues: IDLE_LEAGUES }, null);
    expect(screen.getByRole("status")).toHaveTextContent("Loading your progress");
    rerender(still(<ProgressPage {...props} loading={false} onRetry={onRetry} />));
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalled();
  });

  it("tells the player when a change could not be saved", async () => {
    renderPage({ defaultTab: "inventory", onEquip: () => Promise.reject(new Error("offline")) });
    const silver = screen.getByText("Silver", { selector: ".gi-inv-name" }).closest("li")!;
    fireEvent.click(within(silver).getByRole("button", { name: "Equip" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("That change couldn't be saved");
  });
});

describe("ChestDialog", () => {
  const chest = { id: "chest-epic", tier: "epic" as const, source: "achievement", sourceRef: "unbreakable", grantedAt: "2026-07-02T19:00:00Z" };

  it("opens the chest once and puts focus on it, ready to open", async () => {
    const openChest = vi.fn(() => Promise.resolve([...CHEST_DROPS.epic]));
    render(still(<ChestDialog chest={chest} onClose={vi.fn()} openChest={openChest} stardust={120} />));
    expect(screen.getByRole("dialog", { name: "Epic chest" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Getting your chest ready");
    const button = await screen.findByRole("button", { name: "Open the Epic chest" });
    expect(button).toHaveFocus();
    expect(openChest).toHaveBeenCalledTimes(1);
    fireEvent.click(button);
    expect(await screen.findByText("Heart shades")).toBeInTheDocument();
    expect(screen.getByText("Streak freeze")).toBeInTheDocument();
    fireEvent.click(await screen.findByRole("button", { name: "Collect" }));
  });

  it("reports a failure, retries, and closes with Escape", async () => {
    const onClose = vi.fn();
    const openChest = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce([...CHEST_DROPS.common]);
    render(still(<ChestDialog chest={chest} onClose={onClose} openChest={openChest} stardust={0} />));
    expect(await screen.findByRole("alert")).toHaveTextContent("The chest could not be opened");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("button", { name: "Open the Epic chest" })).toBeInTheDocument();
    expect(openChest).toHaveBeenCalledTimes(2);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });
});

describe("ProjectLeaderboardCard", () => {
  it("lets the owner switch modes and set a team goal", () => {
    const onModeChange = vi.fn();
    const { rerender } = render(still(<ProjectLeaderboardCard board={projectBoardFixture({ mode: "off" })} viewerEnabled onModeChange={onModeChange} onChoice={vi.fn()} now={FIXTURE_NOW} />));
    expect(screen.getByText("Suggested")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: /Team/ }));
    expect(onModeChange).toHaveBeenCalledWith("team", 1500);
    rerender(still(<ProjectLeaderboardCard board={projectBoardFixture({ mode: "team" })} viewerEnabled onModeChange={onModeChange} onChoice={vi.fn()} now={FIXTURE_NOW} />));
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "1320");
    fireEvent.change(screen.getByLabelText("Weekly team goal"), { target: { value: "2000" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onModeChange).toHaveBeenLastCalledWith("team", 2000);
  });

  it("asks members once whether to join, and lets them change their mind", () => {
    const onChoice = vi.fn();
    const { rerender } = render(still(<ProjectLeaderboardCard board={projectBoardFixture({ isOwner: false, myChoice: null })} viewerEnabled onModeChange={vi.fn()} onChoice={onChoice} now={FIXTURE_NOW} />));
    expect(screen.queryByRole("radiogroup")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Join" }));
    expect(onChoice).toHaveBeenCalledWith(true);
    rerender(still(<ProjectLeaderboardCard board={projectBoardFixture({ isOwner: false, myChoice: true })} viewerEnabled onModeChange={vi.fn()} onChoice={onChoice} now={FIXTURE_NOW} />));
    expect(screen.queryByText("Join this project's leaderboard?")).toBeNull();
    expect(screen.getAllByText("Tobias Keller").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Leave" }));
    expect(onChoice).toHaveBeenLastCalledWith(false);
  });
});
