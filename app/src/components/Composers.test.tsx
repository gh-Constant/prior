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
});
