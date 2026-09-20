import { describe, expect, it } from "vitest";
import { parseIcsCalendar } from "./calendarIcs";

const parse = (lines: string[]) => parseIcsCalendar(["BEGIN:VCALENDAR", "VERSION:2.0", ...lines, "END:VCALENDAR"].join("\r\n"), "iut", "#123456", new Date(2026, 8, 21));
describe("ICS recurrence and date semantics", () => {
  it("expands weekly recurrences, exclusions and modified instances", () => {
    const events = parse([
      "BEGIN:VEVENT", "UID:course", "SUMMARY:SAE", "DTSTART:20260921T100000", "DTEND:20260921T110000", "RRULE:FREQ=WEEKLY;COUNT=4", "EXDATE:20260928T100000", "END:VEVENT",
      "BEGIN:VEVENT", "UID:course", "RECURRENCE-ID:20261005T100000", "DTSTART:20261005T140000", "DTEND:20261005T150000", "SUMMARY:SAE moved", "END:VEVENT",
    ]);
    expect(events.map((event) => [event.date, event.startTime, event.title])).toEqual([["2026-09-21", "10:00", "SAE"], ["2026-10-05", "14:00", "SAE moved"], ["2026-10-12", "10:00", "SAE"]]);
    expect(new Set(events.map((event) => event.id)).size).toBe(3);
  });
  it("keeps an imported occurrence ID stable when its time changes", () => {
    const base = ["BEGIN:VEVENT", "UID:stable", "SUMMARY:Course", "DTSTART:20260921T100000", "DTEND:20260921T110000", "RRULE:FREQ=WEEKLY;COUNT=1", "END:VEVENT"];
    const original = parse(base)[0];
    const moved = parse([...base, "BEGIN:VEVENT", "UID:stable", "RECURRENCE-ID:20260921T100000", "SUMMARY:Course", "DTSTART:20260921T140000", "DTEND:20260921T150000", "END:VEVENT"])[0];
    expect(moved.id).toBe(original.id);
  });
  it("uses exclusive ICS all-day end dates and preserves descriptions", () => {
    expect(parse(["BEGIN:VEVENT", "UID:trip", "SUMMARY:Trip", "DESCRIPTION:Line one\\nLine two", "DTSTART;VALUE=DATE:20260921", "DTEND;VALUE=DATE:20260924", "END:VEVENT"])[0]).toMatchObject({ date: "2026-09-21", endDate: "2026-09-23", description: "Line one\nLine two", startTime: null, endTime: null });
  });
  it("resolves IANA time zones without embedded VTIMEZONE", () => {
    const event = parse(["BEGIN:VEVENT", "UID:paris", "SUMMARY:Paris", "DTSTART;TZID=Europe/Paris:20260921T100000", "DTEND;TZID=Europe/Paris:20260921T110000", "END:VEVENT"])[0];
    const expected = new Date("2026-09-21T08:00:00Z");
    expect(event.startTime).toBe(`${String(expected.getHours()).padStart(2, "0")}:${String(expected.getMinutes()).padStart(2, "0")}`);
  });
  it("ignores cancelled events", () => {
    expect(parse(["BEGIN:VEVENT", "UID:cancelled", "SUMMARY:No class", "DTSTART:20260921T100000", "DTEND:20260921T110000", "STATUS:CANCELLED", "END:VEVENT"])).toEqual([]);
  });
  it("accepts cancellation exceptions without DTSTART and keeps later occurrences", () => {
    const events = parse([
      "BEGIN:VEVENT", "UID:course", "SUMMARY:Course", "DTSTART:20260921T100000", "DTEND:20260921T110000", "RRULE:FREQ=WEEKLY;COUNT=3", "END:VEVENT",
      "BEGIN:VEVENT", "UID:course", "RECURRENCE-ID:20260928T100000", "STATUS:CANCELLED", "END:VEVENT",
    ]);
    expect(events.map((event) => event.date)).toEqual(["2026-09-21", "2026-10-05"]);
  });
});
