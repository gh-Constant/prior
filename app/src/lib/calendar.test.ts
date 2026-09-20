import type { Habit } from "../types";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildHabitCalendarEvents,
  createGoogleCalendarSource,
  createIcsUrlSource,
  createDemoCalendarState,
  eventsInRange,
  fetchIcsCalendar,
  isCalendarSourceDue,
  mondayOf,
  parseIcsCalendar,
  positionOverlappingEvents,
} from "./calendar";

function makeHabit(overrides: Partial<Habit> = {}): Habit {
  return {
    id: "habit-1",
    title: "Morning pages",
    important: false,
    urgent: false,
    interval: 1,
    unit: "day",
    startDate: "2026-09-14",
    timeOfDay: null,
    completedDates: [],
    createdAt: "2026-09-14T08:00:00.000Z",
    updatedAt: "2026-09-14T08:00:00.000Z",
    deletedAt: null,
    ...overrides,
  };
}

describe("calendar data", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("seeds multiple demo sources with a deliberate overlap", () => {
    const state = createDemoCalendarState(new Date(2026, 8, 19));
    const monday = mondayOf(new Date(2026, 8, 19));
    const events = eventsInRange(state, [], monday, new Date(2026, 8, 20));
    expect(state.sources).toHaveLength(3);
    expect(events.some((event) => event.title === "Product sync")).toBe(true);
    expect(events.some((event) => event.title === "Design review")).toBe(true);
    expect(positionOverlappingEvents(events.filter((event) => event.date === "2026-09-14" && event.startTime))).toEqual(expect.arrayContaining([
      expect.objectContaining({ title: "Focus block", columns: 3 }),
      expect.objectContaining({ title: "Product sync", columns: 3 }),
      expect.objectContaining({ title: "Design review", columns: 3 }),
    ]));
  });

  it("puts untimed habits in an anytime lane and timed habits into a short block", () => {
    const untimed = buildHabitCalendarEvents([makeHabit()], new Date(2026, 8, 15), new Date(2026, 8, 15));
    const timed = buildHabitCalendarEvents([makeHabit({ id: "habit-2", timeOfDay: "09:30" })], new Date(2026, 8, 15), new Date(2026, 8, 15));
    expect(untimed[0]).toMatchObject({ startTime: null, endTime: null });
    expect(timed[0]).toMatchObject({ startTime: "09:30", endTime: "10:15" });
  });

  it("parses remote ICS events and keeps stable source metadata", () => {
    const source = createIcsUrlSource("IUT INFO", "https://example.test/info.ics", "hourly");
    const events = parseIcsCalendar([
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "BEGIN:VEVENT",
      "UID:course-1",
      "SUMMARY:Algorithmique\\, groupe 1",
      "DTSTART:20260921T080000",
      "DTEND:20260921T100000",
      "LOCATION:Salle A12",
      "END:VEVENT",
      "BEGIN:VEVENT",
      "UID:course-2",
      "SUMMARY:Journée pédagogique",
      "DTSTART;VALUE=DATE:20260922",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n"), source.id, source.color);
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ title: "Algorithmique, groupe 1", date: "2026-09-21", startTime: "08:00", endTime: "10:00", location: "Salle A12", sourceId: source.id }),
      expect.objectContaining({ title: "Journée pédagogique", date: "2026-09-22", startTime: null, endTime: null }),
    ]));
    expect(isCalendarSourceDue({ ...source, lastSyncedAt: new Date(2026, 8, 21, 9, 30).toISOString() }, new Date(2026, 8, 21, 9, 45))).toBe(false);
    expect(isCalendarSourceDue({ ...source, lastSyncedAt: new Date(2026, 8, 21, 8, 0).toISOString() }, new Date(2026, 8, 21, 9, 1))).toBe(true);
  });

  it("loads remote ICS feeds through the authenticated Prior proxy", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => "BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n",
    });
    vi.stubGlobal("fetch", fetchMock);

    await fetchIcsCalendar("https://example.test/calendar.ics", "source-1", "#ef795b", undefined, "session-token");

    const [requestURL, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(requestURL).toContain("/v1/calendar/ics");
    expect(request.method).toBe("POST");
    expect(new Headers(request.headers).get("authorization")).toBe("Bearer session-token");
    expect(JSON.parse(request.body as string)).toEqual({ url: "https://example.test/calendar.ics" });
  });

  it("creates an account-bound Google source and refreshes it hourly", () => {
    const source = createGoogleCalendarSource("account-1", "me@example.com");
    expect(source).toMatchObject({ type: "google", accountId: "account-1", name: "Google Calendar · me@example.com", refreshInterval: "hourly" });
    expect(isCalendarSourceDue(source, new Date(2026, 8, 21, 9, 0))).toBe(true);
    expect(isCalendarSourceDue({ ...source, lastSyncedAt: new Date(2026, 8, 21, 8, 30).toISOString() }, new Date(2026, 8, 21, 9, 0))).toBe(false);
    expect(isCalendarSourceDue({ ...source, lastSyncedAt: new Date(2026, 8, 21, 7, 30).toISOString() }, new Date(2026, 8, 21, 9, 0))).toBe(true);
  });
});
