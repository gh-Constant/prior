import { describe, expect, it } from "vitest";
import type { Task } from "../types";
import type { CalendarEvent } from "./calendar";
import { freshRecommendation, parseTodayRecommendation, RECOMMENDATION_MIN_INTERVAL_MS, recommendationFingerprint, shouldRegenerate, todayRecommendationInput } from "./todayRecommendations";

const tasks = [
  { id: "focus", title: "Ship release", status: "in_progress", completed: false, deletedAt: null, priority: 1, important: true, urgent: true, dueDate: "2026-09-25" },
  { id: "waiting", title: "Wait for review", status: "waiting", completed: false, deletedAt: null, priority: 2 },
] as Task[];

describe("Today recommendations", () => {
  it("only accepts distinct, actionable tasks from the supplied plan", () => {
    const raw = `\`\`\`json\n${JSON.stringify({ summary: "Finish the release before lunch.", focus: [
      { taskId: "focus", reason: "It is due today and already in progress.", suggestedStart: "10:30" },
      { taskId: "focus", reason: "Duplicate" },
      { taskId: "waiting", reason: "Blocked" },
      { taskId: "invented", reason: "Hallucinated" },
    ], tips: ["Reserve the next free hour for the release."] })}\n\`\`\``;
    expect(parseTodayRecommendation(raw, tasks)).toEqual({
      summary: "Finish the release before lunch.",
      focus: [{ taskId: "focus", reason: "It is due today and already in progress.", suggestedStart: "10:30" }],
      tips: ["Reserve the next free hour for the release."],
    });
  });

  it("bounds the prompt to current work and calendar data", () => {
    const input = JSON.parse(todayRecommendationInput(tasks, [{ id: "e", sourceId: "c", title: "Meeting", date: "2026-09-25", startTime: "11:00", endTime: "11:30", color: "blue", kind: "event" }], new Date("2026-09-25T09:00:00Z"), "en"));
    expect(input.tasks).toHaveLength(2);
    expect(input.calendar[0]).toMatchObject({ title: "Meeting", startTime: "11:00" });
    expect(input.nextFreeFocusSlot).toMatchObject({ start: expect.any(String), end: expect.any(String) });
  });

  it("rejects a start that is past or conflicts with today's calendar", () => {
    const events = [{ id: "e", sourceId: "c", title: "Meeting", date: "2026-09-25", startTime: "11:00", endTime: "11:30", color: "blue", kind: "event" }] as CalendarEvent[];
    const raw = JSON.stringify({ focus: [{ taskId: "focus", reason: "Due today", suggestedStart: "11:00" }] });
    expect(parseTodayRecommendation(raw, tasks, { now: new Date(2026, 8, 25, 10, 0), events }).focus[0].suggestedStart).toBeNull();
  });
});

describe("recommendation caching", () => {
  const task = { id: "t1", title: "Write report", description: "", dueDate: null, priority: 2, completed: false, important: true, urgent: false, status: "next", createdAt: "", updatedAt: "", deletedAt: null } as Task;
  const morning = new Date(2026, 8, 29, 9, 0);

  it("keeps the same fingerprint as time passes and changes it when the plan changes", () => {
    const base = recommendationFingerprint([task], [], morning, "fr", "m");
    expect(recommendationFingerprint([task], [], new Date(2026, 8, 29, 16, 0), "fr", "m")).toBe(base);
    expect(recommendationFingerprint([{ ...task, updatedAt: "later" }], [], morning, "fr", "m")).toBe(base);
    expect(recommendationFingerprint([{ ...task, priority: 1 }], [], morning, "fr", "m")).not.toBe(base);
    expect(recommendationFingerprint([{ ...task, completed: true }], [], morning, "fr", "m")).not.toBe(base);
    expect(recommendationFingerprint([task], [], new Date(2026, 8, 30, 9, 0), "fr", "m")).not.toBe(base);
    expect(recommendationFingerprint([task], [], morning, "en", "m")).not.toBe(base);
  });

  it("regenerates only when needed", () => {
    const cached = { fingerprint: "a", day: "2026-09-29", at: morning.getTime(), value: { summary: "", focus: [], tips: [] } };
    expect(shouldRegenerate(null, "a", morning, false)).toBe(true);
    expect(shouldRegenerate(cached, "a", new Date(2026, 8, 29, 18, 0), false)).toBe(false);
    expect(shouldRegenerate(cached, "b", new Date(morning.getTime() + 60_000), false)).toBe(false);
    expect(shouldRegenerate(cached, "b", new Date(morning.getTime() + RECOMMENDATION_MIN_INTERVAL_MS), false)).toBe(true);
    expect(shouldRegenerate(cached, "b", new Date(2026, 8, 30, 8, 0), false)).toBe(true);
    expect(shouldRegenerate(cached, "a", morning, true)).toBe(true);
  });

  it("drops finished tasks and past start times from a cached result", () => {
    const value = { summary: "s", tips: [], focus: [{ taskId: "t1", reason: "r", suggestedStart: "10:00" }, { taskId: "gone", reason: "r", suggestedStart: null }] };
    expect(freshRecommendation(value, [task], morning).focus).toEqual([{ taskId: "t1", reason: "r", suggestedStart: "10:00" }]);
    expect(freshRecommendation(value, [task], new Date(2026, 8, 29, 11, 0)).focus[0].suggestedStart).toBeNull();
  });
});
