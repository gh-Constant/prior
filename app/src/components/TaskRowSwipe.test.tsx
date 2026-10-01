import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Task } from "../types";
import "../test/kanbanDrag";
import { TaskRow } from "./TaskRow";

const task: Task = {
  id: "t1", title: "Write the brief", description: "", dueDate: null, priority: 4, completed: false, important: false, urgent: false,
  createdAt: "2026-09-01T10:00:00.000Z", updatedAt: "2026-09-01T10:00:00.000Z", deletedAt: null,
};

function phone(matches: boolean): void {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: matches && query.includes("max-width: 760px"), media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
}

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ width: 400, height: 56, top: 0, left: 0, right: 400, bottom: 56, x: 0, y: 0, toJSON: () => ({}) });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function swipe(row: HTMLElement, distance: number): void {
  const touch = { pointerId: 3, pointerType: "touch", isPrimary: true, button: 0 };
  fireEvent.pointerDown(row, { ...touch, clientX: 100, clientY: 20 });
  fireEvent.pointerMove(row, { ...touch, clientX: 100 + distance / 3, clientY: 22 });
  fireEvent.pointerMove(row, { ...touch, clientX: 100 + distance, clientY: 22 });
  fireEvent.pointerUp(row, { ...touch, clientX: 100 + distance, clientY: 22 });
}

const rowOf = () => screen.getByText("Write the brief").closest(".task-row") as HTMLElement;

describe("TaskRow swipe actions (phone)", () => {
  it("completes the task when swiped right past a third of the row", () => {
    phone(true);
    const onChange = vi.fn(async () => {});
    render(<TaskRow task={task} variant="compact" onChange={onChange} onDelete={vi.fn(async () => {})} />);
    swipe(rowOf(), 220);
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ id: "t1", completed: true }));
  });

  it("springs back without acting on a short swipe", () => {
    phone(true);
    const onChange = vi.fn(async () => {});
    render(<TaskRow task={task} variant="compact" onChange={onChange} onDelete={vi.fn(async () => {})} />);
    swipe(rowOf(), 60);
    expect(onChange).not.toHaveBeenCalled();
    expect(rowOf().style.transform).toBe("");
  });

  it("opens the row menu as a sheet when swiped left past the threshold", () => {
    phone(true);
    render(<TaskRow task={task} variant="compact" onChange={vi.fn(async () => {})} onDelete={vi.fn(async () => {})} />);
    swipe(rowOf(), -220);
    expect(screen.getByRole("menu")).toHaveClass("is-sheet");
    expect(screen.getByRole("menuitem", { name: "Mark as complete" })).toBeInTheDocument();
  });

  it("ignores vertical drags so the list keeps scrolling", () => {
    phone(true);
    const onChange = vi.fn(async () => {});
    render(<TaskRow task={task} variant="compact" onChange={onChange} onDelete={vi.fn(async () => {})} />);
    const touch = { pointerId: 3, pointerType: "touch", isPrimary: true, button: 0 };
    fireEvent.pointerDown(rowOf(), { ...touch, clientX: 100, clientY: 20 });
    fireEvent.pointerMove(rowOf(), { ...touch, clientX: 105, clientY: 80 });
    fireEvent.pointerMove(rowOf(), { ...touch, clientX: 300, clientY: 90 });
    fireEvent.pointerUp(rowOf(), { ...touch, clientX: 300, clientY: 90 });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("does not wrap the row or react to swipes on desktop", () => {
    phone(false);
    const onChange = vi.fn(async () => {});
    const { container } = render(<TaskRow task={task} variant="compact" onChange={onChange} onDelete={vi.fn(async () => {})} />);
    expect(container.querySelector(".task-swipe")).toBeNull();
    swipe(rowOf(), 220);
    expect(onChange).not.toHaveBeenCalled();
  });
});
