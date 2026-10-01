import { useEffect, useMemo, useState } from "react";
import type { Habit, Task } from "../types";
import { ACCOUNT_DATA_CHANGED } from "../lib/accountDocuments";
import { getAccountId } from "../lib/accountScope";
import { getToken } from "../lib/auth";
import { loadCalendarState, type CalendarState } from "../lib/calendar";
import { useI18n } from "../lib/i18n";
import {
  PLANNING_ESTIMATES_EVENT,
  PLANNING_SETTINGS_EVENT,
  busyFromCalendar,
  cachedEstimates,
  getPlanningSettings,
  readPreviousPlan,
  requestAiEstimates,
  storeEstimates,
  tasksNeedingEstimates,
  writePreviousPlan,
} from "../lib/planning";
import { dateKeyOf, planTimeBlocks, planningCandidates, type PlanResult, type PlanningSettings } from "../lib/timeBlocking";
import { useHostedAiAvailable } from "./useHostedAi";

const RECOMPUTE_MS = 5 * 60_000;
const AI_DEBOUNCE_MS = 1500;
const AI_BACKOFF_MS = 30 * 60_000;

// Shared across hook instances so Today and the calendar never ask twice.
let aiInFlight = false;
let aiBackoffUntil = 0;
const aiTried = new Set<string>();

function readCalendar(): CalendarState | null {
  try { return loadCalendarState(); } catch { return null; }
}

/** The calendar sources, refreshed when account data or another tab changes them. */
export function useCalendarSnapshot(): CalendarState | null {
  const [state, setState] = useState<CalendarState | null>(readCalendar);
  useEffect(() => {
    const refresh = () => setState(readCalendar());
    window.addEventListener(ACCOUNT_DATA_CHANGED, refresh);
    window.addEventListener("storage", refresh);
    window.addEventListener("prior-auth-change", refresh);
    return () => {
      window.removeEventListener(ACCOUNT_DATA_CHANGED, refresh);
      window.removeEventListener("storage", refresh);
      window.removeEventListener("prior-auth-change", refresh);
    };
  }, []);
  return state;
}

export function usePlanningSettings(): PlanningSettings {
  const [settings, setSettings] = useState(getPlanningSettings);
  useEffect(() => {
    const refresh = () => setSettings((current) => {
      const next = getPlanningSettings();
      return JSON.stringify(next) === JSON.stringify(current) ? current : next;
    });
    window.addEventListener(PLANNING_SETTINGS_EVENT, refresh);
    window.addEventListener(ACCOUNT_DATA_CHANGED, refresh);
    window.addEventListener("prior-auth-change", refresh);
    return () => {
      window.removeEventListener(PLANNING_SETTINGS_EVENT, refresh);
      window.removeEventListener(ACCOUNT_DATA_CHANGED, refresh);
      window.removeEventListener("prior-auth-change", refresh);
    };
  }, []);
  return settings;
}

function usePlanningClock(): Date {
  const [bucket, setBucket] = useState(() => Math.floor(Date.now() / RECOMPUTE_MS));
  useEffect(() => {
    const timer = window.setInterval(() => setBucket(Math.floor(Date.now() / RECOMPUTE_MS)), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  // Plan from the real time inside the bucket so the block in progress is right.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => new Date(), [bucket]);
}

export type TimeBlocking = {
  readonly settings: PlanningSettings;
  readonly plan: PlanResult | null;
  /** Prior AI estimates durations and effort for this account. */
  readonly aiActive: boolean;
  readonly now: Date;
};

/**
 * The automatic plan for the given tasks (the user's own open tasks). It is
 * recomputed when tasks, habits, the calendar, the settings or the AI
 * estimates change, and every five minutes so missed blocks move forward.
 */
export function useTimeBlocking(tasks: readonly Task[], habits: readonly Habit[], calendarState?: CalendarState | null): TimeBlocking {
  const { lang } = useI18n();
  const settings = usePlanningSettings();
  const snapshot = useCalendarSnapshot();
  // The calendar page passes its live state so a new event re-plans at once.
  const calendar = calendarState === undefined ? snapshot : calendarState;
  const now = usePlanningClock();
  const hosted = useHostedAiAvailable();
  const [estimatesVersion, setEstimatesVersion] = useState(0);
  useEffect(() => {
    const bump = () => setEstimatesVersion((value) => value + 1);
    window.addEventListener(PLANNING_ESTIMATES_EVENT, bump);
    return () => window.removeEventListener(PLANNING_ESTIMATES_EVENT, bump);
  }, []);

  const today = dateKeyOf(now);
  const candidates = useMemo(() => planningCandidates(tasks), [tasks]);
  const busy = useMemo(() => busyFromCalendar(calendar, habits, today, settings.horizonDays), [calendar, habits, today, settings.horizonDays]);
  const aiActive = settings.enabled && settings.useAI && hosted === true;

  const plan = useMemo(() => {
    if (!settings.enabled) return null;
    try {
      return planTimeBlocks({ tasks: candidates, busy, now, settings, aiEstimates: aiActive ? cachedEstimates(candidates) : undefined, previous: readPreviousPlan() });
    } catch (error) {
      console.warn("Time blocking failed:", error);
      return null;
    }
    // estimatesVersion re-reads the estimate cache.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidates, busy, now, settings, aiActive, estimatesVersion]);

  useEffect(() => {
    if (plan) writePreviousPlan(plan.blocks);
  }, [plan]);

  // Ask Jev for the tasks it has not estimated yet (new or edited ones only).
  useEffect(() => {
    if (!aiActive || aiInFlight || Date.now() < aiBackoffUntil) return;
    const account = getAccountId();
    const pending = tasksNeedingEstimates(candidates).filter((task) => !aiTried.has(`${account}:${task.id}:${task.title}`));
    if (!pending.length) return;
    const timer = window.setTimeout(() => {
      if (aiInFlight) return;
      aiInFlight = true;
      for (const task of pending) aiTried.add(`${account}:${task.id}:${task.title}`);
      void getToken().catch(() => null).then(async (token) => {
        if (!token || account !== getAccountId()) return;
        const estimates = await requestAiEstimates(pending, lang, token);
        if (account === getAccountId() && estimates.size) storeEstimates(pending, estimates);
      }).catch((error) => {
        aiBackoffUntil = Date.now() + AI_BACKOFF_MS;
        console.warn("Planning estimates unavailable:", error);
      }).finally(() => { aiInFlight = false; });
    }, AI_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [aiActive, candidates, lang]);

  return { settings, plan, aiActive, now };
}
