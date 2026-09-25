import { describe, expect, it } from "vitest";
import type { Task } from "../types";
import type { CalendarEvent } from "./calendar";
import { parseTodayRecommendation, todayRecommendationInput } from "./todayRecommendations";

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
