import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { Project, Task } from "../types";
import { defaultTaskFilters, filterTasks } from "../lib/taskFilters";
import { AllTasksView } from "./AllTasksView";

function task(id: string, overrides: Partial<Task> = {}): Task {
  return {
    id, title: `Task ${id}`, description: "", dueDate: null, priority: 4, completed: false, important: false, urgent: false,
    createdAt: "2026-09-01T10:00:00.000Z", updatedAt: "2026-09-01T10:00:00.000Z", deletedAt: null, ...overrides,
  };
}

const project: Project = { id: "p1", areaId: null, name: "Launch website", description: "", status: "active", createdAt: "", updatedAt: "", deletedAt: null };

const tasks: Task[] = [
  task("1", { status: "next", updatedAt: "2026-09-10T10:00:00.000Z", projectId: "p1", priority: 1, important: true, urgent: true, description: "Pricing copy" }),
  task("2", { status: "in_progress" }),
  task("3", { status: "next", updatedAt: "2026-09-05T10:00:00.000Z" }),
  task("4", { status: "waiting", assigneeName: "Alex Rivera" }),
  task("5", { status: "done", completed: true }),
  task("6", { status: "done", completed: true }),
];

function renderView(overrides: Partial<Parameters<typeof AllTasksView>[0]> = {}) {
  const handlers = { onChange: vi.fn(async () => undefined), onDelete: vi.fn(async () => undefined), onEdit: vi.fn(), onNewTask: vi.fn() };
  const visibleTasks = filterTasks(tasks, defaultTaskFilters);
  render(<AllTasksView tasks={tasks} visibleTasks={visibleTasks} filters={defaultTaskFilters} projects={[project]} {...handlers} {...overrides} />);
  return handlers;
}

function setWindowWidth(width: number) {
  Object.defineProperty(window, "innerWidth", { configurable: true, writable: true, value: width });
}

beforeEach(() => setWindowWidth(1024));
afterEach(() => cleanup());

describe("AllTasksView grouping", () => {
  it("groups open tasks by status in workflow order, keeping the sort inside a group", () => {
    renderView();
    const headings = screen.getAllByRole("heading", { level: 2 }).map((heading) => heading.textContent);
    expect(headings).toEqual(["In progress1", "Up next2", "Waiting1"]);

    const upNext = screen.getByRole("region", { name: /Up next/ });
    const titles = within(upNext).getAllByRole("button", { name: /^Task \d$/ }).map((button) => button.textContent);
    expect(titles).toEqual(["Task 1", "Task 3"]);
  });

  it("collapses completed tasks into a Done row that expands on demand", () => {
    renderView();
    const toggle = screen.getByRole("button", { name: "Done · 2" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("button", { name: "Task 5" })).toBeNull();
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: "Task 5" })).toBeInTheDocument();
  });

  it("creates a task preset to the group status from the group header", () => {
    const { onNewTask } = renderView();
    fireEvent.click(screen.getByRole("button", { name: "New task in Waiting" }));
    expect(onNewTask).toHaveBeenCalledWith({ status: "waiting" });
  });

  it("renders single-line rows with priority, project, and assignee metadata", () => {
    renderView();
    const row = screen.getByRole("button", { name: "Task 1" }).closest(".task-row");
    expect(row).toHaveClass("task-row-compact");
    expect(within(row as HTMLElement).getByRole("img", { name: "Priority 1 · Urgent" })).toBeInTheDocument();
    expect(within(row as HTMLElement).getByText("Launch website")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Alex Rivera" })).toHaveTextContent("AR");
  });
});

describe("AllTasksView detail panel", () => {
  it("opens the full editor on narrow windows", () => {
    const { onEdit } = renderView();
    fireEvent.click(screen.getByRole("button", { name: "Task 1" }));
    expect(onEdit).toHaveBeenCalledWith(tasks[0]);
    expect(screen.queryByRole("complementary", { name: "Task details" })).toBeNull();
  });

  it("shows an inline-editable inspector beside the list on wide windows", () => {
    setWindowWidth(1440);
    const { onChange, onEdit } = renderView();
    const title = screen.getByRole("button", { name: "Task 1" });
    fireEvent.click(title);
    expect(title).toHaveAttribute("aria-expanded", "true");

    const panel = screen.getByRole("complementary", { name: "Task details" });
    expect(within(panel).getByRole("heading", { level: 2, name: "Task 1" })).toBeInTheDocument();
    expect(within(panel).getByText("Pricing copy")).toBeInTheDocument();
    expect(within(panel).getAllByText("Launch website").length).toBeGreaterThan(0);
    expect(within(panel).getByText("Do now")).toBeInTheDocument();
    expect(within(panel).getByText("Task created")).toBeInTheDocument();

    fireEvent.change(within(panel).getByLabelText("Status"), { target: { value: "in_progress" } });
    expect(onChange).toHaveBeenLastCalledWith({ ...tasks[0], status: "in_progress", completed: false });

    fireEvent.change(within(panel).getByLabelText("Priority"), { target: { value: "3" } });
    expect(onChange).toHaveBeenLastCalledWith({ ...tasks[0], priority: 3 });

    fireEvent.click(within(panel).getByRole("button", { name: "Remove urgent" }));
    expect(onChange).toHaveBeenLastCalledWith({ ...tasks[0], urgent: false });

    fireEvent.click(within(panel).getByRole("button", { name: "Edit" }));
    expect(onEdit).toHaveBeenCalledWith(tasks[0]);

    fireEvent.click(within(panel).getByRole("button", { name: "Close details" }));
    expect(screen.queryByRole("complementary", { name: "Task details" })).toBeNull();
  });

  it("marks a task done from the inspector status", () => {
    setWindowWidth(1440);
    const { onChange } = renderView();
    fireEvent.click(screen.getByRole("button", { name: "Task 2" }));
    const panel = screen.getByRole("complementary", { name: "Task details" });
    fireEvent.change(within(panel).getByLabelText("Status"), { target: { value: "done" } });
    expect(onChange).toHaveBeenLastCalledWith({ ...tasks[1], status: "done", completed: true });
  });
});
