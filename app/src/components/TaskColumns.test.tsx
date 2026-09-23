import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { Task } from "../types";
import { TaskColumns } from "./TaskColumns";

function task(id: string, overrides: Partial<Task> = {}): Task {
  return {
    id, title: `Task ${id}`, description: "", dueDate: null, priority: 4, completed: false, important: false, urgent: false,
    createdAt: "2026-09-01T10:00:00.000Z", updatedAt: "2026-09-01T10:00:00.000Z", deletedAt: null, ...overrides,
  };
}

afterEach(() => cleanup());

describe("TaskColumns board", () => {
  const tasks = [task("1", { status: "next" }), task("2", { status: "in_progress" }), task("3", { completed: true, status: "done" })];

  it("renders one column per open status and hides Done unless requested", () => {
    const onNewTask = vi.fn();
    const { rerender } = render(<TaskColumns tasks={tasks} onChange={vi.fn()} onDelete={vi.fn()} onEdit={vi.fn()} onNewTask={onNewTask} />);
    expect(screen.getAllByRole("heading", { level: 2 }).map((heading) => heading.textContent)).toEqual(["In progress1", "Up next1", "Inbox0", "Waiting0", "Backlog0"]);
    expect(within(screen.getByRole("region", { name: /Up next/ })).getByRole("button", { name: "Task 1" })).toBeInTheDocument();
    expect(screen.queryByText("Task 3")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "New task in Backlog" }));
    expect(onNewTask).toHaveBeenCalledWith({ status: "backlog" });

    rerender(<TaskColumns tasks={tasks} showDone onChange={vi.fn()} onDelete={vi.fn()} onEdit={vi.fn()} />);
    expect(within(screen.getByRole("region", { name: /Done/ })).getByRole("button", { name: "Task 3" })).toBeInTheDocument();
  });
});
