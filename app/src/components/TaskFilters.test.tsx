import { describe, expect, it, vi, afterEach } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { TaskFilters } from "./TaskFilters";
import { defaultTaskFilters, type TaskFilterState } from "../lib/taskFilters";

afterEach(() => cleanup());

function Harness({ onChange }: { readonly onChange: (next: TaskFilterState) => void }) {
  const [value, setValue] = useState<TaskFilterState>(defaultTaskFilters);
  return (
    <TaskFilters
      value={value}
      onChange={(next) => {
        setValue(next);
        onChange(next);
      }}
    />
  );
}

describe("TaskFilters", () => {
  it("expands the panel, applies a filter pill, and clears everything", () => {
    const onChange = vi.fn();
    const { container } = render(<Harness onChange={onChange} />);

    expect(screen.queryByLabelText("Date added")).toBeNull();
    fireEvent.click(screen.getByText("Filters"));
    const dateSelect = screen.getByLabelText("Date added");
    fireEvent.change(dateSelect, { target: { value: "today" } });

    expect(container.querySelector(".active-pills")).not.toBeNull();
    expect(screen.getByLabelText("1 active filters")).toBeDefined();

    fireEvent.click(screen.getByText("Clear all"));
    expect(container.querySelector(".active-pills")).toBeNull();
    const last = onChange.mock.calls.at(-1)?.[0] as TaskFilterState;
    expect(last).toEqual(defaultTaskFilters);
  });

  it("searches and removes the query pill", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);

    fireEvent.change(screen.getByLabelText("Search tasks"), { target: { value: "report" } });
    expect(screen.getByLabelText("Clear search")).toBeDefined();

    fireEvent.click(screen.getByLabelText("Clear search"));
    const last = onChange.mock.calls.at(-1)?.[0] as TaskFilterState;
    expect(last.query).toBe("");
  });

  it("changes the sort order", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);

    fireEvent.change(screen.getByLabelText("Sort tasks"), { target: { value: "dueSoonest" } });
    const last = onChange.mock.calls.at(-1)?.[0] as TaskFilterState;
    expect(last.sort).toBe("dueSoonest");
    expect(screen.getAllByText("Due soonest")).toHaveLength(2);
  });

  it("applies every panel field and removes pills individually", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    fireEvent.click(screen.getByText("Filters"));

    fireEvent.change(screen.getByLabelText("Due date"), { target: { value: "overdue" } });
    fireEvent.change(screen.getByLabelText("Task priority"), { target: { value: "p1" } });
    fireEvent.change(screen.getByLabelText("Importance and urgency"), { target: { value: "both" } });
    fireEvent.change(screen.getByLabelText("Status"), { target: { value: "all" } });

    const last = onChange.mock.calls.at(-1)?.[0] as TaskFilterState;
    expect(last).toMatchObject({ dueDate: "overdue", taskPriority: "p1", priority: "both", status: "all" });

    fireEvent.click(screen.getByLabelText("Remove Overdue filter"));
    const afterRemove = onChange.mock.calls.at(-1)?.[0] as TaskFilterState;
    expect(afterRemove.dueDate).toBe("any");
  });
});
