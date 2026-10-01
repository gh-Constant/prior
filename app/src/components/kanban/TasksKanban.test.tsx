import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Project, Task } from "../../types";
import { dateKey, type KanbanGroupBy } from "../../lib/kanban";
import { defaultTaskFilters } from "../../lib/taskFilters";
import { dragCard } from "../../test/kanbanDrag";
import { TasksKanban } from "./TasksKanban";
import { TasksTopBarControls } from "./TasksTopBarControls";

afterEach(cleanup);

function task(id: string, overrides: Partial<Task> = {}): Task {
  return {
    id, title: `Task ${id}`, description: "", dueDate: null, priority: 4, completed: false, important: false, urgent: false,
    createdAt: "2026-09-01T10:00:00.000Z", updatedAt: "2026-09-01T10:00:00.000Z", deletedAt: null, ...overrides,
  };
}

const project = (id: string, name: string): Project => ({ id, areaId: null, name, description: "", status: "active", createdAt: "", updatedAt: "", deletedAt: null });
const projects = [project("p1", "Website"), project("p2", "Mobile app")];
const tasks = [
  task("a", { status: "next", priority: 1, projectId: "p1" }),
  task("b", { status: "in_progress", priority: 2, projectId: "p2", dueDate: dateKey(new Date()) }),
  task("c"),
];

function Harness({ initial = "status", onChange = vi.fn(async () => {}), onNewTask }: { initial?: KanbanGroupBy; onChange?: (task: Task) => Promise<void>; onNewTask?: () => void }) {
  const [groupBy, setGroupBy] = useState<KanbanGroupBy>(initial);
  return <TasksKanban tasks={tasks} visibleTasks={tasks} filters={defaultTaskFilters} projects={projects} groupBy={groupBy} onGroupByChange={setGroupBy} onChange={onChange} onDelete={vi.fn(async () => {})} onEdit={vi.fn()} onNewTask={onNewTask} />;
}

const column = (name: string) => screen.getByRole("region", { name });
const card = (title: string) => screen.getByText(title).closest("article") as HTMLElement;

describe("TasksKanban", () => {
  it("groups by status by default and keeps Done as a drop target", () => {
    render(<Harness />);
    expect(within(column("Up next")).getByText("Task a")).toBeInTheDocument();
    expect(within(column("In progress")).getByText("Task b")).toBeInTheDocument();
    expect(column("Done")).toBeInTheDocument();
  });

  it("switches the grouping from the control", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Priority" }));
    expect(within(column("Urgent")).getByText("Task a")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Project" }));
    expect(within(column("Website")).getByText("Task a")).toBeInTheDocument();
    expect(within(column("No project")).getByText("Task c")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Due date" }));
    expect(within(column("Today")).getByText("Task b")).toBeInTheDocument();
    expect(within(column("No date")).getByText("Task a")).toBeInTheDocument();
  });

  it("changes the status when a card is dropped on another column", () => {
    const onChange = vi.fn(async () => {});
    render(<Harness onChange={onChange} />);
    dragCard(card("Task a"), column("In progress"));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ id: "a", status: "in_progress", completed: false }));
  });

  it("completes a task dropped on Done", () => {
    const onChange = vi.fn(async () => {});
    render(<Harness onChange={onChange} />);
    dragCard(card("Task a"), column("Done"));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ id: "a", status: "done", completed: true }));
  });

  it("changes the priority and the project in those groupings", () => {
    const onChange = vi.fn(async () => {});
    const { unmount } = render(<Harness initial="priority" onChange={onChange} />);
    dragCard(card("Task c"), column("High"));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ id: "c", priority: 2 }));
    unmount();
    render(<Harness initial="project" onChange={onChange} />);
    dragCard(card("Task c"), column("Mobile app"));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ id: "c", projectId: "p2" }));
  });

  it("does not accept drops on Overdue and sets a date on the other due columns", () => {
    const onChange = vi.fn(async () => {});
    render(<Harness initial="due" onChange={onChange} />);
    dragCard(card("Task c"), column("Overdue"));
    expect(onChange).not.toHaveBeenCalled();
    dragCard(card("Task c"), column("Tomorrow"));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ id: "c", dueDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) }));
  });

  it("shows the error when the change is refused (read-only shared project)", async () => {
    render(<Harness onChange={vi.fn().mockRejectedValue(new Error("You can only view this project."))} />);
    dragCard(card("Task a"), column("In progress"));
    expect(await screen.findByRole("alert")).toHaveTextContent("You can only view this project.");
  });

  it("opens the composer in a column with the matching preset", () => {
    const onNewTask = vi.fn();
    render(<Harness initial="priority" onNewTask={onNewTask} />);
    fireEvent.click(screen.getByRole("button", { name: "Add a task to Urgent" }));
    expect(onNewTask).toHaveBeenCalledWith({ priority: 1 });
  });
});

describe("TasksTopBarControls", () => {
  it("toggles List and Kanban and offers Group by only for the board", () => {
    const onLayoutChange = vi.fn();
    const { rerender } = render(<TasksTopBarControls layout="list" onLayoutChange={onLayoutChange} groupBy="status" onGroupByChange={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /Group by/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "List" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Kanban" }));
    expect(onLayoutChange).toHaveBeenCalledWith("board");
    rerender(<TasksTopBarControls layout="board" onLayoutChange={onLayoutChange} groupBy="due" onGroupByChange={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Group by: Due date" })).toBeInTheDocument();
  });
});
