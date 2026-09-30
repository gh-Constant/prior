import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { localStore } from "../lib/localStore";
import { QUICK_TASK_CREATED_EVENT } from "../lib/quickCapture";
import { QuickAddWindow } from "./QuickAddWindow";

describe("QuickAddWindow", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it("saves through the local store with the chosen flags and announces it", async () => {
    const created = vi.fn();
    window.addEventListener(QUICK_TASK_CREATED_EVENT, created);
    const save = vi.spyOn(localStore, "saveTask");
    render(<QuickAddWindow />);
    const input = screen.getByRole("textbox", { name: "Task title" });
    expect(document.activeElement).toBe(input);
    expect(screen.getByRole("button", { name: "Add task" })).toBeDisabled();
    fireEvent.change(input, { target: { value: "  Call the plumber " } });
    fireEvent.click(screen.getByRole("button", { name: "Important" }));
    expect(screen.getByRole("button", { name: "Important" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.submit(input.closest("form")!);
    await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({ title: "Call the plumber", important: true, urgent: false, status: "inbox" })));
    await waitFor(() => expect(created).toHaveBeenCalled());
    expect(input).toHaveValue("");
    expect((await localStore.listTasks()).map((task) => task.title)).toEqual(["Call the plumber"]);
    window.removeEventListener(QUICK_TASK_CREATED_EVENT, created);
  });

  it("clears the draft on Escape", () => {
    render(<QuickAddWindow />);
    const input = screen.getByRole("textbox", { name: "Task title" });
    fireEvent.change(input, { target: { value: "Draft" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(input).toHaveValue("");
  });
});
