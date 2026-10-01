import { describe, expect, it } from "vitest";
import type { Task } from "../types";
import { DEFAULT_PLANNING_SETTINGS, guessEstimate, normalizePlanningSettings, planTimeBlocks, resolveEstimate, type BusyBlock, type PlanningSettings } from "./timeBlocking";

// Thursday 1 October 2026, 08:00 local time.
const NOW = new Date(2026, 9, 1, 8, 0);
const settings: PlanningSettings = { ...DEFAULT_PLANNING_SETTINGS, useAI: false };

let counter = 0;
function task(patch: Partial<Task> = {}): Task {
  counter += 1;
  return {
    id: patch.id ?? `t${counter}`,
    title: `Task ${counter}`,
    description: "",
    dueDate: null,
    priority: 4,
    status: "next",
    completed: false,
    important: false,
    urgent: false,
    createdAt: `2026-09-${String(counter % 28 + 1).padStart(2, "0")}T10:00:00.000Z`,
    updatedAt: "2026-09-30T10:00:00.000Z",
    deletedAt: null,
    ...patch,
  };
}

const clock = (value: number) => `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;

describe("time blocking", () => {
  it("places tasks in working hours, around meetings with a buffer and the lunch break", () => {
    const busy: BusyBlock[] = [{ date: "2026-10-01", start: 10 * 60, end: 11 * 60, buffer: true }];
    const plan = planTimeBlocks({ tasks: [task({ id: "a", estimatedMinutes: 60, priority: 1 })], busy, now: NOW, settings });
    const block = plan.blocks.find((item) => item.taskId === "a")!;
    expect(block.date).toBe("2026-10-01");
    // 09:00-09:50 is too short for one hour (10 min buffer); 11:10-12:00 also; next is after lunch.
    expect([clock(block.start), clock(block.end)]).toEqual(["13:00", "14:00"]);
    expect(plan.issues).toEqual([]);
  });

  it("never plans in the past, on weekends or beyond the daily limit", () => {
    const now = new Date(2026, 9, 2, 16, 30); // Friday 16:30
    const tasks = [task({ id: "big", estimatedMinutes: 240, priority: 1 })];
    const plan = planTimeBlocks({ tasks, busy: [], now, settings: { ...settings, dailyFocusMinutes: 120 } });
    for (const block of plan.blocks) {
      expect(["2026-10-03", "2026-10-04"]).not.toContain(block.date);
      if (block.date === "2026-10-02") expect(block.start).toBeGreaterThanOrEqual(16 * 60 + 35);
    }
    const perDay = new Map<string, number>();
    for (const block of plan.blocks) perDay.set(block.date, (perDay.get(block.date) ?? 0) + block.end - block.start);
    for (const minutes of perDay.values()) expect(minutes).toBeLessThanOrEqual(120);
    expect(plan.blocks.reduce((total, block) => total + block.end - block.start, 0)).toBe(240);
  });

  it("splits long tasks into blocks between the min and max length", () => {
    const plan = planTimeBlocks({ tasks: [task({ id: "long", estimatedMinutes: 200, priority: 1 })], busy: [], now: NOW, settings });
    const blocks = plan.blocks.filter((block) => block.taskId === "long");
    expect(blocks.length).toBeGreaterThan(1);
    for (const block of blocks) expect(block.end - block.start).toBeLessThanOrEqual(settings.maxBlockMinutes + 15);
    expect(blocks.map((block) => block.part)).toEqual(blocks.map((_, index) => index + 1));
    expect(blocks.every((block) => block.parts === blocks.length)).toBe(true);
  });

  it("puts urgent work first and keeps deadlines", () => {
    const later = task({ id: "later", estimatedMinutes: 120, priority: 2 });
    const due = task({ id: "due", estimatedMinutes: 120, priority: 4, dueDate: "2026-10-01" });
    const plan = planTimeBlocks({ tasks: [later, due], busy: [], now: NOW, settings });
    const dueBlocks = plan.blocks.filter((block) => block.taskId === "due");
    expect(dueBlocks.every((block) => block.date === "2026-10-01" && !block.late)).toBe(true);
    expect(plan.issues.find((issue) => issue.taskId === "due")).toBeUndefined();
  });

  it("repairs the order so a deadline that fits is not missed", () => {
    // Today has 3 h free; a high-priority task without deadline would take it all.
    const busy: BusyBlock[] = [{ date: "2026-10-01", start: 9 * 60, end: 14 * 60 }];
    const important = task({ id: "important", estimatedMinutes: 180, priority: 1, important: true, urgent: true, status: "in_progress" });
    const due = task({ id: "due", estimatedMinutes: 120, priority: 4, dueDate: "2026-10-01", dueTime: "17:00" });
    const plan = planTimeBlocks({ tasks: [important, due], busy, now: NOW, settings });
    expect(plan.blocks.filter((block) => block.taskId === "due").every((block) => block.date === "2026-10-01" && block.end <= 17 * 60)).toBe(true);
    expect(plan.issues.filter((issue) => issue.kind === "late")).toEqual([]);
  });

  it("reports a deadline that cannot be met", () => {
    const busy: BusyBlock[] = [{ date: "2026-10-01", start: 9 * 60, end: 17 * 60 }];
    const plan = planTimeBlocks({ tasks: [task({ id: "due", estimatedMinutes: 180, dueDate: "2026-10-01" })], busy, now: NOW, settings });
    expect(plan.issues).toEqual([{ taskId: "due", kind: "late", minutesLeft: expect.any(Number) }]);
  });

  it("keeps the user's own time and plans around it", () => {
    const pinned = task({ id: "pinned", scheduledDate: "2026-10-01", scheduledTime: "09:00", estimatedMinutes: 60 });
    const other = task({ id: "other", estimatedMinutes: 60, priority: 1 });
    const plan = planTimeBlocks({ tasks: [pinned, other], busy: [], now: NOW, settings });
    expect(plan.blocks.find((block) => block.taskId === "pinned")).toMatchObject({ fixed: true, start: 9 * 60, end: 10 * 60 });
    const block = plan.blocks.find((item) => item.taskId === "other")!;
    expect(block.start >= 10 * 60 + settings.breakMinutes || block.date !== "2026-10-01").toBe(true);
  });

  it("waits for a later scheduled day and for blockers", () => {
    const blocker = task({ id: "blocker", estimatedMinutes: 60, priority: 3 });
    const blocked = task({ id: "blocked", estimatedMinutes: 30, priority: 1, relations: [{ type: "blocked_by", taskId: "blocker" }] });
    const monday = task({ id: "monday", estimatedMinutes: 30, priority: 1, scheduledDate: "2026-10-05" });
    const plan = planTimeBlocks({ tasks: [blocked, blocker, monday], busy: [], now: NOW, settings });
    const end = plan.blocks.find((block) => block.taskId === "blocker")!;
    const start = plan.blocks.find((block) => block.taskId === "blocked")!;
    expect(`${start.date} ${clock(start.start)}` >= `${end.date} ${clock(end.end)}`).toBe(true);
    expect(plan.blocks.find((block) => block.taskId === "monday")!.date).toBe("2026-10-05");
  });

  it("gives the peak window to deep work and keeps short tasks out of it", () => {
    const busy: BusyBlock[] = [{ date: "2026-10-01", start: 10 * 60 + 30, end: 12 * 60 }];
    const quick = task({ id: "quick", title: "Call the bank", estimatedMinutes: 30, priority: 3 });
    const deep = task({ id: "deep", title: "Write the quarterly report", estimatedMinutes: 80, priority: 3 });
    const plan = planTimeBlocks({ tasks: [quick, deep], busy, now: NOW, settings });
    expect(plan.blocks.find((block) => block.taskId === "deep")).toMatchObject({ date: "2026-10-01", start: 9 * 60, energy: "deep" });
    expect(plan.blocks.find((block) => block.taskId === "quick")!.start).toBeGreaterThanOrEqual(13 * 60);
  });

  it("fills small gaps with short tasks and keeps long gaps whole", () => {
    // Free: 13:00-13:50 (meeting at 14:00 with buffer) and 15:40-18:00.
    const busy: BusyBlock[] = [{ date: "2026-10-01", start: 9 * 60, end: 12 * 60 }, { date: "2026-10-01", start: 14 * 60, end: 15 * 60 + 30, buffer: true }];
    const quick = task({ id: "quick", title: "Reply to Anna", estimatedMinutes: 20, priority: 3 });
    const plan = planTimeBlocks({ tasks: [quick], busy, now: NOW, settings: { ...settings, peak: "none" } });
    expect(plan.blocks[0]).toMatchObject({ start: 13 * 60, end: 13 * 60 + 20 });
  });

  it("skips waiting tasks, parents of open sub-tasks and untriaged inbox items", () => {
    const tasks = [
      task({ id: "waiting", status: "waiting" }),
      task({ id: "parent" }),
      task({ id: "child", parentId: "parent" }),
      task({ id: "inbox", status: "inbox" }),
      task({ id: "inbox-due", status: "inbox", dueDate: "2026-10-02" }),
      task({ id: "done", completed: true }),
    ];
    const ids = new Set(planTimeBlocks({ tasks, busy: [], now: NOW, settings }).blocks.map((block) => block.taskId));
    expect([...ids].sort()).toEqual(["child", "inbox-due"]);
  });

  it("keeps the previous slot when it is still free", () => {
    const tasks = [task({ id: "a", estimatedMinutes: 30 }), task({ id: "b", estimatedMinutes: 30 })];
    const first = planTimeBlocks({ tasks, busy: [], now: NOW, settings });
    const moved = first.blocks.map((block) => block.taskId === "a" ? { ...block, start: 15 * 60, end: 15 * 60 + 30 } : block);
    const second = planTimeBlocks({ tasks, busy: [], now: NOW, settings, previous: moved });
    expect(second.blocks.find((block) => block.taskId === "a")!.start).toBe(15 * 60);
  });

  it("keeps the block in progress", () => {
    const now = new Date(2026, 9, 1, 10, 15);
    const tasks = [task({ id: "a", estimatedMinutes: 60 })];
    const previous = [{ id: "x", taskId: "a", date: "2026-10-01", start: 10 * 60, end: 11 * 60, part: 1, parts: 1, fixed: false, energy: "light" as const, late: false }];
    const plan = planTimeBlocks({ tasks, busy: [], now, settings, previous });
    expect(plan.blocks).toHaveLength(1);
    expect(plan.blocks[0]).toMatchObject({ start: 10 * 60, end: 11 * 60, fixed: true });
  });
});

describe("estimates", () => {
  it("guesses from keywords and checklists in several languages", () => {
    expect(guessEstimate({ title: "Appeler le dentiste", description: "" }, settings)).toEqual({ minutes: 15, energy: "light" });
    expect(guessEstimate({ title: "Rédiger le rapport", description: "" }, settings)).toEqual({ minutes: 60, energy: "deep" });
    const checklist = Array.from({ length: 6 }, (_, index) => ({ id: String(index), title: "Step", done: false, position: index }));
    expect(guessEstimate({ title: "Move flat", description: "", checklist }, settings).minutes).toBe(90);
  });

  it("prefers the user's estimate, then AI, and shrinks it with checklist progress", () => {
    const checklist = [{ id: "1", title: "a", done: true, position: 0 }, { id: "2", title: "b", done: false, position: 1 }];
    expect(resolveEstimate(task({ estimatedMinutes: 120, checklist }), settings, { minutes: 30, energy: "light" })).toMatchObject({ minutes: 60, source: "user", energy: "light" });
    expect(resolveEstimate(task({ title: "Something" }), settings, { minutes: 45, energy: "deep", value: 3 })).toMatchObject({ minutes: 45, source: "ai", energy: "deep", value: 3 });
  });

  it("normalizes settings", () => {
    expect(normalizePlanningSettings({ dayStart: "18:00", dayEnd: "09:00", lunchStart: "13:00", lunchEnd: "12:00", maxBlockMinutes: 10, minBlockMinutes: 40, workDays: [1, 9, 1] })).toMatchObject({ dayStart: "18:00", dayEnd: "19:00", lunchStart: null, lunchEnd: null, minBlockMinutes: 40, maxBlockMinutes: 40, workDays: [1] });
  });
});
