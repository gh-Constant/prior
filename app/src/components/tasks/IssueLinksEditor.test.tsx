import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { IssueLinksEditor, descendantIds } from "./IssueLinksEditor";
import type { Task } from "../../types";

afterEach(cleanup);

const now = new Date().toISOString();
const make = (id: string, extra: Partial<Task> = {}): Task => ({ id, title: `Task ${id}`, description: "", dueDate: null, priority: 4, projectId: "p1", completed: false, important: false, urgent: false, createdAt: now, updatedAt: now, deletedAt: null, ...extra });

describe("task links", () => {
  it("finds every descendant so a task cannot become its own ancestor", () => {
    const tasks = [make("a"), make("b", { parentId: "a" }), make("c", { parentId: "b" }), make("d")];
    expect([...descendantIds("a", tasks)].sort()).toEqual(["a", "b", "c"]);
  });

  it("offers parents and blockers from the same project and lists sub-tasks", async () => {
    const tasks = [make("a"), make("b", { parentId: "a", completed: true }), make("x", { projectId: "p2" }), make("c")];
    const onBlockedByChange = vi.fn();
    const onCreateSubtask = vi.fn().mockResolvedValue(undefined);
    render(<IssueLinksEditor task={tasks[0]} projectId="p1" tasks={tasks} milestones={[{ id: "m1", name: "Beta" }]} parentId={null} milestoneId={null} blockedBy={["c"]} onParentChange={vi.fn()} onMilestoneChange={vi.fn()} onBlockedByChange={onBlockedByChange} onCreateSubtask={onCreateSubtask} />);
    // b is a's child, x is in another project: neither can be a's parent.
    const parentOptions = [...(screen.getByLabelText("Parent task") as HTMLSelectElement).options].map((option) => option.value);
    expect(parentOptions).toEqual(["", "c"]);
    expect(screen.getByLabelText("Milestone")).toBeInTheDocument();
    expect(screen.getByText("Task b")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Remove “Task c” from blockers" }));
    expect(onBlockedByChange).toHaveBeenCalledWith([]);
    fireEvent.change(screen.getByLabelText("New sub-task"), { target: { value: "Write tests" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(onCreateSubtask).toHaveBeenCalledWith("Write tests");
  });
});
