// Live Progress page: reads the game store, fetches leagues and boards when
// the Leagues tab opens, and sends every change through gameStore.
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../../lib/api";
import { getToken } from "../../../lib/auth";
import { gameStore, useGame } from "../../../lib/gamification/gameStore";
import type { GameChest } from "../../../lib/gamification/state";
import { ChestDialog } from "./ChestDialog";
import { IDLE_LEAGUES, ProgressPage, type LeagueData, type ProgressTab } from "./ProgressPage";
import { isOffline } from "./progressModel";

export type ProgressViewProps = {
  readonly onOpenGameSettings: () => void;
  /** Tab to open first, e.g. "pet" from the sidebar companion. */
  readonly initialTab?: ProgressTab;
};

/** Boards are fetched again when the tab reopens after this long. */
const LEAGUES_TTL_MS = 60_000;

export function ProgressView({ onOpenGameSettings, initialTab = "overview" }: ProgressViewProps) {
  const { state, enabled, loading } = useGame();
  const [tab, setTab] = useState<ProgressTab>(initialTab);
  const [leagues, setLeagues] = useState<LeagueData>(IDLE_LEAGUES);
  const [chest, setChest] = useState<GameChest | null>(null);
  const fetchedAt = useRef(0);
  const request = useRef(0);
  const visibility = state?.profile.visibility;

  useEffect(() => setTab(initialTab), [initialTab]);

  // Fresh numbers whenever the page opens; the cache shows meanwhile. Without
  // a cache, the page shows a skeleton until this first answer.
  const [firstLoad, setFirstLoad] = useState(() => state === null);
  useEffect(() => {
    void gameStore.refresh().finally(() => setFirstLoad(false));
  }, []);

  const loadLeagues = useCallback(async () => {
    const id = ++request.current;
    setLeagues((current) => ({ ...current, status: "loading" }));
    const token = await getToken().catch(() => null);
    if (id !== request.current) return;
    if (!token) {
      setLeagues((current) => ({ ...current, status: "error", offline: isOffline() }));
      return;
    }
    const [league, level, streak] = await Promise.allSettled([api.getLeague(token), api.getLeaderboard("level", token, 50), api.getLeaderboard("streak", token, 50)]);
    if (id !== request.current) return;
    const failed = [league, level, streak].some((result) => result.status === "rejected");
    setLeagues((current) => ({
      status: failed ? "error" : "ready",
      league: league.status === "fulfilled" ? league.value : current.league,
      level: level.status === "fulfilled" ? level.value : current.level,
      streak: streak.status === "fulfilled" ? streak.value : current.streak,
      offline: failed && isOffline(),
    }));
    if (!failed) fetchedAt.current = Date.now();
  }, []);

  // Changing visibility moves you in or out of boards: fetch again.
  useEffect(() => {
    fetchedAt.current = 0;
  }, [visibility]);

  useEffect(() => {
    if (tab !== "leagues" || !enabled) return;
    if (Date.now() - fetchedAt.current < LEAGUES_TTL_MS) return;
    void loadLeagues();
  }, [tab, enabled, visibility, loadLeagues]);

  return (
    <>
      <ProgressPage
        state={state}
        enabled={enabled}
        loading={loading || firstLoad}
        tab={tab}
        onTabChange={setTab}
        leagues={leagues}
        onRetryLeagues={() => void loadLeagues()}
        onRetry={() => {
          setFirstLoad(true);
          void gameStore.refresh().finally(() => setFirstLoad(false));
        }}
        onOpenGameSettings={onOpenGameSettings}
        onOpenChest={setChest}
        onEquip={(slot, itemId) => gameStore.equip(slot, itemId)}
        onPinAchievements={(ids) => gameStore.pinAchievements(ids)}
        onRenamePet={(name) => gameStore.setPetName(name)}
        onCraft={(itemId) => gameStore.craft(itemId)}
      />
      {chest && <ChestDialog key={chest.id} chest={chest} onClose={() => setChest(null)} />}
    </>
  );
}
