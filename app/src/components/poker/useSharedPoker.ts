import { useCallback, useEffect, useRef, useState } from "react";
import { ApiAuthError, api, type PokerDeckId, type PokerSession } from "../../lib/api";
import { getToken } from "../../lib/auth";
import { useOnline } from "../../lib/connectivity";
import { useI18n } from "../../lib/i18n";
import type { PokerController } from "../../lib/poker";
import { REALTIME_EVENT } from "../../lib/realtime";

/** Realtime events are coalesced: a burst of votes costs one request. */
const REFETCH_DEBOUNCE_MS = 150;
/** Safety net when the socket is down: poll while a session is running... */
const ACTIVE_POLL_MS = 10_000;
/** ...and more slowly while waiting for someone to start one. */
const IDLE_POLL_MS = 30_000;

/**
 * The shared table of a project, served by the API (specs/SCRUM.md). It
 * refetches on `poker_required` realtime events, polls as a fallback while
 * the tab is visible, and applies writes optimistically so a tap on a card
 * feels instant. `meId` is the signed-in account (to mark its own vote).
 */
export function useSharedPoker(projectId: string, meId: string | null): PokerController {
  const { t } = useI18n();
  const online = useOnline();
  const [session, setSession] = useState<PokerSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const sessionRef = useRef<PokerSession | null>(null);
  /** Bumped by every write: a read that started before one is stale and dropped. */
  const writes = useRef(0);
  const live = useRef(true);
  const textRef = useRef(t);
  textRef.current = t;

  const commit = useCallback((next: PokerSession | null) => {
    sessionRef.current = next;
    if (live.current) setSession(next);
  }, []);

  useEffect(() => {
    live.current = true;
    return () => { live.current = false; };
  }, []);

  const fail = useCallback((cause: unknown, fallbackKey: string) => {
    if (!live.current) return;
    setError(cause instanceof ApiAuthError ? textRef.current("poker.errors.signIn") : textRef.current(fallbackKey));
  }, []);

  const load = useCallback(async (silent: boolean) => {
    const token = await getToken();
    if (!token) { if (live.current) setLoading(false); return; }
    const mark = writes.current;
    try {
      const result = await api.pokerActive(projectId, token);
      if (!live.current || mark !== writes.current) return;
      commit(result.session && result.session.status === "active" ? result.session : null);
      setError(null);
    } catch (cause) {
      if (!silent) fail(cause, "poker.errors.load");
    } finally {
      if (live.current) setLoading(false);
    }
  }, [commit, fail, projectId]);

  // Fresh project: forget the previous one's table.
  useEffect(() => {
    commit(null);
    setLoading(true);
    setError(null);
    void load(false);
  }, [commit, load]);

  // Realtime: the server tells every member's device when the table changed.
  useEffect(() => {
    let timer: number | undefined;
    const onEvent = (event: Event) => {
      if ((event as CustomEvent<{ type?: string }>).detail?.type !== "poker_required") return;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => void load(true), REFETCH_DEBOUNCE_MS);
    };
    window.addEventListener(REALTIME_EVENT, onEvent);
    return () => { window.removeEventListener(REALTIME_EVENT, onEvent); window.clearTimeout(timer); };
  }, [load]);

  // Fallback polling, only for a visible tab that can reach the server.
  const active = session?.status === "active";
  useEffect(() => {
    if (!online) return undefined;
    const tick = () => { if (document.visibilityState === "visible") void load(true); };
    const interval = window.setInterval(tick, active ? ACTIVE_POLL_MS : IDLE_POLL_MS);
    document.addEventListener("visibilitychange", tick);
    window.addEventListener("online", tick);
    return () => { window.clearInterval(interval); document.removeEventListener("visibilitychange", tick); window.removeEventListener("online", tick); };
  }, [active, load, online]);

  /** One write: optimistic first, then the server's answer; a failure rolls back by refetching. */
  const write = useCallback(async (call: (token: string, current: PokerSession) => Promise<PokerSession | null>, optimistic?: (current: PokerSession) => PokerSession): Promise<boolean> => {
    const current = sessionRef.current;
    if (!current) return false;
    const id = ++writes.current;
    // Optimistic first: a tap on a card shows at once, whatever the network does.
    if (optimistic) commit(optimistic(current));
    setPending((count) => count + 1);
    setError(null);
    const token = await getToken();
    if (!token) {
      fail(new ApiAuthError(), "poker.errors.failed");
      if (id === writes.current) commit(current);
      if (live.current) setPending((count) => Math.max(0, count - 1));
      return false;
    }
    try {
      const next = await call(token, current);
      if (id === writes.current) commit(next && next.status === "active" ? next : null);
      return true;
    } catch (cause) {
      fail(cause, "poker.errors.failed");
      if (id === writes.current) commit(current);
      void load(true);
      return false;
    } finally {
      if (live.current) setPending((count) => Math.max(0, count - 1));
    }
  }, [commit, fail, load]);

  return {
    session,
    loading,
    busy: pending > 0,
    error,
    start: async (taskIds: string[], deck: PokerDeckId) => {
      const token = await getToken();
      if (!token) { fail(new ApiAuthError(), "poker.errors.failed"); return false; }
      const id = ++writes.current;
      setPending((count) => count + 1);
      setError(null);
      try {
        const created = await api.pokerStart(projectId, { taskIds, deck }, token);
        if (id === writes.current) commit(created);
        return true;
      } catch (cause) {
        fail(cause, "poker.errors.start");
        // Someone else may have started a session at the same moment.
        void load(true);
        return false;
      } finally {
        if (live.current) setPending((count) => Math.max(0, count - 1));
      }
    },
    vote: async (value) => {
      const current = sessionRef.current;
      if (!current || current.revealed) return;
      const item = current.items[current.currentIndex];
      if (!item) return;
      await write(
        (token, base) => api.pokerVote(projectId, base.id, item.taskId, value, token),
        (base) => ({ ...base, myVote: value, participants: base.participants.map((participant) => participant.userId === meId ? { ...participant, voted: value !== null } : participant) }),
      );
    },
    reveal: async () => { await write((token, base) => api.pokerReveal(projectId, base.id, token), (base) => ({ ...base, revealed: true })); },
    revote: async () => { await write((token, base) => api.pokerRevote(projectId, base.id, token)); },
    setCurrent: async (index) => { await write((token, base) => api.pokerSetCurrent(projectId, base.id, index, token)); },
    estimate: async (points, advance) => {
      const current = sessionRef.current;
      const item = current?.items[current.currentIndex];
      if (!item) return;
      await write(async (token, base) => (await api.pokerEstimate(projectId, base.id, { taskId: item.taskId, storyPoints: points, advance }, token)).session);
    },
    close: async () => { await write(async (token, base) => { await api.pokerClose(projectId, base.id, token); return null; }); },
    refresh: () => { void load(false); },
    dismissError: () => setError(null),
  };
}
