// Planning Poker (specs/SCRUM.md): decks, vote maths, task presets and the
// solo state machine. The shared table is served by the API; this file holds
// everything that has to behave the same offline (solo mode) and online.
import { useCallback, useEffect, useRef, useState } from "react";
import type { PokerDeckId, PokerSession } from "./api";
import { useI18n } from "./i18n";
import { normalizeStoryPoints } from "./storyPoints";

export type { PokerDeckId, PokerSession } from "./api";

/** Card values per deck. Must match `PokerDecks` in server/internal/store/poker.go. */
export const POKER_DECKS: Readonly<Record<PokerDeckId, readonly string[]>> = {
  fibonacci: ["0", "1", "2", "3", "5", "8", "13", "21", "?", "coffee"],
  modified: ["0", "0.5", "1", "2", "3", "5", "8", "13", "20", "40", "100", "?", "coffee"],
  tshirt: ["XS", "S", "M", "L", "XL", "?", "coffee"],
};
export const POKER_DECK_IDS: readonly PokerDeckId[] = ["fibonacci", "modified", "tshirt"];
/** T-shirt sizes are worth these story points. */
export const TSHIRT_POINTS: Readonly<Record<string, number>> = { XS: 1, S: 2, M: 3, L: 5, XL: 8 };
/** A session estimates at most this many tasks (the API limit). */
export const MAX_POKER_ITEMS = 50;

/** A stored or received deck name, or the default deck when it is not one. */
export function normalizeDeckId(value: unknown): PokerDeckId {
  return typeof value === "string" && (POKER_DECK_IDS as readonly string[]).includes(value) ? value as PokerDeckId : "fibonacci";
}

export function isSpecialCard(value: string): boolean {
  return value === "?" || value === "coffee";
}

/** Story points a card is worth: null for "?" and the coffee break. */
export function cardPoints(value: string, deck: PokerDeckId): number | null {
  if (isSpecialCard(value)) return null;
  if (deck === "tshirt") return TSHIRT_POINTS[value] ?? null;
  return normalizeStoryPoints(value);
}

/** What a card shows: "½" for 0.5, the text otherwise ("coffee" is drawn as an icon by the UI). */
export function cardFace(value: string): string {
  return value === "0.5" ? "½" : value;
}

/** Distinct numeric points of a deck in ascending order (the values "Accept" can step through). */
export function deckPoints(deck: PokerDeckId): number[] {
  const seen = new Set<number>();
  for (const card of POKER_DECKS[deck]) {
    const points = cardPoints(card, deck);
    if (points !== null) seen.add(points);
  }
  return [...seen].sort((a, b) => a - b);
}

/** The deck value closest to `average`; the higher one on a tie, so estimates err on the safe side. */
export function nearestDeckPoints(average: number, deck: PokerDeckId): number | null {
  const options = deckPoints(deck);
  let best: number | null = null;
  for (const option of options) {
    if (best === null || Math.abs(option - average) < Math.abs(best - average) || (Math.abs(option - average) === Math.abs(best - average) && option > best)) best = option;
  }
  return best;
}

export type PokerDistribution = { value: string; points: number | null; count: number };
export type PokerSummary = {
  /** Cards on the table (everyone who voted). */
  total: number;
  /** Cards that carry points (not "?" or the coffee break). */
  numeric: number;
  unsure: number;
  coffee: number;
  average: number | null;
  median: number | null;
  min: number | null;
  max: number | null;
  /** One entry per distinct card, in deck order. */
  distribution: PokerDistribution[];
  /** At least two people played the very same points card. */
  consensus: boolean;
  /** The proposed estimate: the agreed card, else the deck value closest to the average. */
  suggested: number | null;
  /** More than one distinct numeric card: worth a discussion. */
  divided: boolean;
};

