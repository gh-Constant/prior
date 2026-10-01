import type { Task } from "../types";
import { normalizeEstimate } from "./taskEstimate";

/*
 * Automatic time blocking (specs/TIME_BLOCKING.md).
 *
 * A deterministic planner in the spirit of Motion, Reclaim and SkedPal: it
 * reads the user's open tasks and busy calendar time and places every task in
 * the working hours of the next days. It never moves calendar events and never
 * writes to tasks by itself; the plan is derived state, recomputed whenever
 * tasks, the calendar, the settings or the clock change.
 *
 * 1. Candidates: open tasks that are not waiting, not containers of open
 *    sub-tasks, and (for inbox/backlog) carry a signal worth planning.
 * 2. Order: weight (priority, importance, status, AI value) times deadline
 *    pressure, then blockers before the tasks they block.
 * 3. Placement: greedy, task by task, each chunk going to the cheapest free
 *    slot. The cost mixes earliness (scaled by urgency), fit (no crumbs, short
 *    tasks fill small gaps so long gaps stay for deep work), energy (deep work
 *    in the peak window), stability (keep yesterday's slot) and the day the
 *    user planned. Long tasks are split between the min and max block length.
 * 4. Repair: a task that misses its deadline is moved to the front of the
 *    order and the plan is rebuilt (a few rounds, best plan kept). Tasks that
 *    still cannot fit are reported as at risk.
 */

export type EnergyKind = "deep" | "light";
export type PeakWindow = "morning" | "afternoon" | "evening" | "none";

export type PlanningSettings = {
  /** Auto-planning on: blocks appear in Today and the calendar. */
  enabled: boolean;
  /** JS weekdays (0 = Sunday) the planner may use. */
  workDays: number[];
  dayStart: string;
  dayEnd: string;
  /** Lunch break, or none when either side is null. */
  lunchStart: string | null;
  lunchEnd: string | null;
  /** Kept free before and after each calendar event. */
  bufferMinutes: number;
  /** Kept free after each planned block. */
  breakMinutes: number;
  minBlockMinutes: number;
  maxBlockMinutes: number;
  /** Most task time planned on one day (fixed blocks included). */
  dailyFocusMinutes: number;
  horizonDays: number;
  /** When the user does their best deep work. */
  peak: PeakWindow;
  /** Duration of a task that has nothing to estimate it from. */
  defaultMinutes: number;
  /** Let Prior AI (Jev) estimate durations and effort. */
  useAI: boolean;
};

export const DEFAULT_PLANNING_SETTINGS: PlanningSettings = {
  enabled: true,
  workDays: [1, 2, 3, 4, 5],
  dayStart: "09:00",
  dayEnd: "18:00",
  lunchStart: "12:00",
  lunchEnd: "13:00",
  bufferMinutes: 10,
  breakMinutes: 5,
  minBlockMinutes: 25,
  maxBlockMinutes: 90,
  dailyFocusMinutes: 6 * 60,
  horizonDays: 7,
  peak: "morning",
  defaultMinutes: 30,
  useAI: true,
};

/** A duration/effort estimate. `value` (0-4) is how much the task matters, when AI could tell. */
export type TaskEstimate = { minutes: number; energy: EnergyKind; value?: number; source: "user" | "ai" | "guess" };

/** Time the planner must not use, in minutes since local midnight of `date`. */
export type BusyBlock = { date: string; start: number; end: number; buffer?: boolean };

export type PlannedBlock = {
  id: string;
  taskId: string;
  date: string;
  start: number;
  end: number;
  /** 1-based piece number when a task is split, and the number of pieces. */
  part: number;
  parts: number;
  /** The user's own time (scheduledDate + scheduledTime) or the block in progress. */
  fixed: boolean;
  energy: EnergyKind;
  /** Ends after the task's deadline. */
  late: boolean;
};

export type PlanIssue = {
  taskId: string;
  /** late: cannot be done before its deadline; overdue: the deadline passed; unscheduled: no room in the horizon. */
  kind: "late" | "overdue" | "unscheduled";
  /** Minutes that found no slot. */
  minutesLeft: number;
};

