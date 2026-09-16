import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
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
