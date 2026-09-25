import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { Task } from "../types";
import { TaskRow, CompletionExitProvider } from "./TaskRow";

const task: Task = {
  id: "task-1",
  title: "Ship the fix",
  description: "",
  dueDate: null,
  priority: 4,
  completed: false,
  important: false,
  urgent: false,
  createdAt: "2026-09-16T10:00:00.000Z",
  updatedAt: "2026-09-16T10:00:00.000Z",
  deletedAt: null,
};

describe("TaskRow completion lifecycle", () => {
  let root: ReturnType<typeof createRoot> | undefined;
  let container: HTMLDivElement | undefined;

  afterEach(() => {
    if (root) act(() => root?.unmount());
    container?.remove();
  });

  it("ignores duplicate completion clicks while the save is pending", async () => {
    let resolveChange: (() => void) | undefined;
    const onChange = vi.fn(() => new Promise<void>((resolve) => { resolveChange = resolve; }));
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(<TaskRow task={task} onChange={onChange} onDelete={vi.fn(async () => undefined)} />);
    });

    const button = container.querySelector<HTMLButtonElement>(".complete-button");
    expect(button).not.toBeNull();

    await act(async () => {
      button?.click();
      button?.click();
      await Promise.resolve();
    });

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(button?.disabled).toBe(true);

    await act(async () => {
      resolveChange?.();
      await Promise.resolve();
    });

    expect(button?.disabled).toBe(false);
  });

  it("marks a completed task as exiting when its App deadline is active", async () => {
    const completedTask = { ...task, completed: true };
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <CompletionExitProvider deadlines={{ [completedTask.id]: Date.now() + 600 }}>
          <TaskRow task={completedTask} onChange={vi.fn(async () => undefined)} onDelete={vi.fn(async () => undefined)} />
        </CompletionExitProvider>,
      );
    });

    expect(container.querySelector(".task-row")?.classList.contains("completion-exiting")).toBe(true);
  });
});

describe("TaskRow project chip", () => {
  let root: ReturnType<typeof createRoot> | undefined;
  let container: HTMLDivElement | undefined;

  afterEach(() => {
    if (root) act(() => root?.unmount());
    container?.remove();
    root = undefined;
    container = undefined;
  });

  async function renderRow(taskOverrides: Partial<Task> = {}, project?: { name: string; icon?: string | null } | null) {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(<TaskRow task={{ ...task, ...taskOverrides }} project={project} onChange={vi.fn(async () => undefined)} onDelete={vi.fn(async () => undefined)} />);
    });
    return container;
  }

  it("shows the project icon and name when the task belongs to a project", async () => {
    const element = await renderRow({ projectId: "project-1" }, { name: "Launch", icon: "rocket" });
    const chip = element.querySelector(".task-project-meta");
    expect(chip).not.toBeNull();
    expect(chip?.textContent).toContain("Launch");
    expect(chip?.getAttribute("title")).toBe("Launch");
  });

  it("renders no chip or placeholder when the task has no project", async () => {
    const element = await renderRow({}, { name: "Launch", icon: "folder" });
    expect(element.querySelector(".task-project-meta")).toBeNull();
  });

  it("renders no chip when the project is unknown", async () => {
    const element = await renderRow({ projectId: "missing" }, null);
    expect(element.querySelector(".task-project-meta")).toBeNull();
  });

  it("can hide the next-action badge in global task views", async () => {
    const element = await renderRow({ status: "next" });
    expect(element.querySelector(".task-status-badge")).not.toBeNull();
    await act(async () => {
      root?.render(<TaskRow task={{ ...task, status: "next" }} hideNextStatus onChange={vi.fn(async () => undefined)} onDelete={vi.fn(async () => undefined)} />);
    });
    expect(element.querySelector(".task-status-badge")).toBeNull();
  });
});

describe("TaskRow context menu", () => {
  afterEach(() => cleanup());

  function renderRow() {
    const onDelete = vi.fn(async () => undefined);
    const onEdit = vi.fn();
    render(<TaskRow task={task} onChange={vi.fn(async () => undefined)} onDelete={onDelete} onEdit={onEdit} />);
    return { onDelete, onEdit };
  }

  it("opens on right-click, runs Delete, and closes", () => {
    const { onDelete } = renderRow();
    const row = document.querySelector(".task-row")!;
    fireEvent.contextMenu(row, { clientX: 100, clientY: 100 });
    expect(screen.getByRole("menu")).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Delete task" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("menuitem", { name: "Delete task" }));
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("closes on Escape and keeps the native menu inside the title input", () => {
    render(<TaskRow task={task} onChange={vi.fn(async () => undefined)} onDelete={vi.fn(async () => undefined)} />);
    const row = document.querySelector(".task-row")!;
    fireEvent.contextMenu(row);
    expect(screen.getByRole("menu")).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();

    // Inline editing keeps the native context menu for text operations.
    fireEvent.doubleClick(screen.getByRole("button", { name: task.title }));
    const input = document.querySelector(".edit-input")!;
    fireEvent.contextMenu(input);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });
});

describe("TaskRow compact variant", () => {
  afterEach(() => cleanup());

  it("uses the status glyph as the completion toggle and opens details from the title", () => {
    const onChange = vi.fn(async () => undefined);
    const onOpen = vi.fn();
    const onEdit = vi.fn();
    render(<TaskRow task={{ ...task, status: "in_progress" }} variant="compact" onOpen={onOpen} onEdit={onEdit} onChange={onChange} onDelete={vi.fn(async () => undefined)} />);

    const toggle = screen.getByRole("button", { name: "Mark Ship the fix complete" });
    expect(toggle).toHaveClass("status-toggle");
    expect(toggle.querySelector(".status-glyph-in_progress")).not.toBeNull();
    fireEvent.click(toggle);
    expect(onChange).toHaveBeenCalledWith({ ...task, status: "in_progress", completed: true });

    fireEvent.click(screen.getByRole("button", { name: task.title }));
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onEdit).not.toHaveBeenCalled();
  });

  it("opens the row menu from the more-actions button", () => {
    const onDelete = vi.fn(async () => undefined);
    render(<TaskRow task={task} variant="compact" onChange={vi.fn(async () => undefined)} onDelete={onDelete} />);
    fireEvent.click(screen.getByRole("button", { name: "More actions for Ship the fix" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete task" }));
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it("shows due, project and assignee metadata on one line", () => {
    const today = new Date();
    const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    render(<TaskRow task={{ ...task, dueDate: iso, projectId: "p", assigneeName: "Alex Rivera", priority: 2 }} project={{ name: "Launch", icon: null }} variant="compact" onChange={vi.fn(async () => undefined)} onDelete={vi.fn(async () => undefined)} />);
    expect(screen.getByText("Today").closest(".task-due-chip")).toHaveClass("due-today");
    expect(screen.getByText("Launch")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Alex Rivera" })).toHaveTextContent("AR");
    expect(screen.getByRole("img", { name: "Priority 2 · High" })).toBeInTheDocument();
  });
});
