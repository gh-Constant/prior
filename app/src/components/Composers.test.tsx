import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { TaskComposer } from "./TaskComposer";
import type { Habit, Task, TaskDraft } from "../types";
import { HabitComposer } from "./HabitComposer";

afterEach(() => cleanup());

describe("TaskComposer", () => {
  it("creates a task with title, priority, and flags", async () => {
    const onSave = vi.fn(async (_input: TaskDraft) => undefined);
    const onCancel = vi.fn();
    render(<TaskComposer onSave={onSave} onCancel={onCancel} />);

    fireEvent.change(screen.getByLabelText("Task title"), { target: { value: "  Buy milk  " } });
    fireEvent.change(screen.getByLabelText("Priority"), { target: { value: "1" } });
    fireEvent.click(screen.getByText(/More options/));
    fireEvent.click(screen.getByText("Important"));
    fireEvent.click(screen.getByText("Create task", { selector: "button.primary-button" }));

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls.at(0)?.[0]).toMatchObject({ title: "Buy milk", priority: 1, important: true, urgent: false });
  });

  it("edits an existing task without clearing the form", async () => {
    const onSave = vi.fn(async (_input: TaskDraft) => undefined);
    const task: Task = {
      id: "t1",
      title: "Old",
      description: "",
      dueDate: null,
      priority: 4 as const,
      important: false,
      urgent: false,
      completed: false,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      deletedAt: null,
    };
    render(<TaskComposer task={task} onSave={onSave} onCancel={() => undefined} />);
    expect(screen.getByLabelText("Task title")).toHaveProperty("value", "Old");
    fireEvent.click(screen.getByText("Save task"));
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it("hides the project field inside a project but keeps it for a personal task", async () => {
    const scopedSave = vi.fn(async (_input: TaskDraft) => undefined);
    render(<TaskComposer initialContext={{ projectId: "p1" }} onSave={scopedSave} onCancel={() => undefined} />);
    expect(screen.queryByLabelText("Project")).not.toBeInTheDocument();
    expect(screen.queryByText("No project")).not.toBeInTheDocument();
    const details = screen.getByText(/More options/).closest("details")!;
    expect(details).not.toHaveAttribute("open");
    expect(screen.getByLabelText("Assignee").closest("details")).not.toHaveAttribute("open");
    fireEvent.change(screen.getByLabelText("Task title"), { target: { value: "Scoped" } });
    fireEvent.click(screen.getByText("Create task"));
    expect(scopedSave).toHaveBeenCalledWith(expect.objectContaining({ title: "Scoped", projectId: "p1" }));
    cleanup();

    const personalSave = vi.fn(async (_input: TaskDraft) => undefined);
    render(<TaskComposer onSave={personalSave} onCancel={() => undefined} />);
    expect(screen.getByLabelText("Project")).toBeInTheDocument();
    expect(screen.getByLabelText("Status")).toBeInTheDocument();
  });

  it("hides the area field when locked by context", () => {
    render(<TaskComposer initialContext={{ areaId: "a" }} onSave={vi.fn()} onCancel={() => undefined} />);
    expect(screen.queryByLabelText("Area")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Project")).toBeInTheDocument();
  });
});

describe("HabitComposer", () => {
  it("creates a habit with schedule and flags", async () => {
    const onSave = vi.fn(async (_input: Pick<Habit, "title" | "important" | "urgent" | "interval" | "unit">) => undefined);
    render(<HabitComposer onSave={onSave} onCancel={() => undefined} />);

    fireEvent.change(screen.getByLabelText("Habit title"), { target: { value: "Read" } });
    fireEvent.click(screen.getByText("Urgent"));
    fireEvent.click(screen.getByText("Create habit"));

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls.at(0)?.[0]).toMatchObject({ title: "Read", urgent: true, interval: 1, unit: "day" });
  });

  it("does not save with an empty title", async () => {
    const onSave = vi.fn(async (_input: Pick<Habit, "title" | "important" | "urgent" | "interval" | "unit">) => undefined);
    render(<HabitComposer onSave={onSave} onCancel={() => undefined} />);
    expect(screen.getByText("Create habit")).toBeDisabled();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("captures a weekly weekday and an optional end date", async () => {
    const onSave = vi.fn(async (_input: Record<string, unknown>) => undefined);
    render(<HabitComposer onSave={onSave} onCancel={() => undefined} />);

    fireEvent.change(screen.getByLabelText("Habit title"), { target: { value: "Clean shower" } });
    fireEvent.change(screen.getByText("Period").closest("label")?.querySelector("select") as HTMLSelectElement, { target: { value: "week" } });
    fireEvent.click(screen.getByRole("button", { name: "Saturday" }));
    fireEvent.change(screen.getByLabelText("Ends optional"), { target: { value: "2026-10-10" } });
    fireEvent.click(screen.getByText("Create habit"));

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ title: "Clean shower", unit: "week", daysOfWeek: [6], endDate: "2026-10-10" }));
  });

  it("supports frequency mode buttons, quick presets, and natural schedule preview", async () => {
    const onSave = vi.fn(async (_input: Record<string, unknown>) => undefined);
    render(<HabitComposer onSave={onSave} onCancel={() => undefined} />);

    fireEvent.change(screen.getByLabelText("Habit title"), { target: { value: "Workout" } });

    // Click "Specific days" frequency button
    fireEvent.click(screen.getByRole("radio", { name: /Specific days/i }));

    // Click "Weekend" preset chip
    fireEvent.click(screen.getByRole("button", { name: /Weekend/i }));
    expect(screen.getByText(/Every Saturday and Sunday/i)).toBeInTheDocument();

    // Click Wednesday to also include it
    fireEvent.click(screen.getByRole("button", { name: "Wednesday" }));
    expect(screen.getByText(/Every Wednesday, Saturday, and Sunday/i)).toBeInTheDocument();

    fireEvent.click(screen.getByText("Create habit"));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      title: "Workout",
      unit: "week",
      interval: 1,
      daysOfWeek: [1, 6, 0].includes(3) ? expect.arrayContaining([3, 6, 0]) : expect.any(Array),
    }));
  });
});