function roundTo(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/** Statistics of revealed votes. Null/empty entries (no card) are ignored. */
export function pokerSummary(votes: ReadonlyArray<string | null | undefined>, deck: PokerDeckId): PokerSummary {
  const cards = votes.filter((vote): vote is string => typeof vote === "string" && vote !== "");
  const order = POKER_DECKS[deck];
  const counts = new Map<string, number>();
  for (const card of cards) counts.set(card, (counts.get(card) ?? 0) + 1);
  const distribution = [...counts.entries()]
    .map(([value, count]) => ({ value, points: cardPoints(value, deck), count }))
    .sort((a, b) => {
      const left = order.indexOf(a.value);
      const right = order.indexOf(b.value);
      return (left === -1 ? order.length : left) - (right === -1 ? order.length : right);
    });
  const points = cards.map((card) => cardPoints(card, deck)).filter((value): value is number => value !== null).sort((a, b) => a - b);
  const numeric = points.length;
  const average = numeric ? roundTo(points.reduce((sum, value) => sum + value, 0) / numeric, 2) : null;
  const median = numeric ? (numeric % 2 ? points[(numeric - 1) / 2] : (points[numeric / 2 - 1] + points[numeric / 2]) / 2) : null;
  const numericCards = distribution.filter((entry) => entry.points !== null);
  const consensus = numeric >= 2 && cards.length === numeric && numericCards.length === 1;
  const suggested = consensus ? numericCards[0].points : average === null ? null : nearestDeckPoints(average, deck);
  return {
    total: cards.length,
    numeric,
    unsure: counts.get("?") ?? 0,
    coffee: counts.get("coffee") ?? 0,
    average,
    median,
    min: numeric ? points[0] : null,
    max: numeric ? points[numeric - 1] : null,
    distribution,
    consensus,
    suggested,
    divided: numericCards.length > 1,
  };
}

/** Typed shortcut of a card: digits and letters as written, "c" for the coffee break. */
function cardToken(card: string): string {
  return card === "coffee" ? "c" : card.toLowerCase();
}

/**
 * Resolves what the user typed to a card. "1" alone is ambiguous with "13", so
 * an exact match that is also the start of another card is `pending`: the
 * caller commits it after a short pause, or extends the buffer with the next key.
 */
export function resolveCardKey(buffer: string, deck: PokerDeckId): { card: string | null; pending: boolean } {
  let typed = buffer.toLowerCase();
  if (typed.startsWith(".") || typed.startsWith(",")) typed = `0.${typed.slice(1)}`;
  if (!typed) return { card: null, pending: false };
  const cards = POKER_DECKS[deck];
  const candidates = cards.filter((card) => cardToken(card).startsWith(typed));
  if (!candidates.length) return { card: null, pending: false };
  const exact = candidates.find((card) => cardToken(card) === typed) ?? null;
  if (exact && candidates.length === 1) return { card: exact, pending: false };
  return { card: exact, pending: true };
}

export type PokerTaskLike = { id: string; title?: string; storyPoints?: number | null; completed?: boolean; deletedAt?: string | null };
export type PokerCycleLike = { id: string; name: string; startsOn: string; endsOn: string; issueIds?: readonly string[] };
export type PokerPresetId = "unestimated" | "active" | "next" | "backlog" | "open";
export type PokerPreset = { id: PokerPresetId; taskIds: string[]; cycleName?: string };

/** Tasks a session can estimate: not done, not deleted. */
export function openPokerTasks<T extends PokerTaskLike>(tasks: readonly T[]): T[] {
  return tasks.filter((task) => !task.completed && !task.deletedAt);
}

/**
 * The quick selections of the start screen. Empty ones are left out, and so
 * is any that repeats an earlier selection.
 */
export function pokerPresets(tasks: readonly PokerTaskLike[], cycles: readonly PokerCycleLike[], today: string): PokerPreset[] {
  const open = openPokerTasks(tasks);
  const openIds = new Set(open.map((task) => task.id));
  const inCycle = (cycle: PokerCycleLike) => open.filter((task) => cycle.issueIds?.includes(task.id)).map((task) => task.id);
  const active = cycles.find((cycle) => cycle.startsOn <= today && today <= cycle.endsOn);
  const next = [...cycles].filter((cycle) => cycle.startsOn > today).sort((a, b) => a.startsOn.localeCompare(b.startsOn))[0];
  const sprinted = new Set(cycles.flatMap((cycle) => cycle.issueIds ?? []));
  const presets: PokerPreset[] = [
    { id: "unestimated", taskIds: open.filter((task) => normalizeStoryPoints(task.storyPoints) === null).map((task) => task.id) },
    ...(active ? [{ id: "active" as const, taskIds: inCycle(active), cycleName: active.name }] : []),
    ...(next ? [{ id: "next" as const, taskIds: inCycle(next), cycleName: next.name }] : []),
    { id: "backlog", taskIds: open.filter((task) => !sprinted.has(task.id)).map((task) => task.id) },
    { id: "open", taskIds: [...openIds] },
  ];
  // A selection that repeats an earlier one adds nothing (no sprints: backlog = all open).
  const seen = new Set<string>();
  return presets.filter((preset) => {
    if (!preset.taskIds.length) return false;
    const key = [...preset.taskIds].sort().join("|");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/* ── Solo mode: the same PokerSession shape, kept in this browser ─────────── */

export type SoloUser = { id: string; name: string; avatarUrl?: string | null };

export function soloStart(me: SoloUser, tasks: ReadonlyArray<{ id: string; title: string; storyPoints?: number | null }>, deck: PokerDeckId, projectId: string, now = new Date().toISOString()): PokerSession {
  return {
    id: `solo-${projectId}`,
    projectId,
    status: "active",
    deck,
    facilitatorId: me.id,
    canControl: true,
    currentIndex: 0,
    round: 1,
    revealed: false,
    items: tasks.slice(0, MAX_POKER_ITEMS).map((task) => ({ taskId: task.id, title: task.title, storyPoints: normalizeStoryPoints(task.storyPoints), finalPoints: null })),
    participants: [{ userId: me.id, displayName: me.name, avatarUrl: me.avatarUrl ?? null, role: "owner", online: true, voted: false, vote: null }],
    myVote: null,
    createdAt: now,
    updatedAt: now,
  };
}

function soloTouch(session: PokerSession, patch: Partial<PokerSession>): PokerSession {
  const next = { ...session, ...patch, updatedAt: new Date().toISOString() };
  next.participants = session.participants.map((participant) => ({ ...participant, voted: next.myVote !== null, vote: next.revealed ? next.myVote : null }));
  return next;
}

export function soloVote(session: PokerSession, value: string | null): PokerSession {
  if (session.revealed) return session;
  if (value !== null && !POKER_DECKS[session.deck].includes(value)) return session;
  return soloTouch(session, { myVote: value });
}
export const soloReveal = (session: PokerSession): PokerSession => session.revealed ? session : soloTouch(session, { revealed: true });
export const soloRevote = (session: PokerSession): PokerSession => soloTouch(session, { revealed: false, myVote: null, round: session.round + 1 });
export function soloSetCurrent(session: PokerSession, index: number): PokerSession {
  if (!Number.isInteger(index) || index < 0 || index >= session.items.length) return session;
  return soloTouch(session, { currentIndex: index, round: 1, revealed: false, myVote: null });
}
export const soloClose = (session: PokerSession): PokerSession => ({ ...session, status: "closed", updatedAt: new Date().toISOString() });

/** The next task still to decide after `from` (wrapping), or null when every task has a final estimate. */
export function nextUndecided(session: Pick<PokerSession, "items">, from: number): number | null {
  const count = session.items.length;
  for (let step = 1; step <= count; step += 1) {
    const index = (from + step) % count;
    if (session.items[index].finalPoints === null) return index;
  }
  return null;
}

/** Records the accepted estimate on the current task and moves to the next undecided one. */
export function soloEstimate(session: PokerSession, points: number | null, advance: boolean): PokerSession {
  const items = session.items.map((item, index) => index === session.currentIndex ? { ...item, storyPoints: points, finalPoints: points } : item);
  const next = advance ? nextUndecided({ items }, session.currentIndex) : null;
  const moved = soloTouch({ ...session, items }, next === null ? { revealed: false, myVote: null, round: 1 } : { currentIndex: next, revealed: false, myVote: null, round: 1 });
  return moved;
}

const SOLO_KEY = "prior.poker.solo.";

function readSolo(projectId: string): PokerSession | null {
  try {
    const raw = window.localStorage.getItem(SOLO_KEY + projectId);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<PokerSession> | null;
    if (!value || value.status !== "active" || !Array.isArray(value.items) || !value.items.length || !Array.isArray(value.participants)) return null;
    if (!value.deck || !(value.deck in POKER_DECKS) || typeof value.currentIndex !== "number" || value.currentIndex < 0 || value.currentIndex >= value.items.length) return null;
    return value as PokerSession;
  } catch {
    return null;
  }
}

function writeSolo(projectId: string, session: PokerSession | null): void {
  try {
    if (session && session.status === "active") window.localStorage.setItem(SOLO_KEY + projectId, JSON.stringify(session));
    else window.localStorage.removeItem(SOLO_KEY + projectId);
  } catch {
    // Storage can be unavailable (private mode); the session then lasts until the tab closes.
  }
}

/** What the table needs from a session source, whether it is the API or this browser. */
export type PokerController = {
  session: PokerSession | null;
  loading: boolean;
  busy: boolean;
  /** Already translated, ready to show. */
  error: string | null;
  start: (taskIds: string[], deck: PokerDeckId) => Promise<boolean>;
  vote: (value: string | null) => Promise<void>;
  reveal: () => Promise<void>;
  revote: () => Promise<void>;
  setCurrent: (index: number) => Promise<void>;
  estimate: (points: number | null, advance: boolean) => Promise<void>;
  close: () => Promise<void>;
  refresh: () => void;
  dismissError: () => void;
};

type SoloOptions = {
  projectId: string;
  me: SoloUser;
  tasks: ReadonlyArray<{ id: string; title: string; storyPoints?: number | null }>;
  /** Saves the accepted estimate on the task. */
  onSetPoints: (taskId: string, points: number | null) => Promise<void>;
};

/** Solo planning poker: the same table for projects nobody else is in. */
export function useSoloPoker({ projectId, me, tasks, onSetPoints }: SoloOptions): PokerController {
  const { t } = useI18n();
  const [session, setSession] = useState<PokerSession | null>(() => readSolo(projectId));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const tasksRef = useRef(tasks);
  tasksRef.current = tasks;

  useEffect(() => { setSession(readSolo(projectId)); setError(null); }, [projectId]);

  const apply = useCallback((next: PokerSession | null) => {
    sessionRef.current = next;
    setSession(next);
    writeSolo(projectId, next);
  }, [projectId]);
  const change = useCallback((update: (current: PokerSession) => PokerSession) => {
    const current = sessionRef.current;
    if (current) apply(update(current));
  }, [apply]);

  return {
    session,
    loading: false,
    busy,
    error,
    start: async (taskIds, deck) => {
      const picked = taskIds.map((id) => tasksRef.current.find((task) => task.id === id)).filter((task): task is NonNullable<typeof task> => Boolean(task));
      if (!picked.length) return false;
      apply(soloStart(me, picked, deck, projectId));
      setError(null);
      return true;
    },
    vote: async (value) => change((current) => soloVote(current, value)),
    reveal: async () => change(soloReveal),
    revote: async () => change(soloRevote),
    setCurrent: async (index) => change((current) => soloSetCurrent(current, index)),
    estimate: async (points, advance) => {
      const current = sessionRef.current;
      const item = current?.items[current.currentIndex];
      if (!current || !item) return;
      setBusy(true);
      setError(null);
      try {
        await onSetPoints(item.taskId, points);
        change((latest) => soloEstimate(latest, points, advance));
      } catch (cause) {
        setError(cause instanceof Error && cause.message ? cause.message : t("poker.errors.save"));
      } finally {
        setBusy(false);
      }
    },
    close: async () => apply(null),
    refresh: () => undefined,
    dismissError: () => setError(null),
  };
}
