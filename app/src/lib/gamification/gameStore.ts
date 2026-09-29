// The gamified mode's client state (specs/GAMIFICATION.md). The server is
// the authority: this store caches its last answer per account, shows XP
// earned since then optimistically, and hands celebration events to the UI
// exactly once. XP itself is only ever earned through sync.
import { useSyncExternalStore } from "react";
import { readScopedStorage, writeScopedStorage } from "../accountScope";
import { api } from "../api";
import { getToken } from "../auth";
import { logger } from "../logger";
import { progressFor, rankFor } from "./rules";
import type { ChestDrop, GameEquipped, GameEvent, GameProfile, GameSettingsPatch, GameState } from "./state";

const CACHE_KEY = "prior.game.state.v1";
const AUTH_CHANGE = "prior-auth-change";

type OptimisticXp = { readonly id: string; readonly xp: number; readonly at: number };

export type GameSnapshot = {
  /** The last server state, with optimistic XP folded into the profile. */
  readonly state: GameState | null;
  readonly profile: GameProfile | null;
  /** True when the account chose the gamified experience. */
  readonly enabled: boolean;
  /** True when the account has onboarding steps it has not seen. */
  readonly needsOnboarding: boolean;
  readonly loading: boolean;
};

let cached: GameState | null = null;
let cacheLoaded = false;
let optimistic: OptimisticXp[] = [];
let loading = false;
let snapshot: GameSnapshot = { state: null, profile: null, enabled: false, needsOnboarding: false, loading: false };
const listeners = new Set<() => void>();
/** Event ids already handed to the UI, so a refresh never replays one. */
const delivered = new Set<number>();

function readCache(): GameState | null {
  try {
    const raw = readScopedStorage(CACHE_KEY);
    return raw ? JSON.parse(raw) as GameState : null;
  } catch {
    return null;
  }
}

function ensureCache(): void {
  if (cacheLoaded) return;
  cacheLoaded = true;
  cached = readCache();
  // Called from getSnapshot during render: compute without notifying.
  rebuild(false);
}

function withOptimisticXp(profile: GameProfile): GameProfile {
  const extra = optimistic.reduce((sum, entry) => sum + entry.xp, 0);
  if (!extra) return profile;
  const xp = profile.xp + extra;
  const progress = progressFor(xp);
  return { ...profile, xp, progress, rank: rankFor(progress.level).toLowerCase(), todayTaskXp: profile.todayTaskXp + extra };
}

function rebuild(notify = true): void {
  const profile = cached ? withOptimisticXp(cached.profile) : null;
  snapshot = {
    state: cached && profile ? { ...cached, profile } : cached,
    profile,
    enabled: Boolean(profile?.enabled),
    needsOnboarding: Boolean(profile && profile.onboardingVersion < profile.currentOnboarding),
    loading,
  };
  if (notify) for (const listener of listeners) listener();
}

function store(state: GameState): void {
  cached = state;
  cacheLoaded = true;
  try {
    // Events are delivered live; the cache never replays them.
    writeScopedStorage(CACHE_KEY, JSON.stringify({ ...state, events: [] }));
  } catch {
    // A full or blocked storage only costs the offline cache.
  }
  rebuild();
}

function patchProfile(patch: Partial<GameProfile>): void {
  if (!cached) return;
  store({ ...cached, profile: { ...cached.profile, ...patch } });
}

async function requireToken(): Promise<string> {
  const token = await getToken();
  if (!token) throw new Error("Sign in to use the gamified mode.");
  return token;
}

if (typeof window !== "undefined") {
  window.addEventListener(AUTH_CHANGE, () => {
    cacheLoaded = false;
    cached = null;
    optimistic = [];
    delivered.clear();
    ensureCache();
    rebuild();
  });
}

