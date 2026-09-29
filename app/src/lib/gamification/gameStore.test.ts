import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { memoryStorage } from "../../test/memoryStorage";
import type { GameState } from "./state";

const getGame = vi.fn();
const ackGameEvents = vi.fn();
const updateGameSettings = vi.fn();
const equipGameItem = vi.fn();

vi.mock("../api", () => ({ api: { getGame: (...args: unknown[]) => getGame(...args), ackGameEvents: (...args: unknown[]) => ackGameEvents(...args), updateGameSettings: (...args: unknown[]) => updateGameSettings(...args), equipGameItem: (...args: unknown[]) => equipGameItem(...args) } }));
vi.mock("../auth", () => ({ getToken: () => Promise.resolve("token") }));
vi.mock("../../components/game/fx/celebrate", () => ({ celebrateCompletion: vi.fn(() => Promise.resolve()) }));

function state(overrides: Partial<GameState["profile"]> = {}, events: GameState["events"] = []): GameState {
  return {
    profile: {
      onboardingVersion: 1, currentOnboarding: 1, enabled: true, handle: null, anonymousKey: "otter", visibility: "hidden", effects: "full", sounds: false,
      timeZone: "UTC", xp: 20, progress: { level: 1, xpInLevel: 20, xpForLevel: 30 }, rank: "spark", todayTaskXp: 20, dailyCapXp: 800,
      streak: { current: 1, best: 1, freezes: 0 }, stardust: 0, leagueTier: "pebble", pet: null, equipped: {}, pinnedAchievements: [], nameEffects: ["plain"],
      ...overrides,
    },
    inventory: [], achievements: [], chests: [], events,
  };
}

async function freshStore() {
  vi.resetModules();
  return import("./gameStore");
}

describe("gameStore", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", memoryStorage());
    vi.clearAllMocks();
  });
  afterEach(() => vi.unstubAllGlobals());

  it("starts empty and Calm, then loads the server state", async () => {
    const { gameStore } = await freshStore();
    expect(gameStore.getSnapshot()).toMatchObject({ state: null, enabled: false, needsOnboarding: false });
    getGame.mockResolvedValueOnce(state({ onboardingVersion: 0 }));
    await gameStore.refresh();
    expect(gameStore.getSnapshot()).toMatchObject({ enabled: true, needsOnboarding: true });
  });

  it("shows optimistic XP until a sync that included it is confirmed", async () => {
    const { gameStore } = await freshStore();
    getGame.mockResolvedValue(state());
    await gameStore.refresh();
    gameStore.addOptimisticXp("task-1", 15);
    gameStore.addOptimisticXp("task-1", 15);
    // 20 + 15 = 35 crosses level 2 (30 XP).
    expect(gameStore.getSnapshot().profile).toMatchObject({ xp: 35, todayTaskXp: 35, progress: { level: 2 } });
    // A refresh for a sync that started before the completion keeps it.
    await gameStore.refresh(Date.now() - 60_000);
    expect(gameStore.getSnapshot().profile?.xp).toBe(35);
    // Once a sync started after it, the server's number is the truth.
    await gameStore.refresh(Date.now() + 1);
    expect(gameStore.getSnapshot().profile?.xp).toBe(20);
    gameStore.addOptimisticXp("task-2", 10);
    gameStore.removeOptimisticXp("task-2");
    expect(gameStore.getSnapshot().profile?.xp).toBe(20);
  });

  it("hands each event to the UI once and never replays it from the cache", async () => {
    const { gameStore } = await freshStore();
    const events = [{ id: 7, kind: "level_up" as const, payload: { level: 2 }, createdAt: "" }];
    getGame.mockResolvedValue(state({}, events));
    await gameStore.refresh();
    expect(gameStore.takeNewEvents().map((event) => event.id)).toEqual([7]);
    await gameStore.refresh();
    expect(gameStore.takeNewEvents()).toEqual([]);
    ackGameEvents.mockResolvedValue(undefined);
    await gameStore.ackEvents(7);
    expect(ackGameEvents).toHaveBeenCalledWith(7, "token");

    const reloaded = await freshStore();
    expect(reloaded.gameStore.getSnapshot().state?.events).toEqual([]);
  });

  it("puts the old loadout back when equipping fails", async () => {
    const { gameStore } = await freshStore();
    getGame.mockResolvedValue(state({ equipped: { border: "border-common-ring" } }));
    await gameStore.refresh();
    equipGameItem.mockRejectedValueOnce(new Error("forbidden"));
    await expect(gameStore.equip("border", "border-prism")).rejects.toThrow("forbidden");
    expect(gameStore.getSnapshot().profile?.equipped.border).toBe("border-common-ring");
  });
});

describe("celebrations", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", memoryStorage());
    vi.clearAllMocks();
  });
  afterEach(() => vi.unstubAllGlobals());

  it("rewards completions only in the gamified experience", async () => {
    vi.resetModules();
    const { gameStore } = await import("./gameStore");
    const { rewardTaskCompletion, rewardHabitCheckIn, revokeCompletion } = await import("./celebrations");
    const task = { id: "t1", important: true, urgent: true, dueDate: null, createdAt: new Date(Date.now() - 3_600_000).toISOString() };

    getGame.mockResolvedValue(state({ enabled: false }));
    await gameStore.refresh();
    rewardTaskCompletion(task);
    expect(gameStore.getSnapshot().profile?.xp).toBe(20);

    getGame.mockResolvedValue(state());
    await gameStore.refresh();
    rewardTaskCompletion(task);
    expect(gameStore.getSnapshot().profile?.xp).toBe(50);
    revokeCompletion("t1");
    expect(gameStore.getSnapshot().profile?.xp).toBe(20);

    const today = new Date();
    const day = (offset: number) => {
      const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() + offset);
      return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    };
    const habit = { id: "h1", important: false, urgent: false, completedDates: [day(-1)] };
    rewardHabitCheckIn(habit, day(-5));
    expect(gameStore.getSnapshot().profile?.xp).toBe(20);
    rewardHabitCheckIn(habit, day(0));
    // Second day in a row: 10 + 1.
    expect(gameStore.getSnapshot().profile?.xp).toBe(31);
  });
});
