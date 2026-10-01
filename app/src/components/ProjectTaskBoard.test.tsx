import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Task } from "../types";
import { dragCard } from "../test/kanbanDrag";
import { ProjectTaskBoard } from "./ProjectTaskBoard";

afterEach(cleanup);

function task(id: string, overrides: Partial<Task> = {}): Task {
  return {
    id, title: `Task ${id}`, description: "", dueDate: null, priority: 4, completed: false, important: false, urgent: false,
    createdAt: "2026-09-01T10:00:00.000Z", updatedAt: `2026-09-0${id.length}T10:00:00.000Z`, deletedAt: null, ...overrides,
  };
}

const tasks = [task("a", { status: "next" }), task("b", { status: "in_progress" }), task("c", { status: "inbox" }), task("d", { status: "done", completed: true })];

function renderBoard(projectType: "standard" | "software", onChange = vi.fn(async () => {})) {
  render(<ProjectTaskBoard project={{ name: "Site", icon: null, projectType }} tasks={tasks} onChange={onChange} onDelete={vi.fn(async () => {})} onEdit={vi.fn()} onAddTask={vi.fn()} />);
  return onChange;
}

const column = (name: string) => screen.getByRole("region", { name });

describe("ProjectTaskBoard", () => {
  it("shows the simple workflow for standard projects, folding triage tasks into Todo", () => {
    renderBoard("standard");
    expect(screen.getAllByRole("region").filter((region) => region.hasAttribute("data-kanban-column")).map((region) => region.getAttribute("aria-label"))).toEqual(["Todo", "In progress", "Waiting", "Done"]);
    expect(within(column("Todo")).getByText("Task c")).toBeInTheDocument();
  });

  it("shows the full workflow for software projects", () => {
    renderBoard("software");
    expect(screen.getAllByRole("region").filter((region) => region.hasAttribute("data-kanban-column")).map((region) => region.getAttribute("aria-label"))).toEqual(["Inbox", "Backlog", "Todo", "In progress", "Waiting", "Done"]);
    expect(within(column("Inbox")).getByText("Task c")).toBeInTheDocument();
  });

  it("moves a dropped card by status and completes it in Done", () => {
    const onChange = renderBoard("standard");
    dragCard(screen.getByText("Task a").closest("article")!, column("In progress"));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ id: "a", status: "in_progress", completed: false }));
    dragCard(screen.getByText("Task a").closest("article")!, column("Done"));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ id: "a", status: "done", completed: true }));
  });

  it("reopens a done task moved back to a workflow column", () => {
    const onChange = renderBoard("standard");
    dragCard(screen.getByText("Task d").closest("article")!, column("Waiting"));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ id: "d", status: "waiting", completed: false }));
  });

  it("completes a card from its circle without starting a drag", () => {
    const onChange = renderBoard("standard");
    fireEvent.click(screen.getByRole("button", { name: "Mark Task a complete" }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ id: "a", completed: true }));
  });
});
