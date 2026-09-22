import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CalendarView } from "./CalendarView";
import { dateKey, loadCalendarState, saveCalendarState } from "../lib/calendar";
import { memoryStorage } from "../test/memoryStorage";
vi.mock("../lib/auth", () => ({ getToken: vi.fn(async () => null) }));
vi.mock("../lib/calendarAuth", () => ({ CALENDAR_ACCOUNT_EVENT: "calendar-connected", listCalendarAccounts: vi.fn(async () => []), makeGoogleCalendarTokenGetter: vi.fn(), startGoogleCalendarConnect: vi.fn() }));
vi.mock("../lib/calendarAgent", () => ({ draftCalendarEvent: vi.fn() }));
describe("calendar local integration", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", memoryStorage()); localStorage.setItem("prior.language", "en");
    saveCalendarState({ sources: [], showHabits: false });
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
  it("creates a first calendar, creates an event, then reloads both", async () => {
    const view = render(<CalendarView habits={[]} />);
    fireEvent.click(screen.getByRole("button", { name: "New event" }));
    let dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "My courses" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Title"), { target: { value: "My first event" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(loadCalendarState().sources[0]).toMatchObject({ name: "My courses", type: "local", events: [expect.objectContaining({ title: "My first event" })] });
    view.unmount(); render(<CalendarView habits={[]} />);
    // Sources are listed in the calendar rail next to the grid.
    expect(screen.getByText("My courses")).toBeTruthy();
    expect(screen.getByRole("button", { name: /My first event/ })).toBeTruthy();
  });
  it("lists calendars in the rail, toggles them and the habits overlay inline", () => {
    saveCalendarState({ sources: [{ id: "personal", name: "Personal", type: "local", events: [], color: "#123456", enabled: true }], showHabits: true });
    render(<CalendarView habits={[]} />);
    const railToggle = screen.getByRole("button", { name: "Your calendars" });
    expect(railToggle.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(railToggle);
    expect(railToggle.getAttribute("aria-expanded")).toBe("true");
    const source = screen.getByRole("button", { name: /Personal/, pressed: true });
    fireEvent.click(source);
    expect(source.getAttribute("aria-pressed")).toBe("false");
    expect(loadCalendarState().sources[0].enabled).toBe(false);
    const habitsSwitch = screen.getByRole("switch", { name: "Habits" });
    expect(habitsSwitch.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(habitsSwitch);
    expect(habitsSwitch.getAttribute("aria-checked")).toBe("false");
  });
  it("offers a whole 24-hour day and pre-fills the selected slot", () => {
    saveCalendarState({ sources: [{ id: "personal", name: "Personal", type: "local", events: [], color: "#123456", enabled: true }], showHabits: false });
    render(<CalendarView habits={[]} />);
    fireEvent.click(screen.getByRole("tab", { name: "Day" }));
    expect(screen.getAllByRole("button", { name: /Create an event ·/ })).toHaveLength(24);
    fireEvent.click(screen.getByRole("button", { name: /Create an event ·.* 23:00/ }));
    expect((within(screen.getByRole("dialog")).getAllByLabelText("Starts")[1] as HTMLInputElement).value).toBe("23:00");
  });
  it("lays overlapping events out side by side with equal widths", () => {
    const today = dateKey();
    const base = { sourceId: "personal", date: today, endDate: today, kind: "event" as const, color: "#123456" };
    saveCalendarState({ sources: [{ id: "personal", name: "Personal", type: "local", color: "#123456", enabled: true, events: [
      { ...base, id: "a", title: "Design review", startTime: "10:00", endTime: "11:00" },
      { ...base, id: "b", title: "Standup", startTime: "10:30", endTime: "11:30" },
      { ...base, id: "c", title: "Lunch", startTime: "13:00", endTime: "14:00" },
    ] }], showHabits: false });
    render(<CalendarView habits={[]} />);
    const review = screen.getByRole("button", { name: /Design review/ });
    const standup = screen.getByRole("button", { name: /Standup/ });
    const lunch = screen.getByRole("button", { name: /Lunch/ });
    expect([review.style.getPropertyValue("--col"), review.style.getPropertyValue("--cols")]).toEqual(["0", "2"]);
    expect([standup.style.getPropertyValue("--col"), standup.style.getPropertyValue("--cols")]).toEqual(["1", "2"]);
    expect(lunch.style.getPropertyValue("--cols")).toBe("1");
  });
  it("jumps to a day picked in the mini month", () => {
    saveCalendarState({ sources: [{ id: "personal", name: "Personal", type: "local", events: [], color: "#123456", enabled: true }], showHabits: false });
    render(<CalendarView habits={[]} />);
    fireEvent.click(screen.getByRole("tab", { name: "Day" }));
    const now = new Date();
    const target = new Date(now.getFullYear(), now.getMonth(), now.getDate() === 15 ? 16 : 15);
    fireEvent.click(screen.getByRole("button", { name: new Intl.DateTimeFormat("en", { dateStyle: "full" }).format(target) }));
    expect(screen.getByRole("button", { name: `Create an event · ${dateKey(target)} 09:00` })).toBeTruthy();
  });
});
