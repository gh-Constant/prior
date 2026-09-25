import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Habit } from "../types";
import { HabitView } from "./HabitView";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function daily(id: string, title: string, completedDates: string[]): Habit {
  return { id, title, important: false, urgent: false, interval: 1, unit: "day", startDate: "2026-09-15", timeOfDay: null, daysOfWeek: [], completedDates, createdAt: "2026-09-15T00:00:00.000Z", updatedAt: "2026-09-15T00:00:00.000Z", deletedAt: null };
}

describe("HabitView summary and rows", () => {
  it("derives progress and streaks from completed dates and completes the open occurrence", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-19T10:00:00")); // Saturday
    const onComplete = vi.fn().mockResolvedValue(undefined);
    const reading = daily("read", "Read", ["2026-09-16", "2026-09-17", "2026-09-18", "2026-09-19"]);
    const water = daily("water", "Water", ["2026-09-18"]);
    render(<HabitView habits={[reading, water]} onAdd={vi.fn()} onComplete={onComplete} onChange={vi.fn()} onDelete={vi.fn()} onEdit={vi.fn()} />);

    expect(screen.getByRole("img", { name: "1/2 done" })).toBeInTheDocument();
    // Four consecutive completions for Read; Water's open occurrence today does not break its streak.
    expect(screen.getByRole("img", { name: "Current streak: 4" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Current streak: 1" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Mark Water complete" }));
    expect(onComplete).toHaveBeenCalledWith(expect.objectContaining({ id: "water" }), "2026-09-19");
  });

  it("shows the empty state with a create action when nothing is scheduled", () => {
    const onAdd = vi.fn();
    render(<HabitView habits={[]} onAdd={onAdd} onComplete={vi.fn()} onChange={vi.fn()} onDelete={vi.fn()} onEdit={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /Create a habit/ }));
    expect(onAdd).toHaveBeenCalledOnce();
  });
});
