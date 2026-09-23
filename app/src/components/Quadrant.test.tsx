import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { fireEvent } from "@testing-library/react";
import { Quadrant } from "./Quadrant";
import { EisenhowerMatrix } from "./EisenhowerMatrix";
import type { Task } from "../types";

afterEach(() => cleanup());

describe("Quadrant component (Eisenhower matrix)", () => {
  const sampleTasks: Task[] = [
    {
      id: "task-1",
      title: "Fix production outage",
      description: "Critical bug in payments",
      dueDate: "2026-09-17",
      priority: 1,
      important: true,
      urgent: true,
      completed: false,
      areaId: "area-work",
      projectId: "project-launch",
      status: "in_progress",
      scheduledDate: "2026-09-17",
      assigneeName: "Alice",
      followUpDate: "2026-09-18",
      createdAt: "2026-09-17T10:00:00Z",
      updatedAt: "2026-09-17T10:00:00Z",
      deletedAt: null,
    },
    {
      id: "task-2",
      title: "Write documentation",
      description: "",
      dueDate: null,
      priority: 3,
      important: true,
      urgent: false,
      completed: false,
      status: "next",
      createdAt: "2026-09-17T10:00:00Z",
      updatedAt: "2026-09-17T10:00:00Z",
      deletedAt: null,
    },
  ];

  it("renders tasks statically without draggable attributes or drag event listeners", () => {
    const { container } = render(
      <Quadrant
        id="focus"
        label="Focus (Do First)"
        tasks={sampleTasks}
        onChange={vi.fn()}
        onDelete={vi.fn()}
        onEdit={vi.fn()}
      />
    );

    expect(screen.getByRole("heading", { level: 2, name: "Focus (Do First)" })).toBeInTheDocument();
    expect(screen.getByText("Fix production outage")).toBeInTheDocument();
    expect(screen.getByText("Write documentation")).toBeInTheDocument();

    // Check that no task row or quadrant element is draggable
    const draggables = container.querySelectorAll("[draggable='true']");
    expect(draggables.length).toBe(0);

    // Verify task rows exist as clean static list items
    const taskRows = container.querySelectorAll(".task-row");
    expect(taskRows.length).toBe(2);
    taskRows.forEach((row) => {
      expect(row.getAttribute("draggable")).toBeNull();
    });
  });

  it("hides the next status badge when hideNextStatus is set, like all tasks and today", () => {
    const { rerender } = render(
      <Quadrant
        id="focus"
        label="Focus (Do First)"
        tasks={sampleTasks}
        onChange={vi.fn()}
        onDelete={vi.fn()}
        onEdit={vi.fn()}
      />
    );
    expect(document.querySelector(".task-status-badge")).toBeInTheDocument();

    rerender(
      <Quadrant
        id="focus"
        label="Focus (Do First)"
        tasks={sampleTasks}
        onChange={vi.fn()}
        onDelete={vi.fn()}
        onEdit={vi.fn()}
        hideNextStatus
      />
    );
    // The "next" task badge disappears; the "in_progress" badge stays.
    const badges = [...document.querySelectorAll(".task-status-badge")];
    expect(badges).toHaveLength(1);
  });

  it("preserves task metadata including area, project, status, and delegation values", () => {
    render(
      <Quadrant
        id="focus"
        label="Focus (Do First)"
        tasks={sampleTasks}
        onChange={vi.fn()}
        onDelete={vi.fn()}
        onEdit={vi.fn()}
      />
    );

    const task = sampleTasks[0];
    expect(task.areaId).toBe("area-work");
    expect(task.projectId).toBe("project-launch");
    expect(task.status).toBe("in_progress");
    expect(task.assigneeName).toBe("Alice");
    expect(task.followUpDate).toBe("2026-09-18");
  });

  it("shows a header count, an empty-state line and an add action", () => {
    const onAdd = vi.fn();
    render(<Quadrant id="plan" label="Schedule" hint="Important · Not urgent" tasks={[]} onChange={vi.fn()} onDelete={vi.fn()} onEdit={vi.fn()} onAdd={onAdd} />);
    expect(screen.getByText("Important · Not urgent")).toBeInTheDocument();
    expect(screen.getByLabelText("0 tasks")).toHaveTextContent("0");
    expect(screen.getByText("No tasks here yet.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Add a task to Schedule" }));
    expect(onAdd).toHaveBeenCalledTimes(1);
  });
});

describe("EisenhowerMatrix", () => {
  it("lays out the four quadrants with axis labels and presets new tasks per quadrant", () => {
    const onNewTask = vi.fn();
    render(<EisenhowerMatrix grouped={{ focus: [], plan: [], quick: [], later: [] }} onChange={vi.fn()} onDelete={vi.fn()} onEdit={vi.fn()} onNewTask={onNewTask} />);
    expect(screen.getAllByRole("heading", { level: 2 }).map((heading) => heading.textContent)).toEqual(["Do now", "Schedule", "Delegate", "Later"]);
    expect(screen.getByText("Not urgent")).toBeInTheDocument();
    expect(screen.getByText("Not important")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Add a task to Delegate" }));
    expect(onNewTask).toHaveBeenLastCalledWith({ important: false, urgent: true });
    fireEvent.click(screen.getByRole("button", { name: "Add a task to Do now" }));
    expect(onNewTask).toHaveBeenLastCalledWith({ important: true, urgent: true });
  });
});
