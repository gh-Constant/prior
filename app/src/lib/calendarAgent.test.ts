import { describe, expect, it } from "vitest";
import { parseCalendarDraft } from "./calendarAgent";
import type { CalendarEvent } from "./calendar";
const base: CalendarEvent = { id: "draft", sourceId: "personal", title: "", date: "2026-09-21", startTime: "10:00", endTime: "11:00", kind: "event", color: "#123456", locked: true };
describe("reviewable AI calendar drafts", () => {
  it("accepts valid drafts while protecting identity, destination and lock", () => {
    const draft = parseCalendarDraft(JSON.stringify({ title: "Yoga", date: "2026-09-22", startTime: "10:00", endTime: "11:00", recurrence: { frequency: "weekly", interval: 1, weekdays: [2] }, sourceId: "google", id: "attacker", locked: false }), base);
    expect(draft).toMatchObject({ id: "draft", sourceId: "personal", locked: true, title: "Yoga", recurrence: { weekdays: [2] } });
  });
  it.each([
    { title: "Bad", date: "2026-02-30", startTime: "10:00", endTime: "11:00" },
    { title: "Bad", date: "2026-09-21", startTime: "12:00", endTime: "11:00" },
    { title: "Bad", date: "2026-09-21", startTime: "10:00", endTime: "11:00", recurrence: { frequency: "weekly", interval: 1, weekdays: "Monday" } },
    { title: "Bad", date: "2026-09-21", startTime: {}, endTime: [] },
  ])("rejects invalid model output", (value) => expect(() => parseCalendarDraft(JSON.stringify(value), base)).toThrow());
});
