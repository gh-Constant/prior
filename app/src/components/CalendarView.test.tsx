import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CalendarView } from "./CalendarView";
import { loadCalendarState, saveCalendarState } from "../lib/calendar";
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
    // Sources live behind the toggle so the board keeps the full width.
    fireEvent.click(screen.getByRole("button", { name: /Your calendars/ }));
    expect(screen.getByText("My courses")).toBeTruthy();
    expect(screen.getByRole("button", { name: /My first event/ })).toBeTruthy();
  });
  it("keeps the board full-width until calendars are opened and toggles habits inline", () => {
    saveCalendarState({ sources: [{ id: "personal", name: "Personal", type: "local", events: [], color: "#123456", enabled: true }], showHabits: true });
    render(<CalendarView habits={[]} />);
    expect(screen.queryByText("Personal")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Your calendars/ }));
    expect(screen.getByText("Personal")).toBeTruthy();
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
});