export type PlanDay = { date: string; capacity: number; planned: number };

export type PlanResult = {
  blocks: PlannedBlock[];
  issues: PlanIssue[];
  days: PlanDay[];
  estimates: Map<string, TaskEstimate>;
};

export type PlanInput = {
  tasks: readonly Task[];
  busy: readonly BusyBlock[];
  now: Date;
  settings: PlanningSettings;
  /** AI estimates by task id (Jev); the user's own estimate always wins. */
  aiEstimates?: ReadonlyMap<string, Omit<TaskEstimate, "source">>;
  /** The previous plan, for stability and for the block in progress. */
  previous?: readonly PlannedBlock[];
};

const DAY = 24 * 60;
const MAX_TASKS = 150;
const MAX_PIECES = 6;
const MIN_SLOT = 10;
const REPAIR_ROUNDS = 3;

/* ── Small helpers ────────────────────────────────────────────────────── */

export function clockToMinutes(value: string | null | undefined): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value ?? "");
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 24 || minutes > 59 || (hours === 24 && minutes > 0)) return null;
  return hours * 60 + minutes;
}

export function minutesToClock(value: number): string {
  const safe = Math.max(0, Math.min(DAY, Math.round(value)));
  return `${String(Math.floor(safe / 60)).padStart(2, "0")}:${String(safe % 60).padStart(2, "0")}`;
}

export function dateKeyOf(value: Date): string {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

function parseKey(key: string): Date {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, (month || 1) - 1, day || 1);
}

export function addDaysToKey(key: string, amount: number): string {
  const date = parseKey(key);
  date.setDate(date.getDate() + amount);
  return dateKeyOf(date);
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.UTC(...ymd(to)) - Date.UTC(...ymd(from))) / 86_400_000);
}

function ymd(key: string): [number, number, number] {
  const [year, month, day] = key.split("-").map(Number);
  return [year, (month || 1) - 1, day || 1];
}

function validDateKey(value: string | null | undefined): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value.slice(0, 10)) && !Number.isNaN(parseKey(value.slice(0, 10)).getTime());
}

const round5 = (value: number) => Math.round(value / 5) * 5;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export function normalizePlanningSettings(value: unknown): PlanningSettings {
  const raw = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const d = DEFAULT_PLANNING_SETTINGS;
  const clock = (field: unknown, fallback: string) => typeof field === "string" && clockToMinutes(field) !== null ? field : fallback;
  const optionalClock = (field: unknown, fallback: string | null) => field === null ? null : typeof field === "string" && clockToMinutes(field) !== null ? field : fallback;
  const number = (field: unknown, fallback: number, min: number, max: number) => typeof field === "number" && Number.isFinite(field) ? clamp(Math.round(field), min, max) : fallback;
  const days = Array.isArray(raw.workDays) ? [...new Set(raw.workDays.filter((day): day is number => Number.isInteger(day) && day >= 0 && day <= 6))].sort() : d.workDays;
  // Keep at least one working hour, moving the end rather than discarding the user's start.
  const startMinutes = Math.min(clockToMinutes(clock(raw.dayStart, d.dayStart))!, 22 * 60 + 59);
  const endMinutes = Math.min(DAY - 1, Math.max(clockToMinutes(clock(raw.dayEnd, d.dayEnd))!, startMinutes + 60));
  const dayStart = minutesToClock(startMinutes);
  const dayEnd = minutesToClock(endMinutes);
  let lunchStart = optionalClock(raw.lunchStart, d.lunchStart);
  let lunchEnd = optionalClock(raw.lunchEnd, d.lunchEnd);
  if (!lunchStart || !lunchEnd || clockToMinutes(lunchEnd)! <= clockToMinutes(lunchStart)!) { lunchStart = null; lunchEnd = null; }
  const minBlock = number(raw.minBlockMinutes, d.minBlockMinutes, 10, 120);
  return {
    enabled: raw.enabled !== false,
    workDays: days,
    dayStart,
    dayEnd,
    lunchStart,
    lunchEnd,
    bufferMinutes: number(raw.bufferMinutes, d.bufferMinutes, 0, 60),
    breakMinutes: number(raw.breakMinutes, d.breakMinutes, 0, 30),
    minBlockMinutes: minBlock,
    maxBlockMinutes: Math.max(minBlock, number(raw.maxBlockMinutes, d.maxBlockMinutes, 15, 240)),
    dailyFocusMinutes: number(raw.dailyFocusMinutes, d.dailyFocusMinutes, 30, 16 * 60),
    horizonDays: number(raw.horizonDays, d.horizonDays, 1, 21),
    peak: raw.peak === "afternoon" || raw.peak === "evening" || raw.peak === "none" || raw.peak === "morning" ? raw.peak : d.peak,
    defaultMinutes: number(raw.defaultMinutes, d.defaultMinutes, 5, 240),
    useAI: raw.useAI !== false,
  };
}