export const gameStore = {
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },

  getSnapshot(): GameSnapshot {
    ensureCache();
    return snapshot;
  },

  /**
   * Fetches the server state. syncStartedAt is when the sync that preceded
   * this refresh began: optimistic XP recorded before it is now included in
   * the server's answer and is dropped.
   */
  async refresh(syncStartedAt?: number): Promise<GameState | null> {
    ensureCache();
    loading = true;
    rebuild();
    try {
      const token = await getToken();
      if (!token) return null;
      const state = await api.getGame(token);
      if (syncStartedAt !== undefined) optimistic = optimistic.filter((entry) => entry.at >= syncStartedAt);
      store(state);
      return state;
    } catch (error) {
      logger.warn("game", "Game state could not be loaded", { error: error instanceof Error ? error.message : String(error) });
      return null;
    } finally {
      loading = false;
      rebuild();
    }
  },

  /** Shows XP right away for a completion the server will confirm on sync. */
  addOptimisticXp(id: string, xp: number): void {
    if (xp <= 0 || optimistic.some((entry) => entry.id === id)) return;
    optimistic = [...optimistic, { id, xp, at: Date.now() }];
    rebuild();
  },

  /** Takes back optimistic XP, e.g. when a task is un-completed before syncing. */
  removeOptimisticXp(id: string): void {
    if (!optimistic.some((entry) => entry.id === id)) return;
    optimistic = optimistic.filter((entry) => entry.id !== id);
    rebuild();
  },

  /** Celebrations not yet handed to the UI. Each event is returned once. */
  takeNewEvents(): GameEvent[] {
    const events = (cached?.events ?? []).filter((event) => !delivered.has(event.id));
    for (const event of events) delivered.add(event.id);
    return events;
  },

  /** Tells the server the events up to id were shown, on this or any device. */
  async ackEvents(upTo: number): Promise<void> {
    if (upTo <= 0) return;
    try {
      await api.ackGameEvents(upTo, await requireToken());
      if (cached) store({ ...cached, events: cached.events.filter((event) => event.id > upTo) });
    } catch (error) {
      logger.warn("game", "Game events could not be acknowledged", { error: error instanceof Error ? error.message : String(error) });
    }
  },

  async updateSettings(settings: GameSettingsPatch): Promise<GameProfile> {
    const profile = await api.updateGameSettings(settings, await requireToken());
    if (cached) patchProfile(profile);
    // Enabling can backfill history and grant items: reload everything.
    if (settings.enabled || !cached) await gameStore.refresh();
    return profile;
  },

  async checkHandle(handle: string) {
    return api.checkGameHandle(handle, await requireToken());
  },

  async setHandle(handle: string): Promise<string> {
    const result = await api.setGameHandle(handle, await requireToken());
    patchProfile({ handle: result.handle });
    return result.handle;
  },

  async equip(slot: keyof GameEquipped, itemId: string): Promise<void> {
    const previous = cached?.profile.equipped;
    patchProfile({ equipped: { ...previous, [slot]: itemId || undefined } });
    try {
      const { equipped } = await api.equipGameItem(slot, itemId, await requireToken());
      patchProfile({ equipped });
    } catch (error) {
      if (previous) patchProfile({ equipped: previous });
      throw error;
    }
  },

  async pinAchievements(ids: string[]): Promise<void> {
    const previous = cached?.profile.pinnedAchievements;
    patchProfile({ pinnedAchievements: ids });
    try {
      const { pinnedAchievements } = await api.pinAchievements(ids, await requireToken());
      patchProfile({ pinnedAchievements });
    } catch (error) {
      if (previous) patchProfile({ pinnedAchievements: previous });
      throw error;
    }
  },

  async setPetName(name: string): Promise<string> {
    const result = await api.setPetName(name, await requireToken());
    if (cached?.profile.pet) patchProfile({ pet: { ...cached.profile.pet, name: result.name } });
    return result.name;
  },

  async openChest(chestId: string): Promise<ChestDrop[]> {
    const { drops } = await api.openChest(chestId, await requireToken());
    await gameStore.refresh();
    return drops;
  },

  async craft(itemId: string): Promise<void> {
    await api.craftItem(itemId, await requireToken());
    await gameStore.refresh();
  },
};

export function useGame(): GameSnapshot {
  return useSyncExternalStore(gameStore.subscribe, gameStore.getSnapshot, gameStore.getSnapshot);
}
