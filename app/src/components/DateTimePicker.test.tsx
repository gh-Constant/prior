import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Habit } from "../types";
import { DateTimePicker } from "./DateTimePicker";
import { HabitView } from "./HabitView";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("DateTimePicker", () => {
  it("selects a calendar date and optional time", () => {
    const onChange = vi.fn();
    const onTimeChange = vi.fn();
    render(<DateTimePicker value="2026-09-19" onChange={onChange} time={null} onTimeChange={onTimeChange} allowTime ariaLabel="Due date" />);

    fireEvent.click(screen.getByRole("button", { name: /Due date.*open date picker/ }));
    fireEvent.click(screen.getByRole("gridcell", { name: "21" }));
    fireEvent.click(screen.getByRole("button", { name: "Add time" }));

    expect(onChange).toHaveBeenCalledWith("2026-09-21");
    expect(onTimeChange).toHaveBeenCalledWith("09:00");
  });

  it("disables dates before the configured minimum", () => {
    render(<DateTimePicker value="2026-09-19" min="2026-09-19" onChange={vi.fn()} ariaLabel="End date" />);
    fireEvent.click(screen.getByRole("button", { name: /End date.*open date picker/ }));
    expect(screen.getByRole("gridcell", { name: "18" })).toBeDisabled();
  });
});

describe("HabitView today schedule", () => {
  function habit(id: string, title: string, daysOfWeek: number[], timeOfDay?: string): Habit {
    return { id, title, important: false, urgent: false, interval: 1, unit: "week", startDate: "2026-09-01", timeOfDay, daysOfWeek, completedDates: [], createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z", deletedAt: null };
  }

  it("shows a weekly habit on its selected weekday and hides other weekdays", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-19T10:00:00")); // Saturday
    render(<HabitView habits={[habit("sat", "Saturday review", [6], "09:30"), habit("sun", "Sunday review", [0])]} onAdd={vi.fn()} onComplete={vi.fn()} onChange={vi.fn()} onDelete={vi.fn()} onEdit={vi.fn()} />);

    expect(screen.getByText("Saturday review")).toBeInTheDocument();
    expect(screen.getByText("09:30")).toBeInTheDocument();
    expect(screen.queryByText("Sunday review")).not.toBeInTheDocument();
  });
});
