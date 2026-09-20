import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CalendarEventEditor } from "./CalendarEventEditor";
import { CalendarSourceEditor } from "./CalendarSourceEditor";
import type { CalendarEvent, CalendarSource } from "../lib/calendar";
import { draftCalendarEvent } from "../lib/calendarAgent";
import { memoryStorage } from "../test/memoryStorage";
vi.mock("../lib/calendarAgent", () => ({ draftCalendarEvent: vi.fn() }));
const event: CalendarEvent = { id: "event", sourceId: "local", title: "Yoga", date: "2026-09-21", endDate: "2026-09-21", startTime: "10:00", endTime: "11:00", kind: "event", color: "#123456" };
const source: CalendarSource = { id: "local", name: "Personal", type: "local", enabled: true, color: "#123456", events: [event] };
describe("calendar editing forms", () => {
  beforeEach(() => { vi.stubGlobal("localStorage", memoryStorage()); localStorage.setItem("prior.language", "en"); vi.clearAllMocks(); });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
  it("only offers writable calendars and saves the selected recurrence and lock", () => {
    const save = vi.fn(() => true);
    render(<CalendarEventEditor initial={event} sources={[source, { ...source, id: "google", type: "google", name: "Google imported" }]} onClose={vi.fn()} onSave={save} />);
    expect(screen.queryByRole("option", { name: "Google imported" })).toBeNull();
    fireEvent.change(screen.getByLabelText("Repeat"), { target: { value: "weekly" } });
    fireEvent.click(screen.getByRole("button", { name: "Wed" }));
    fireEvent.click(screen.getByLabelText("Locked"));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ locked: true, recurrence: { frequency: "weekly", interval: 1, weekdays: [1, 3] } }), "series");
  });
  it("keeps the editor open when persistence fails", () => {
    const close = vi.fn();
    render(<CalendarEventEditor initial={event} sources={[source]} onClose={close} onSave={() => false} />);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(close).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toContain("Could not save");
  });
  it("previews imported title rules, saves preferences and preserves source events", () => {
    const save = vi.fn(() => true);
    render(<CalendarSourceEditor initial={{ ...source, type: "ics", events: [{ ...event, title: "Projet SAÉ" }] }} isNew={false} onClose={vi.fn()} onSave={save} onRemove={() => true} onRefresh={vi.fn()} syncing={false} />);
    fireEvent.change(screen.getByLabelText("Title contains…"), { target: { value: "sae" } });
    expect(screen.getByRole("status").textContent).toContain("1 matching events");
    fireEvent.click(screen.getByRole("button", { name: "Add rule" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ hiddenTitles: ["sae"], events: [expect.objectContaining({ title: "Projet SAÉ" })] }));
  });
  it("prepares an AI draft but never saves without review", async () => {
    vi.mocked(draftCalendarEvent).mockResolvedValue({ ...event, title: "AI yoga" });
    const save = vi.fn(() => true);
    render(<CalendarEventEditor initial={event} sources={[source]} onClose={vi.fn()} onSave={save} />);
    fireEvent.click(screen.getByRole("button", { name: /Draft with AI/ }));
    fireEvent.change(screen.getByLabelText("Draft with AI"), { target: { value: "Yoga at 10" } });
    fireEvent.click(screen.getAllByRole("button", { name: /Draft with AI/ })[1]);
    await waitFor(() => expect((screen.getByLabelText("Title") as HTMLInputElement).value).toBe("AI yoga"));
    expect(save).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(save).toHaveBeenCalledOnce();
  });
});
