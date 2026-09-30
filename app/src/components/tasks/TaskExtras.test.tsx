import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChecklistItem } from "../../types";
import { ChecklistEditor, checklistProgress } from "./ChecklistEditor";
import { ReminderPicker } from "./ReminderPicker";

vi.mock("../../lib/notificationScheduler", () => ({ requestNotificationPermission: vi.fn(async () => "granted") }));

function Harness({ initial, onChange }: { initial: ChecklistItem[]; onChange?: (items: ChecklistItem[]) => void }) {
  const [items, setItems] = useState(initial);
  return <ChecklistEditor items={items} onChange={(next) => { setItems(next); onChange?.(next); }} />;
}

const two: ChecklistItem[] = [
  { id: "a", title: "Draft", done: false, position: 0 },
  { id: "b", title: "Send", done: true, position: 1 },
];

afterEach(() => cleanup());

describe("ChecklistEditor", () => {
  it("shows progress and checks items", () => {
    const onChange = vi.fn();
    render(<Harness initial={two} onChange={onChange} />);
    expect(screen.getByLabelText("1 of 2 done")).toHaveTextContent("1/2");
    fireEvent.click(screen.getByRole("checkbox", { name: "Check Draft" }));
    expect(onChange).toHaveBeenLastCalledWith([{ ...two[0], done: true }, two[1]]);
    expect(screen.getByLabelText("2 of 2 done")).toBeInTheDocument();
  });

  it("adds items with Enter and keeps the focus in the new-item field", () => {
    const onChange = vi.fn();
    render(<Harness initial={[]} onChange={onChange} />);
    const input = screen.getByLabelText("Add an item");
    fireEvent.change(input, { target: { value: "Buy stamps" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).toHaveBeenLastCalledWith([expect.objectContaining({ title: "Buy stamps", done: false, position: 0 })]);
    expect(screen.getByLabelText("Add an item")).toHaveValue("");
    expect(document.activeElement).toBe(screen.getByLabelText("Add an item"));
  });

  it("deletes an emptied item with Backspace and moves items with Alt+arrows", () => {
    const onChange = vi.fn();
    render(<Harness initial={two} onChange={onChange} />);
    const second = screen.getByLabelText("Checklist item 2");
    fireEvent.keyDown(second, { key: "ArrowUp", altKey: true });
    expect(onChange).toHaveBeenLastCalledWith([{ ...two[1], position: 0 }, { ...two[0], position: 1 }]);
    const first = screen.getByLabelText("Checklist item 2");
    fireEvent.change(first, { target: { value: "" } });
    fireEvent.keyDown(first, { key: "Backspace" });
    expect(onChange).toHaveBeenLastCalledWith([{ ...two[1], position: 0 }]);
  });

  it("saves a renamed title on blur only", () => {
    const onChange = vi.fn();
    render(<Harness initial={two} onChange={onChange} />);
    const first = screen.getByLabelText("Checklist item 1");
    fireEvent.change(first, { target: { value: "Draft v2" } });
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.blur(first);
    expect(onChange).toHaveBeenLastCalledWith([{ ...two[0], title: "Draft v2" }, two[1]]);
  });

  it("computes progress", () => {
    expect(checklistProgress([])).toBeNull();
    expect(checklistProgress(two)).toEqual({ done: 1, total: 2 });
  });
});

describe("ReminderPicker", () => {
  it("offers due-based presets and clears", () => {
    const onChange = vi.fn();
    const due = new Date();
    due.setDate(due.getDate() + 2);
    const dueDate = `${due.getFullYear()}-${String(due.getMonth() + 1).padStart(2, "0")}-${String(due.getDate()).padStart(2, "0")}`;
    const { rerender } = render(<ReminderPicker task={{ dueDate, dueTime: "15:00" }} value={null} onChange={onChange} />);
    const select = screen.getByRole("combobox", { name: "Reminder" });
    expect(select.querySelector("option[value=\"10min\"]")?.getAttribute("label")).toMatch(/^10 min before · /);
    fireEvent.change(select, { target: { value: "10min" } });
    const expected = new Date(due.getFullYear(), due.getMonth(), due.getDate(), 14, 50).toISOString();
    expect(onChange).toHaveBeenLastCalledWith(expected);
    rerender(<ReminderPicker task={{ dueDate, dueTime: "15:00" }} value={expected} onChange={onChange} />);
    expect(screen.getByRole("button", { name: /^Reminder: / })).toBeInTheDocument();
    fireEvent.change(screen.getByRole("combobox", { name: "Reminder" }), { target: { value: "none" } });
    expect(onChange).toHaveBeenLastCalledWith(null);
  });
});