/* ── Estimates ────────────────────────────────────────────────────────── */

function plainText(value: string): string {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

// Word stems in English, French, Spanish, German and Portuguese.
const QUICK_WORDS = /\b(call|appel|rappel|phone|telephon|llamar|anrufen|ligar|e-?mail|mail|reply|repond|respond|antwort|answer|send|envoy|enviar|senden|pay|pa[iy]e|pagar|zahlen|buy|achet|compr|kauf|order|command|pedir|bestell|print|imprim|drucken|sign|book|reserv|buch|check|verifi|pruf|relanc|follow[- ]?up|renew|renouvel|cancel|annul|text|sms|ping|confirm)/;
const DEEP_WORDS = /\b(write|ecri|redig|escrib|schreib|escrev|draft|brouillon|design|concev|disen|entwerf|code|coder|program|develop|devel|desarroll|entwickl|implement|refactor|debug|stud|etudi|estudi|lern|learn|apprend|aprend|revis|analy[sz]|research|recherch|investig|forsch|plan|prepar|vorbereit|present|rapport|report|bericht|relatorio|memoire|thesis|these|tesis|dissert|architect|spec|strateg|budget|proposal|proposition|propuesta|angebot|article|chapter|chapitre|essay|redaction|slides|deck)/;

/** A cheap local estimate: keywords, checklist size and description length. */
export function guessEstimate(task: Pick<Task, "title" | "description" | "checklist">, settings: Pick<PlanningSettings, "defaultMinutes">): Omit<TaskEstimate, "source"> {
  const text = plainText(task.title);
  const quick = QUICK_WORDS.test(text);
  const deep = DEEP_WORDS.test(text);
  let minutes = settings.defaultMinutes;
  if (deep) minutes = Math.max(60, minutes);
  else if (quick) minutes = Math.min(15, minutes);
  const items = task.checklist?.length ?? 0;
  if (items >= 2) minutes = Math.max(minutes, Math.min(240, items * 15));
  if ((task.description ?? "").length > 600) minutes += 15;
  return { minutes: clamp(round5(minutes), 5, 480), energy: deep || (!quick && minutes >= 60) ? "deep" : "light" };
}

/** The estimate the planner uses: the user's, then AI's, then the local guess; open checklist share shrinks it. */
export function resolveEstimate(task: Task, settings: PlanningSettings, ai?: Omit<TaskEstimate, "source">): TaskEstimate {
  const guess = guessEstimate(task, settings);
  const user = normalizeEstimate(task.estimatedMinutes);
  let minutes = user ?? ai?.minutes ?? guess.minutes;
  const items = task.checklist ?? [];
  const open = items.filter((item) => !item.done).length;
  if (items.length >= 2 && open < items.length) minutes = Math.max(10, minutes * open / items.length);
  return {
    minutes: clamp(round5(minutes), 5, 600),
    energy: ai?.energy ?? guess.energy,
    ...(ai?.value !== undefined ? { value: ai.value } : {}),
    source: user !== null ? "user" : ai ? "ai" : "guess",
  };
}

/* ── Candidates and order ─────────────────────────────────────────────── */

/** Open tasks worth a block. Inbox and backlog items need a date, a priority or importance. */
export function planningCandidates(tasks: readonly Task[]): Task[] {
  const open = tasks.filter((task) => !task.completed && !task.deletedAt && task.status !== "done");
  const parentsWithOpenChildren = new Set(open.map((task) => task.parentId).filter(Boolean));
  return open.filter((task) => {
    if (task.status === "waiting" || parentsWithOpenChildren.has(task.id)) return false;
    if (!task.title.trim()) return false;
    const dated = validDateKey(task.dueDate) || validDateKey(task.scheduledDate);
    if (task.status === "backlog") return dated;
    if (task.status === "inbox") return dated || task.priority <= 2 || task.important;
    return true;
  });
}

type Deadline = { date: string; minute: number };

function deadlineOf(task: Task): Deadline | null {
  if (!validDateKey(task.dueDate)) return null;
  return { date: task.dueDate.slice(0, 10), minute: clockToMinutes(task.dueTime ?? null) ?? DAY };
}

function taskWeight(task: Task, estimate: TaskEstimate): number {
  const base = ({ 1: 8, 2: 5, 3: 3, 4: 1.5 } as const)[task.priority] ?? 1.5;
  let weight = base + (task.important ? 3 : 0) + (task.urgent ? 2 : 0);
  if (task.status === "in_progress") weight += 2.5;
  else if (task.status === "next") weight += 1;
  // AI only fills the gap when the user gave no signal at all.
  if (estimate.value !== undefined && task.priority === 4 && !task.important && !task.urgent) weight += estimate.value * 1.2;
  return weight;
}

function urgencyOf(task: Task, today: string): number {
  const deadline = deadlineOf(task);
  let urgency = 1;
  if (deadline) {
    const daysLeft = daysBetween(today, deadline.date);
    urgency = daysLeft < 0 ? 6 : 1 + 5 / (1 + daysLeft);
  }
  if (validDateKey(task.scheduledDate) && task.scheduledDate.slice(0, 10) <= today) urgency += 0.8;
  return urgency;
}

function blockersOf(task: Task, ids: ReadonlySet<string>): string[] {
  return (task.relations ?? []).filter((relation) => relation.type === "blocked_by" && ids.has(relation.taskId)).map((relation) => relation.taskId);
}

/** Keep the given order but never place a task before the tasks blocking it. */
function withDependencies(order: readonly Task[], blockers: ReadonlyMap<string, string[]>): Task[] {
  const result: Task[] = [];
  const placed = new Set<string>();
  const remaining = [...order];
  while (remaining.length) {
    let index = remaining.findIndex((task) => (blockers.get(task.id) ?? []).every((id) => placed.has(id)));
    if (index < 0) index = 0; // a cycle: break it at the most important task
    const [task] = remaining.splice(index, 1);
    result.push(task);
    placed.add(task.id);
  }
  return result;
}

/* ── Free time ────────────────────────────────────────────────────────── */

type Interval = { start: number; end: number };

function subtract(intervals: Interval[], start: number, end: number): Interval[] {
  if (end <= start) return intervals;
  return intervals.flatMap((interval) => {
    if (end <= interval.start || start >= interval.end) return [interval];
    const pieces: Interval[] = [];
    if (start > interval.start) pieces.push({ start: interval.start, end: start });
    if (end < interval.end) pieces.push({ start: end, end: interval.end });
    return pieces;
  });
}

function peakRange(settings: PlanningSettings): Interval | null {
  const dayStart = clockToMinutes(settings.dayStart)!;
  const dayEnd = clockToMinutes(settings.dayEnd)!;
  const lunchStart = clockToMinutes(settings.lunchStart);
  const lunchEnd = clockToMinutes(settings.lunchEnd);
  if (settings.peak === "morning") return { start: dayStart, end: Math.min(dayEnd, lunchStart ?? dayStart + 3 * 60 + 30) };
  if (settings.peak === "afternoon") { const start = lunchEnd ?? Math.max(dayStart, 13 * 60 + 30); return { start, end: Math.min(dayEnd, start + 3 * 60 + 30) }; }
  if (settings.peak === "evening") return { start: Math.max(dayStart, dayEnd - 3 * 60), end: dayEnd };
  return null;
}

type DaySlots = { date: string; index: number; free: Interval[]; capacity: number; load: number };

function buildDays(input: PlanInput, today: string, nowMinutes: number, fixed: readonly PlannedBlock[]): DaySlots[] {
  const { settings } = input;
  const dayStart = clockToMinutes(settings.dayStart)!;
  const dayEnd = clockToMinutes(settings.dayEnd)!;
  const lunchStart = clockToMinutes(settings.lunchStart);
  const lunchEnd = clockToMinutes(settings.lunchEnd);
  const days: DaySlots[] = [];
  for (let index = 0; index < settings.horizonDays; index += 1) {
    const date = addDaysToKey(today, index);
    if (!settings.workDays.includes(parseKey(date).getDay())) continue;
    const opens = index === 0 ? Math.max(dayStart, Math.ceil((nowMinutes + 5) / 5) * 5) : dayStart;
    let free: Interval[] = opens < dayEnd ? [{ start: opens, end: dayEnd }] : [];
    if (lunchStart !== null && lunchEnd !== null) free = subtract(free, lunchStart, lunchEnd);
    for (const busy of input.busy) {
      if (busy.date !== date) continue;
      const pad = busy.buffer ? settings.bufferMinutes : 0;
      free = subtract(free, busy.start - pad, busy.end + pad);
    }
    let load = 0;
    for (const block of fixed) {
      if (block.date !== date) continue;
      free = subtract(free, block.start, block.end + settings.breakMinutes);
      load += block.end - block.start;
    }
    free = free.filter((interval) => interval.end - interval.start >= MIN_SLOT);
    days.push({ date, index, free, capacity: free.reduce((total, interval) => total + interval.end - interval.start, 0), load });
  }
  return days;
}

/* ── Placement ────────────────────────────────────────────────────────── */

type Candidate = {
  task: Task;
  estimate: TaskEstimate;
  weight: number;
  urgency: number;
  deadline: Deadline | null;
  /** First day the task may be planned (its scheduled date when later than today). */
  release: string;
  preferredDate: string | null;
  remaining: number;
  blockers: string[];
};

type Placement = { blocks: PlannedBlock[]; issues: PlanIssue[]; days: DaySlots[]; cost: number; late: Set<string> };

function place(candidates: readonly Candidate[], input: PlanInput, today: string, nowMinutes: number, fixed: readonly PlannedBlock[]): Placement {
  const { settings } = input;
  const horizonEnd = addDaysToKey(today, settings.horizonDays - 1);
  const days = buildDays(input, today, nowMinutes, fixed);
  const dayStart = clockToMinutes(settings.dayStart)!;
  const peak = peakRange(settings);
  const previousByTask = new Map<string, PlannedBlock[]>();
  for (const block of input.previous ?? []) {
    const list = previousByTask.get(block.taskId) ?? [];
    list.push(block);
    previousByTask.set(block.taskId, list);
  }
  const blocks: PlannedBlock[] = [...fixed];
  const endOf = new Map<string, { date: string; minute: number }>();
  for (const block of fixed) {
    const current = endOf.get(block.taskId);
    if (!current || block.date > current.date || (block.date === current.date && block.end > current.minute)) endOf.set(block.taskId, { date: block.date, minute: block.end });
  }
  const issues: PlanIssue[] = [];
  const late = new Set<string>();
  let totalCost = 0;
  let deepLeft = candidates.reduce((total, candidate) => total + (candidate.estimate.energy === "deep" ? candidate.remaining : 0), 0);

  for (const candidate of candidates) {
    const { task, estimate, deadline } = candidate;
    let remaining = candidate.remaining;
    // Start after the blockers' last planned minute.
    let earliest: { date: string; minute: number } | null = null;
    for (const id of candidate.blockers) {
      const end = endOf.get(id);
      if (end && (!earliest || end.date > earliest.date || (end.date === earliest.date && end.minute > earliest.minute))) earliest = end;
    }
    const pieces: PlannedBlock[] = [];
    const previous = previousByTask.get(task.id) ?? [];
    while (remaining > 0 && pieces.length < MAX_PIECES) {
      let best: { day: DaySlots; interval: number; start: number; length: number; cost: number } | null = null;
      for (const day of days) {
        if (day.date < candidate.release) continue;
        if (earliest && day.date < earliest.date) continue;
        const room = settings.dailyFocusMinutes - day.load;
        if (room < Math.min(remaining, settings.minBlockMinutes)) continue;
        for (const [intervalIndex, interval] of day.free.entries()) {
          const from = earliest && day.date === earliest.date ? Math.max(interval.start, earliest.minute + settings.breakMinutes) : interval.start;
          if (interval.end - from < Math.min(remaining, settings.minBlockMinutes)) continue;
          const starts = new Set([from]);
          if (peak && peak.start > from && peak.start < interval.end) starts.add(peak.start);
          for (const block of previous) if (block.date === day.date && block.start > from && block.start < interval.end) starts.add(block.start);
          for (const start of starts) {
            const available = interval.end - start;
            let length = Math.min(remaining, settings.maxBlockMinutes, available, room);
            // Do not leave a tail shorter than 15 minutes for another day.
            if (remaining - length > 0 && remaining - length < 15 && available >= remaining && room >= remaining) length = remaining;
            // A split leaves a tail worth a block of its own.
            if (length < remaining && remaining - length < settings.minBlockMinutes) length = remaining - settings.minBlockMinutes;
            if (length < Math.min(remaining, settings.minBlockMinutes)) continue;
            const cost = slotCost({ candidate, day, start, length, available, remaining, dayStart, peak, previous, settings, deepLeft });
            if (!best || cost < best.cost || (cost === best.cost && (day.index < best.day.index || (day.index === best.day.index && start < best.start)))) best = { day, interval: intervalIndex, start, length, cost };
          }
        }
      }
      if (!best) break;
      const end = best.start + best.length;
      const isLate = deadline !== null && (best.day.date > deadline.date || (best.day.date === deadline.date && end > deadline.minute));
      if (isLate) late.add(task.id);
      pieces.push({ id: `${task.id}:${best.day.date}:${best.start}`, taskId: task.id, date: best.day.date, start: best.start, end, part: 0, parts: 0, fixed: false, energy: estimate.energy, late: isLate });
      const interval = best.day.free[best.interval];
      best.day.free.splice(best.interval, 1, ...[
        { start: interval.start, end: best.start },
        { start: end + settings.breakMinutes, end: interval.end },
      ].filter((piece) => piece.end - piece.start >= MIN_SLOT));
      best.day.load += best.length;
      remaining -= best.length;
      if (estimate.energy === "deep") deepLeft -= best.length;
      totalCost += best.cost;
      if (!earliest || best.day.date > earliest.date || (best.day.date === earliest.date && end > earliest.minute)) {
        // Later pieces of the same task follow the earlier ones.
        earliest = { date: best.day.date, minute: end - settings.breakMinutes };
      }
    }
    pieces.sort((left, right) => left.date.localeCompare(right.date) || left.start - right.start);
    const fixedParts = fixed.filter((block) => block.taskId === task.id).length;
    const parts = pieces.length + fixedParts;
    pieces.forEach((piece, index) => { piece.part = fixedParts + index + 1; piece.parts = parts; });
    blocks.push(...pieces);
    const last = pieces[pieces.length - 1];
    if (last) endOf.set(task.id, { date: last.date, minute: last.end });
    if (estimate.energy === "deep") deepLeft -= remaining;
    if (remaining > 0) {
      totalCost += 1000 * candidate.weight;
      if (deadline && deadline.date >= today && deadline.date <= horizonEnd) late.add(task.id);
    }
    if (deadline && (deadline.date < today || (deadline.date === today && deadline.minute <= nowMinutes))) issues.push({ taskId: task.id, kind: "overdue", minutesLeft: Math.max(0, remaining) });
    else if (late.has(task.id)) issues.push({ taskId: task.id, kind: "late", minutesLeft: Math.max(0, remaining) });
    else if (remaining > 0) issues.push({ taskId: task.id, kind: "unscheduled", minutesLeft: remaining });
  }
  for (const block of fixed) {
    const parts = blocks.filter((item) => item.taskId === block.taskId).length;
    block.parts = Math.max(block.parts, parts);
  }
  return { blocks, issues, days, cost: totalCost, late };
}

type CostContext = {
  candidate: Candidate;
  day: DaySlots;
  start: number;
  length: number;
  available: number;
  remaining: number;
  dayStart: number;
  peak: Interval | null;
  previous: readonly PlannedBlock[];
  settings: PlanningSettings;
  /** Deep-work minutes still to place: the more there is, the more the peak is kept for it. */
  deepLeft: number;
};

/** Lower is better. Units are roughly "hours of delay". */
export function slotCost({ candidate, day, start, length, available, remaining, dayStart, peak, previous, settings, deepLeft }: CostContext): number {
  const { deadline, estimate, urgency, weight } = candidate;
  const end = start + length;
  // Earliness: a working day is worth 8 hours; urgent and heavy tasks feel delay more.
  const delay = day.index * 8 + Math.max(0, start - dayStart) / 60;
  let cost = delay * (0.5 + 0.5 * urgency) * (0.75 + weight / 16);
  // Fit: splitting and leaving crumbs waste focus.
  // Splitting a short task hurts more than splitting a long one.
  if (length < remaining) cost += 4 + 180 / remaining;
  const leftover = available - length;
  if (leftover > 0 && leftover < settings.minBlockMinutes) cost += 1.5;
  else if (remaining <= 30 && leftover >= settings.minBlockMinutes) cost += Math.min(3, leftover / 60) * 0.8;
  // Energy: deep work in the peak window, keep the peak free of light work.
  if (peak) {
    const overlap = Math.max(0, Math.min(end, peak.end) - Math.max(start, peak.start));
    const inPeak = overlap >= length / 2;
    if (estimate.energy === "deep") cost += inPeak ? -3 : 1;
    else if (inPeak) cost += 1 + Math.min(4, deepLeft / 45);
  }
  // Stability: keep yesterday's slot when it is still free.
  if (previous.some((block) => block.date === day.date && block.start === start)) cost -= 8;
  else if (previous.some((block) => block.date === day.date)) cost -= 2;
  // The day the user picked.
  if (candidate.preferredDate === day.date) cost -= 12;
  // Missing a deadline is the last resort.
  if (deadline && (day.date > deadline.date || (day.date === deadline.date && end > deadline.minute))) cost += 500 + Math.max(0, daysBetween(deadline.date, day.date)) * 50;
  return cost;
}

/* ── Entry point ──────────────────────────────────────────────────────── */

export function planTimeBlocks(input: PlanInput): PlanResult {
  const { settings, now } = input;
  const today = dateKeyOf(now);
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const horizonEnd = addDaysToKey(today, settings.horizonDays - 1);
  const estimates = new Map<string, TaskEstimate>();
  const tasks = planningCandidates(input.tasks);
  const ids = new Set(tasks.map((task) => task.id));

  // The user's own times are fixed, and so is the block in progress.
  const fixed: PlannedBlock[] = [];
  const fixedMinutes = new Map<string, number>();
  const pinned = new Set<string>();
  for (const task of tasks) {
    const estimate = resolveEstimate(task, settings, input.aiEstimates?.get(task.id));
    estimates.set(task.id, estimate);
    const start = clockToMinutes(task.scheduledTime ?? null);
    if (!validDateKey(task.scheduledDate) || start === null) continue;
    const date = task.scheduledDate.slice(0, 10);
    if (date < today || (date === today && start + estimate.minutes <= nowMinutes)) continue; // in the past: plan again
    pinned.add(task.id);
    if (date > horizonEnd) continue;
    const end = Math.min(DAY, start + estimate.minutes);
    fixed.push({ id: `${task.id}:${date}:${start}`, taskId: task.id, date, start, end, part: 1, parts: 1, fixed: true, energy: estimate.energy, late: false });
    fixedMinutes.set(task.id, end - start);
  }
  for (const block of input.previous ?? []) {
    if (block.fixed || block.date !== today || block.start > nowMinutes || block.end <= nowMinutes) continue;
    if (!ids.has(block.taskId) || pinned.has(block.taskId)) continue;
    fixed.push({ ...block, fixed: true });
    fixedMinutes.set(block.taskId, (fixedMinutes.get(block.taskId) ?? 0) + block.end - block.start);
  }

  const blockers = new Map(tasks.map((task) => [task.id, blockersOf(task, ids)]));
  const rank = (candidate: Candidate) => candidate.weight * candidate.urgency * (candidate.estimate.energy === "deep" ? 1.3 : 1);
  const candidates: Candidate[] = tasks
    .filter((task) => !pinned.has(task.id))
    .map((task) => {
      const estimate = estimates.get(task.id)!;
      const scheduled = validDateKey(task.scheduledDate) ? task.scheduledDate.slice(0, 10) : null;
      return {
        task,
        estimate,
        weight: taskWeight(task, estimate),
        urgency: urgencyOf(task, today),
        deadline: deadlineOf(task),
        release: scheduled && scheduled > today ? scheduled : today,
        preferredDate: scheduled && scheduled >= today ? scheduled : null,
        remaining: Math.max(0, estimate.minutes - (fixedMinutes.get(task.id) ?? 0)),
        blockers: blockers.get(task.id) ?? [],
      };
    })
    .filter((candidate) => candidate.remaining > 0 && candidate.release <= horizonEnd)
    // Deep work picks first among comparable tasks: it needs the long, fresh blocks.
    .sort((left, right) => rank(right) - rank(left)
      || (left.deadline?.date ?? "9999").localeCompare(right.deadline?.date ?? "9999")
      || left.task.createdAt.localeCompare(right.task.createdAt))
    .slice(0, MAX_TASKS);

  let order = withDependencies(candidates.map((candidate) => candidate.task), blockers);
  const byId = new Map(candidates.map((candidate) => [candidate.task.id, candidate]));
  const run = (sequence: readonly Task[]) => place(sequence.map((task) => byId.get(task.id)!), input, today, nowMinutes, fixed.map((block) => ({ ...block })));
  let best = run(order);
  // Repair: tasks that miss a future deadline go first, and the plan is rebuilt.
  for (let round = 0; round < REPAIR_ROUNDS && best.late.size > 0; round += 1) {
    const promote = order.filter((task) => best.late.has(task.id) && byId.get(task.id)!.deadline!.date >= today);
    if (!promote.length) break;
    const promoted = new Set(promote.map((task) => task.id));
    order = withDependencies([...promote, ...order.filter((task) => !promoted.has(task.id))], blockers);
    const attempt = run(order);
    if (attempt.late.size < best.late.size || (attempt.late.size === best.late.size && attempt.cost < best.cost)) best = attempt;
    else break;
  }

  const blocks = best.blocks.sort((left, right) => left.date.localeCompare(right.date) || left.start - right.start);
  const planned = new Map<string, number>();
  for (const block of blocks) planned.set(block.date, (planned.get(block.date) ?? 0) + block.end - block.start);
  const capacityDays = buildDays(input, today, nowMinutes, []);
  return {
    blocks,
    issues: best.issues,
    days: capacityDays.map((day) => ({ date: day.date, capacity: day.capacity, planned: planned.get(day.date) ?? 0 })),
    estimates,
  };
}
