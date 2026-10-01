import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initialPomodoro, pomodoroStore } from "../../lib/pomodoro";
import type { Task } from "../../types";
import { FocusView } from "./FocusView";

const task = (id: string, extra: Partial<Task> = {}): Task => ({ id, title: `Task ${id}`, description: "", dueDate: null, priority: 4, completed: false, important: true, urgent: false, createdAt: "2026-01-01", updatedAt: "2026-01-01", deletedAt: null, ...extra });

beforeEach(() => {
  localStorage.clear();
  pomodoroStore.set(initialPomodoro);
});
afterEach(cleanup);

describe("FocusView", () => {
  it("picks a suggested task, runs the timer and completes the task", async () => {
    const onTaskChange = vi.fn(() => Promise.resolve());
    render(<FocusView tasks={[task("a", { priority: 1 }), task("b")]} projects={[]} onTaskChange={onTaskChange} onTaskEdit={vi.fn()} />);

    expect(screen.getByRole("timer")).toHaveTextContent("25:00");
    fireEvent.click(screen.getByRole("button", { name: /Task a/ }));
    expect(pomodoroStore.get().taskId).toBe("a");
    expect(screen.getByRole("button", { name: "Task a" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    expect(pomodoroStore.get().endsAt).not.toBeNull();
    expect(screen.getByRole("button", { name: "Pause" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Mark as done/ }));
    await waitFor(() => expect(onTaskChange).toHaveBeenCalledWith(expect.objectContaining({ id: "a", completed: true, status: "done" })));
    await waitFor(() => expect(pomodoroStore.get().taskId).toBeNull());
  });

  it("switches phases and answers keyboard shortcuts", () => {
    render(<FocusView tasks={[]} projects={[]} onTaskChange={vi.fn()} onTaskEdit={vi.fn()} />);
    fireEvent.click(screen.getByRole("radio", { name: "Long break" }));
    expect(screen.getByRole("timer")).toHaveTextContent("15:00");
    fireEvent.keyDown(window, { key: " " });
    expect(pomodoroStore.get().endsAt).not.toBeNull();
    fireEvent.keyDown(window, { key: "f" });
    expect(document.querySelector(".focus-page")).toHaveClass("is-zen");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(document.querySelector(".focus-page")).not.toHaveClass("is-zen");
  });

  it("finds a task in the picker", () => {
    render(<FocusView tasks={[task("a"), task("b", { title: "Write the report" })]} projects={[]} onTaskChange={vi.fn()} onTaskEdit={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "All tasks" }));
    fireEvent.change(screen.getByRole("searchbox", { name: "Search tasks" }), { target: { value: "report" } });
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).queryByRole("button", { name: /Task a/ })).toBeNull();
    fireEvent.click(within(dialog).getByRole("button", { name: /Write the report/ }));
    expect(pomodoroStore.get().taskId).toBe("b");
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
