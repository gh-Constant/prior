import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Task } from "../types";
import { CommandPalette, isPaletteShortcut } from "./CommandPalette";

const task: Task = { id: "t1", title: "Renew passport", description: "", dueDate: null, priority: 4, completed: false, important: false, urgent: false, createdAt: "", updatedAt: "", deletedAt: null };

beforeEach(() => localStorage.clear());
afterEach(() => cleanup());

describe("command palette", () => {
  it("uses ⌘K on Apple platforms and Ctrl+K elsewhere, never Ctrl+K on a Mac", () => {
    expect(isPaletteShortcut({ key: "k", metaKey: true, ctrlKey: false, altKey: false, shiftKey: false }, true)).toBe(true);
    expect(isPaletteShortcut({ key: "k", metaKey: false, ctrlKey: true, altKey: false, shiftKey: false }, true)).toBe(false);
    expect(isPaletteShortcut({ key: "K", metaKey: false, ctrlKey: true, altKey: false, shiftKey: false }, false)).toBe(true);
    expect(isPaletteShortcut({ key: "k", metaKey: false, ctrlKey: true, altKey: false, shiftKey: true }, false)).toBe(false);
  });

  it("is a keyboard-driven combobox that runs commands and opens tasks", () => {
    const run = vi.fn();
    const onOpenTask = vi.fn();
    const onClose = vi.fn();
    render(<CommandPalette tasks={[task]} habits={[]} notes={[]} projects={[]} commands={[{ id: "new-task", label: "New task", icon: "plus", run }, { id: "theme-dark", label: "Use the dark theme", icon: "moon", run: vi.fn() }]} onOpenTask={onOpenTask} onOpenHabit={vi.fn()} onOpenNote={vi.fn()} onOpenProject={vi.fn()} onClose={onClose} />);
    const input = screen.getByRole("combobox", { name: "Search and commands" });
    expect(document.activeElement).toBe(input);
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Commands" })).toBeInTheDocument();
    const options = screen.getAllByRole("option");
    expect(options[0]).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(input).toHaveAttribute("aria-activedescendant", screen.getAllByRole("option")[1].id);
    fireEvent.keyDown(input, { key: "ArrowUp" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(run).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalled();

    fireEvent.change(input, { target: { value: "passp" } });
    expect(screen.getByRole("group", { name: "Tasks" })).toBeInTheDocument();
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onOpenTask).toHaveBeenCalledWith(task);
    fireEvent.change(input, { target: { value: "zzzz" } });
    expect(screen.getByRole("status")).toHaveTextContent("No results");
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it("lists recently opened items first", () => {
    const props = { tasks: [task], habits: [], notes: [], projects: [], commands: [], onOpenTask: vi.fn(), onOpenHabit: vi.fn(), onOpenNote: vi.fn(), onOpenProject: vi.fn(), onClose: vi.fn() };
    const { unmount } = render(<CommandPalette {...props} />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "renew" } });
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Enter" });
    unmount();
    render(<CommandPalette {...props} />);
    expect(screen.getByRole("group", { name: "Recent" })).toHaveTextContent("Renew passport");
  });
});
