import "@testing-library/jest-dom/vitest";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { AssigneeSelect, AssigneeStack } from "./AssigneeSelect";
import { ProjectCollaboration } from "./ProjectCollaboration";
import { TaskComposer } from "../TaskComposer";
import type { Person, ProjectCollaborationProps } from "./types";
import type { Project, TaskDraft } from "../../types";

afterEach(cleanup);

const people: Person[] = ["alex", "bea", "cleo", "dan", "eva"].map((id) => ({ id, name: id[0].toUpperCase() + id.slice(1), email: `${id}@example.com` }));

function Harness({ initial = [], onChange }: { initial?: string[]; onChange?: (ids: string[]) => void }) {
  const [value, setValue] = useState(initial);
  return <AssigneeSelect people={people} value={value} currentUserId="alex" onChange={(ids) => { setValue(ids); onChange?.(ids); }} />;
}

const option = (name: string) => screen.getByRole("option", { name: new RegExp(`^${name}`) });

describe("AssigneeSelect (several assignees)", () => {
  it("toggles members on and off without closing the menu, keeping the order of selection", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Assignees" }));
    expect(screen.getByRole("listbox", { name: "Assignees" })).toHaveAttribute("aria-multiselectable", "true");
    fireEvent.click(option("Cleo"));
    fireEvent.click(option("Bea"));
    expect(onChange).toHaveBeenLastCalledWith(["cleo", "bea"]);
    expect(option("Cleo")).toHaveAttribute("aria-selected", "true");
    expect(option("Dan")).toHaveAttribute("aria-selected", "false");
    // The menu is still open, and toggling a selected member removes only them.
    fireEvent.click(option("Cleo"));
    expect(onChange).toHaveBeenLastCalledWith(["bea"]);
    fireEvent.click(screen.getByRole("button", { name: "Unassign everyone" }));
    expect(onChange).toHaveBeenLastCalledWith([]);
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("lists the assigned people first, then me, then the others by name", () => {
    render(<Harness initial={["dan", "bea"]} />);
    fireEvent.click(screen.getByRole("button", { name: "Assignees" }));
    expect(screen.getAllByRole("option").map((item) => item.querySelector(".assignee-option > span:last-child")?.textContent?.replace(/\s*\(you\)$/i, ""))).toEqual(["Dan", "Bea", "Alex", "Cleo", "Eva"]);
  });

  it("summarizes the first assignee and the rest", () => {
    render(<Harness initial={["bea", "cleo", "dan"]} />);
    expect(screen.getByRole("button", { name: "Assignees" })).toHaveTextContent("Bea +2");
  });

  it("stops offering new people at the limit of 10", () => {
    const many: Person[] = Array.from({ length: 12 }, (_, index) => ({ id: `p${index}`, name: `Person ${String(index).padStart(2, "0")}`, email: `p${index}@example.com` }));
    render(<AssigneeSelect people={many} value={many.slice(0, 10).map((person) => person.id)} onChange={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: "Assignees" }));
    expect(screen.getByText("At most 10 assignees per task.")).toBeVisible();
    expect(screen.getByRole("option", { name: /Person 11/ })).toBeDisabled();
    expect(screen.getByRole("option", { name: /Person 00/ })).toBeEnabled();
  });

  it("shows at most three avatars, then +N", () => {
    const { container } = render(<AssigneeStack people={people} ids={["alex", "bea", "cleo", "dan", "eva"]} />);
    expect(container.querySelectorAll(".assignee-stack-item:not(.assignee-stack-more)")).toHaveLength(3);
    expect(within(container as HTMLElement).getByText("+2")).toBeVisible();
    cleanup();
    const small = render(<AssigneeStack people={people} ids={["alex", "bea", "cleo"]} />);
    expect(small.container.querySelector(".assignee-stack-more")).toBeNull();
  });
});

const states: ProjectCollaborationProps["states"] = [{ id: "todo", name: "To do", category: "unstarted" }, { id: "done", name: "Done", category: "completed" }];
const project: Project = { id: "project-1", name: "Launch", description: "", status: "active", areaId: null, createdAt: "", updatedAt: "", deletedAt: null };

