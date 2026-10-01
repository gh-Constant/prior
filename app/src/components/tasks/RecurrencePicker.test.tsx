import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Task, TaskRecurrence } from "../../types";
import { RecurrenceChip } from "./RecurrenceChip";
import { RecurrencePicker } from "./RecurrencePicker";

afterEach(() => cleanup());

// 2026-10-01 is a Thursday.
const DUE = "2026-10-01";

function Harness({ initial = null, dueDate = DUE, onChange }: { initial?: TaskRecurrence | null; dueDate?: string | null; onChange?: (rule: TaskRecurrence | null) => void }) {
  const [value, setValue] = useState<TaskRecurrence | null>(initial);
  return <RecurrencePicker value={value} dueDate={dueDate} onChange={(next) => { setValue(next); onChange?.(next); }} />;
}

describe("RecurrencePicker", () => {
  it("offers presets worded against the due date", () => {
    render(<Harness />);
    const select = screen.getByRole("combobox", { name: "Repeat" });
    const labels = [...select.querySelectorAll("option")].map((option) => option.getAttribute("label"));
    expect(labels).toEqual([
      "Doesn't repeat", "Every day", "Every weekday (Mon–Fri)", "Every week on Thursday", "Every month on the 1st", "Every year on October 1", "Custom…",
    ]);
  });

  it("applies a preset and clears it", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const select = () => screen.getByRole("combobox", { name: "Repeat" });
    fireEvent.change(select(), { target: { value: "weekly" } });
    expect(onChange).toHaveBeenLastCalledWith({ interval: 1, unit: "week", daysOfWeek: [4] });
    fireEvent.change(select(), { target: { value: "weekdays" } });
    expect(onChange).toHaveBeenLastCalledWith({ interval: 1, unit: "week", daysOfWeek: [1, 2, 3, 4, 5] });
    fireEvent.change(select(), { target: { value: "monthly" } });
    expect(onChange).toHaveBeenLastCalledWith({ interval: 1, unit: "month" });
    fireEvent.change(select(), { target: { value: "none" } });
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it("describes the current rule on the trigger", () => {
    render(<Harness initial={{ interval: 2, unit: "week", daysOfWeek: [1, 4] }} />);
    expect(screen.getByText("Every 2 weeks on Mon, Thu")).toBeInTheDocument();
  });

  it("edits a custom rule: interval, unit, weekdays, completion basis and end date", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    fireEvent.change(screen.getByRole("combobox", { name: "Repeat" }), { target: { value: "custom" } });
    expect(onChange).toHaveBeenLastCalledWith({ interval: 1, unit: "week", daysOfWeek: [4] });
    const group = screen.getByRole("group", { name: "On" });
    expect(group).toBeInTheDocument();

    fireEvent.change(screen.getByRole("spinbutton", { name: "Every" }), { target: { value: "2" } });
    expect(onChange).toHaveBeenLastCalledWith({ interval: 2, unit: "week", daysOfWeek: [4] });
    fireEvent.click(screen.getByRole("button", { name: "Repeat on Monday" }));
    expect(onChange).toHaveBeenLastCalledWith({ interval: 2, unit: "week", daysOfWeek: [1, 4] });
    fireEvent.click(screen.getByRole("button", { name: "Repeat on Thursday" }));
    expect(onChange).toHaveBeenLastCalledWith({ interval: 2, unit: "week", daysOfWeek: [1] });

    fireEvent.click(screen.getByRole("checkbox", { name: /Repeat from completion date/ }));
    expect(onChange).toHaveBeenLastCalledWith({ interval: 2, unit: "week", daysOfWeek: [1], basis: "completion" });

    // Out-of-range intervals are ignored.
    onChange.mockClear();
    fireEvent.change(screen.getByRole("spinbutton", { name: "Every" }), { target: { value: "0" } });
    fireEvent.change(screen.getByRole("spinbutton", { name: "Every" }), { target: { value: "1000" } });
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.change(screen.getByRole("combobox", { name: "Unit" }), { target: { value: "month" } });
    expect(onChange).toHaveBeenLastCalledWith({ interval: 2, unit: "month", basis: "completion" });
    expect(screen.queryByRole("group", { name: "On" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.queryByRole("spinbutton", { name: "Every" })).not.toBeInTheDocument();
  });
});

describe("RecurrenceChip", () => {
  const base: Pick<Task, "recurrence" | "dueDate"> = { dueDate: DUE, recurrence: { interval: 1, unit: "day" } };

  it("shows a short summary with a full label", () => {
    render(<RecurrenceChip task={base} />);
    const chip = screen.getByRole("img", { name: "Repeats: Every day" });
    expect(chip).toHaveTextContent("Daily");
    expect(chip).toHaveAttribute("title", "Every day");
  });

  it("renders nothing for a task that does not repeat", () => {
    const { container } = render(<RecurrenceChip task={{ dueDate: DUE, recurrence: null }} />);
    expect(container).toBeEmptyDOMElement();
  });
});
