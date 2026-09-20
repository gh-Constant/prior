import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { memoryStorage } from "../test/memoryStorage";
import { claimAnonymousStorageForAccount, scopedStorageKey } from "./accountScope";
import { createLocalCalendar, deleteLocalEvent, expandCalendarEvent, matchesHiddenTitle, presentImportedEvent, saveLocalEvent, validateCalendarEvent } from "./calendarEvents";
import { dateKey, eventsInRange, loadCalendarState, parseDateKey, saveCalendarState, type CalendarEvent, type CalendarState } from "./calendar";

const event: CalendarEvent = { id: "event", sourceId: "personal", title: "Yoga", kind: "event", date: "2026-09-21", endDate: "2026-09-21", startTime: "10:00", endTime: "11:00", color: "#6e73d9" };
function state(): CalendarState { return { sources: [{ ...createLocalCalendar("Personal"), id: "personal", events: [event] }, { ...createLocalCalendar("Work"), id: "work" }], showHabits: false }; }
function dates(value: CalendarEvent, from = "2026-09-01", to = "2027-01-31") { return expandCalendarEvent(value, parseDateKey(from), parseDateKey(to)).map((item) => item.date); }

describe("personal calendar behavior", () => {
  beforeEach(() => vi.stubGlobal("localStorage", memoryStorage()));
  afterEach(() => vi.unstubAllGlobals());
  it("persists personal calendars, recurrence, locks, colors and account-specific preferences", () => {
    const value = state(); value.sources[0].events[0] = { ...event, locked: true, recurrence: { frequency: "weekly", interval: 2, weekdays: [1, 3] } };
    saveCalendarState(value);
    expect(loadCalendarState()).toMatchObject(value);
    localStorage.setItem("prior.session.user", JSON.stringify({ id: "other-user" }));
    expect(loadCalendarState().sources.find((source) => source.id === "personal")).toBeUndefined();
    localStorage.removeItem("prior.session.user");
    expect(loadCalendarState()).toMatchObject(value);
  });
  it("validates dates, overnight events and repetition constraints", () => {
    expect(validateCalendarEvent({ ...event, date: "2026-02-30" })).toBe("invalidDate");
    expect(validateCalendarEvent({ ...event, endTime: "09:00" })).toBe("invalidEnd");
    expect(validateCalendarEvent({ ...event, endDate: "2026-09-22", endTime: "02:00" })).toBeNull();
    expect(validateCalendarEvent({ ...event, recurrence: { frequency: "weekly", interval: 1, weekdays: [] } })).toBe("invalidRecurrence");
  });
  it("keeps offline calendars when claiming them into an account with calendars", () => {
    saveCalendarState(state());
    localStorage.setItem("prior.session.user", JSON.stringify({ id: "account" }));
    localStorage.setItem(scopedStorageKey("prior.calendar.v1"), JSON.stringify({ sources: [{ ...createLocalCalendar("Existing"), id: "existing" }], showHabits: false }));
    claimAnonymousStorageForAccount("account");
    expect(loadCalendarState().sources.map((source) => source.id)).toEqual(["personal", "work", "existing"]);
  });
  it("expands alternate weeks with multiple weekdays and an inclusive end date", () => {
    expect(dates({ ...event, recurrence: { frequency: "weekly", interval: 2, weekdays: [1, 3], until: "2026-10-07" } })).toEqual(["2026-09-21", "2026-09-23", "2026-10-05", "2026-10-07"]);
  });
  it("counts occurrences before the visible range and before excluded dates", () => {
    expect(dates({ ...event, excludedDates: ["2026-09-22"], recurrence: { frequency: "daily", interval: 1, count: 3 } }, "2026-09-22")).toEqual(["2026-09-23"]);
  });
  it("skips invalid monthly and leap-year dates", () => {
    expect(dates({ ...event, date: "2026-01-31", endDate: "2026-01-31", recurrence: { frequency: "monthly", interval: 1, count: 3 } }, "2026-01-01", "2026-06-30")).toEqual(["2026-01-31", "2026-03-31", "2026-05-31"]);
    expect(dates({ ...event, date: "2024-02-29", endDate: "2024-02-29", recurrence: { frequency: "yearly", interval: 1, count: 2 } }, "2024-01-01", "2030-01-01")).toEqual(["2024-02-29", "2028-02-29"]);
  });
  it("keeps local wall-clock time across DST", () => {
    const occurrences = expandCalendarEvent({ ...event, date: "2026-10-23", endDate: "2026-10-23", recurrence: { frequency: "daily", interval: 1, count: 5 } }, parseDateKey("2026-10-23"), parseDateKey("2026-10-28"));
    expect(occurrences).toHaveLength(5);
    expect(occurrences.every((item) => item.startTime === "10:00")).toBe(true);
  });
  it("splits overnight events and does not display a midnight end on the next day", () => {
    const overnight = { ...event, startTime: "23:00", endTime: "02:00", endDate: "2026-09-22" };
    const segments = expandCalendarEvent(overnight, parseDateKey("2026-09-21"), parseDateKey("2026-09-22"));
    expect(segments.map((item) => [item.date, item.startTime, item.endTime])).toEqual([["2026-09-21", "23:00", "23:59"], ["2026-09-22", "00:00", "02:00"]]);
    expect(dates({ ...overnight, endTime: "00:00" })).toEqual(["2026-09-21"]);
  });
  it("shows spanning all-day events when they started before the visible range", () => {
    expect(dates({ ...event, startTime: null, endTime: null, endDate: "2026-09-25" }, "2026-09-23", "2026-09-24")).toEqual(["2026-09-23", "2026-09-24"]);
  });
  it("moves an edited event between personal calendars without duplication", () => {
    const next = saveLocalEvent(state(), { ...event, title: "Edited", sourceId: "work" }, event);
    expect(next.sources[0].events).toHaveLength(0);
    expect(next.sources[1].events).toEqual([expect.objectContaining({ title: "Edited", sourceId: "work" })]);
  });
  it("edits one occurrence while retaining the other occurrences", () => {
    const original = { ...event, recurrence: { frequency: "daily" as const, interval: 1, count: 3 } };
    const value = state(); value.sources[0].events = [original];
    const occurrence = eventsInRange(value, [], parseDateKey("2026-09-22"), parseDateKey("2026-09-22"))[0];
    const next = saveLocalEvent(value, { ...occurrence, title: "Moved", date: "2026-09-24", endDate: "2026-09-24" }, occurrence, "occurrence");
    expect(eventsInRange(next, [], parseDateKey("2026-09-21"), parseDateKey("2026-09-25")).map((item) => [item.date, item.title])).toEqual([["2026-09-21", "Yoga"], ["2026-09-23", "Yoga"], ["2026-09-24", "Moved"]]);
    expect(value.sources[0].events[0].excludedDates).toBeUndefined();
  });
  it("deletes one occurrence or an entire series", () => {
    const value = state(); value.sources[0].events = [{ ...event, recurrence: { frequency: "daily", interval: 1, count: 3 } }];
    const occurrence = eventsInRange(value, [], parseDateKey(event.date), parseDateKey(event.date))[0];
    expect(eventsInRange(deleteLocalEvent(value, occurrence, "occurrence"), [], parseDateKey(event.date), parseDateKey("2026-09-30"))).toHaveLength(2);
    expect(deleteLocalEvent(value, occurrence, "series").sources[0].events).toHaveLength(0);
  });
  it("rejects writes to imported sources", () => {
    const value = state(); value.sources[0].type = "ics";
    expect(() => saveLocalEvent(value, event)).toThrow("readOnly");
    expect(deleteLocalEvent(value, event, "series")).toEqual(value);
  });
  it("hides matches without accents/case and keeps preferences through refresh", () => {
    const source = { ...state().sources[0], type: "ics" as const, hiddenTitles: ["sae"] };
    expect(matchesHiddenTitle("Projet SAÉ groupe 2", "sae")).toBe(true);
    expect(matchesHiddenTitle("Anything", "  ")).toBe(false);
    expect(presentImportedEvent(source, { ...event, title: "Projet SAÉ groupe 2" })).toBeNull();
    expect(presentImportedEvent({ ...source, eventOverrides: { event: { locked: true, color: "#ff0000" } } }, { ...event, title: "Updated" })).toMatchObject({ locked: true, color: "#ff0000", title: "Updated" });
    expect(event.color).toBe("#6e73d9");
  });
  it("applies source colors and event overrides without changing stored events", () => {
    const source = { ...state().sources[0], color: "#123456" };
    expect(presentImportedEvent(source, event)?.color).toBe("#123456");
    expect(presentImportedEvent(source, { ...event, customColor: "#abcdef" })?.color).toBe("#abcdef");
    expect(dateKey(parseDateKey(event.date))).toBe(event.date);
  });
  it("expands a cached ICS series when navigating beyond its initial import window", () => {
    const value = state();
    value.sources[0] = { ...value.sources[0], type: "ics", events: [], icsData: "BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:future\r\nSUMMARY:Course\r\nDTSTART:20260921T100000\r\nDTEND:20260921T110000\r\nRRULE:FREQ=YEARLY\r\nEND:VEVENT\r\nEND:VCALENDAR" };
    expect(eventsInRange(value, [], parseDateKey("2036-09-21"), parseDateKey("2036-09-21"))).toEqual([expect.objectContaining({ date: "2036-09-21", title: "Course" })]);
  });
  it("applies a calendar lock even when an individual event is unlocked", () => {
    expect(presentImportedEvent({ ...state().sources[0], locked: true }, { ...event, locked: false })?.locked).toBe(true);
  });
});