describe("assigning issues in a project", () => {
  const props = (onAssignIssue: ProjectCollaborationProps["onAssignIssue"]): ProjectCollaborationProps => ({
    project,
    states,
    issues: [
      { id: "both", title: "Pair task", stateId: "todo", people: [], assigneeId: "bea", assigneeIds: ["bea", "alex"] },
      { id: "bea-only", title: "Bea's task", stateId: "todo", people: [], assigneeId: "bea", assigneeIds: ["bea"] },
      { id: "legacy", title: "Old data", stateId: "todo", people: [], assigneeId: "alex" },
      { id: "nobody", title: "Free task", stateId: "todo", people: [] },
    ],
    cycles: [],
    sharing: { members: people.slice(0, 2).map((person) => ({ ...person, role: "editor" as const })), invites: [], canManage: false },
    assignablePeople: people.slice(0, 3),
    currentUserId: "alex",
    readOnly: false,
    onAssignIssue,
  });

  it("filters Mine to every task I am one of the assignees of, and Unassigned to tasks nobody has", () => {
    render(<ProjectCollaboration {...props(vi.fn().mockResolvedValue(undefined))} />);
    fireEvent.click(screen.getByRole("tab", { name: "Issues" }));
    fireEvent.click(screen.getByRole("button", { name: "Mine" }));
    expect(screen.getByText("Pair task")).toBeVisible();
    expect(screen.getByText("Old data")).toBeVisible();
    expect(screen.queryByText("Bea's task")).not.toBeInTheDocument();
    expect(screen.queryByText("Free task")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Unassigned" }));
    expect(screen.getByText("Free task")).toBeVisible();
    expect(screen.queryByText("Pair task")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Only Bea's tasks" }));
    expect(screen.getByText("Pair task")).toBeVisible();
    expect(screen.getByText("Bea's task")).toBeVisible();
    expect(screen.queryByText("Old data")).not.toBeInTheDocument();
  });

  it("quick-assigns by toggling one person on a card and keeps the others", () => {
    const onAssignIssue = vi.fn().mockResolvedValue(undefined);
    render(<ProjectCollaboration {...props(onAssignIssue)} />);
    fireEvent.click(screen.getByRole("tab", { name: "Issues" }));
    fireEvent.click(screen.getByRole("button", { name: "Assignees of Pair task" }));
    fireEvent.click(screen.getByRole("option", { name: /^Cleo/ }));
    expect(onAssignIssue).toHaveBeenCalledWith("both", ["bea", "alex", "cleo"]);
    cleanup();
    // The card is controlled by its issue: toggling Bea removes only her.
    render(<ProjectCollaboration {...props(onAssignIssue)} />);
    fireEvent.click(screen.getByRole("tab", { name: "Issues" }));
    fireEvent.click(screen.getByRole("button", { name: "Assignees of Pair task" }));
    fireEvent.click(screen.getByRole("option", { name: /^Bea/ }));
    expect(onAssignIssue).toHaveBeenLastCalledWith("both", ["alex"]);
  });
});

describe("composer with several assignees", () => {
  it("saves every selected member, with assigneeId as the first", async () => {
    const onSave = vi.fn(async (_draft: TaskDraft) => undefined);
    render(<TaskComposer
      planning={{
        people: [{ ...people[0], role: "owner" }],
        availablePeople: people.slice(0, 3),
        assignablePeople: people.slice(0, 3),
        currentUserId: "alex",
        fields: [],
      }}
      onSave={onSave}
      onCancel={vi.fn()}
    />);
    fireEvent.change(screen.getByLabelText("Task title"), { target: { value: "Pair up" } });
    fireEvent.click(screen.getByRole("button", { name: "Assignees" }));
    fireEvent.click(screen.getByRole("option", { name: /^Cleo/ }));
    fireEvent.click(screen.getByRole("option", { name: /^Bea/ }));
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "Create task" }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0]?.[0]).toMatchObject({ title: "Pair up", assigneeId: "cleo", assigneeIds: ["cleo", "bea"] });
  });

  it("starts from the task's assignees and clears them all", async () => {
    const onSave = vi.fn(async (_draft: TaskDraft) => undefined);
    const task = { id: "t1", title: "Existing", description: "", dueDate: null, priority: 4 as const, completed: false, important: false, urgent: false, createdAt: "", updatedAt: "", deletedAt: null, assigneeId: "bea", assigneeIds: ["bea", "cleo"] };
    render(<TaskComposer
      task={task}
      planning={{ people: [{ ...people[0], role: "owner" }], availablePeople: people.slice(0, 3), assignablePeople: people.slice(0, 3), currentUserId: "alex", fields: [] }}
      onSave={onSave}
      onCancel={vi.fn()}
    />);
    expect(screen.getByRole("button", { name: "Assignees" })).toHaveTextContent("Bea +1");
    fireEvent.click(screen.getByRole("button", { name: "Assignees" }));
    fireEvent.click(screen.getByRole("button", { name: "Unassign everyone" }));
    fireEvent.click(screen.getByRole("button", { name: /Save/ }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0]?.[0]).toMatchObject({ assigneeId: null, assigneeIds: [] });
  });
});
