import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { TaskComposer } from "./TaskComposer";
import type { Area, Project, Task, TaskDraft } from "../types";
import type { TaskPlanningProps } from "./collaboration/types";

afterEach(cleanup);

const timestamps = { createdAt: "2026-01-01", updatedAt: "2026-01-01", deletedAt: null };
const areas: Area[] = [
  { id: "a", name: "Work", color: "red", ...timestamps },
  { id: "b", name: "Home", color: "blue", ...timestamps },
];
const projects: Project[] = [
  { id: "p1", name: "Launch", areaId: "a", description: "", status: "active", ...timestamps },
  { id: "p2", name: "Website", areaId: "a", description: "", status: "active", ...timestamps },
];
const task: Task = { id: "t", title: "Draft", description: "Notes", dueDate: null, priority: 4, important: true, urgent: false, completed: false, projectId: "p1", areaId: "a", status: "next", ...timestamps };
const alice = { id: "alice", name: "Alice", role: "owner" as const };
const bob = { id: "bob", name: "Bob", role: "collaborator" as const };
function planningProps(): TaskPlanningProps {
  return {
    people: [alice], availablePeople: [alice, bob],
    fields: [
      { key: "state", label: "Workflow state", options: [{ id: "next", name: "Todo" }], selectedIds: ["next"] },
      { key: "project", label: "Planning project", options: [{ id: "p1", name: "Launch" }], selectedIds: ["p1"] },
      { key: "labels", label: "Labels", options: [{ id: "bug", name: "Bug" }, { id: "ui", name: "UI" }], selectedIds: [] },
    ],
    onPeopleChange: vi.fn(), onFieldChange: vi.fn(),
  };
}

describe("compact TaskComposer", () => {
  it.each(["inbox", "backlog", "next", "in_progress", "waiting", "done"])("uses one workflow picker and saves %s", async (status) => {
    const planning = planningProps();
    const onSave = vi.fn(async (_draft: TaskDraft) => undefined);
    render(<TaskComposer task={task} planning={planning} projects={projects} onSave={onSave} onCancel={vi.fn()} />);
    expect(screen.queryByLabelText("Workflow state")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Planning project")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Status"), { target: { value: status } });
    expect(planning.onFieldChange).toHaveBeenCalledWith("state", [status]);
    fireEvent.click(screen.getByRole("button", { name: "Save task" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Task saved."));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ status }));
  });

  it("keeps secondary fields collapsed and preserves delegation, dates, flags, and planning callbacks", async () => {
    const planning = planningProps();
    const onSave = vi.fn(async (_draft: TaskDraft) => undefined);
    render(<TaskComposer task={task} areas={areas} projects={projects} planning={planning} onSave={onSave} onCancel={vi.fn()} />);
    const details = screen.getByText(/More options/).closest("details")!;
    expect(details).not.toHaveAttribute("open");
    // Priority and Due date stay in the primary row, outside the disclosure.
    expect(screen.getByLabelText("Priority").closest("details")).toBeNull();
    expect(screen.getByLabelText("Due date").closest("details")).toBeNull();
    fireEvent.change(screen.getByLabelText("Due date"), { target: { value: "2026-10-03" } });
    fireEvent.click(screen.getByText(/More options/));
    expect(details).toHaveAttribute("open");
    fireEvent.change(screen.getByLabelText("Assignee"), { target: { value: "  Sam  " } });
    fireEvent.change(screen.getByLabelText("Follow up"), { target: { value: "2026-10-02" } });
    fireEvent.change(screen.getByLabelText("Task description"), { target: { value: "Notes v2" } });
    fireEvent.click(screen.getByRole("button", { name: "Urgent" }));
    const labels = screen.getByLabelText("Labels") as HTMLSelectElement;
    Array.from(labels.options).forEach((option) => { option.selected = true; });
    fireEvent.change(labels);
    expect(planning.onFieldChange).toHaveBeenCalledWith("labels", ["bug", "ui"]);
    fireEvent.click(screen.getByRole("button", { name: "Save task" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Task saved."));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ assigneeName: "Sam", followUpDate: "2026-10-02", dueDate: "2026-10-03", description: "Notes v2", important: true, urgent: true, peopleIds: ["alice"] }));
  });

  it("preserves local people on the same project and replaces them after a project switch", async () => {
    const planning = planningProps();
    const unlockedPlanning = { ...planning, fields: planning.fields.filter((field) => field.key !== "project") };
    const onSave = vi.fn(async (_draft: TaskDraft) => undefined);
    const onProjectChange = vi.fn();
    const props = { projects, planning: unlockedPlanning, onSave, onProjectChange, onCancel: vi.fn() };
    const { rerender } = render(<TaskComposer {...props} />);
    fireEvent.click(screen.getByText(/More options/));
    fireEvent.click(screen.getByText("Add people", { selector: "summary" }));
    fireEvent.click(screen.getByRole("button", { name: "Bob" }));
    expect(planning.onPeopleChange).toHaveBeenCalledWith([alice, bob]);
    rerender(<TaskComposer {...props} planning={{ ...unlockedPlanning, people: [...unlockedPlanning.people] }} />);
    expect(screen.getByLabelText("Task role for Bob")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Project"), { target: { value: "p2" } });
    expect(onProjectChange).toHaveBeenCalledWith("p2");
    expect(planning.onFieldChange).toHaveBeenCalledWith("project", ["p2"]);
    expect(screen.queryByLabelText("Task role for Alice")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Bob" })).not.toBeInTheDocument();
    const cara = { id: "cara", name: "Cara", role: "owner" as const };
    rerender(<TaskComposer {...props} planning={{ ...unlockedPlanning, people: [cara], availablePeople: [cara] }} />);
    expect(screen.getByLabelText("Task role for Cara")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Task title"), { target: { value: "Launch site" } });
    fireEvent.click(screen.getByRole("button", { name: "Create task" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ projectId: "p2", peopleIds: ["cara"] })));
  });

  it("notifies project changes when an area clears the selected project", () => {
    const planning = planningProps();
    const unlockedPlanning = { ...planning, fields: planning.fields.filter((field) => field.key !== "project") };
    const onProjectChange = vi.fn();
    render(<TaskComposer areas={areas} projects={projects} planning={unlockedPlanning} onProjectChange={onProjectChange} onSave={vi.fn()} onCancel={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Project"), { target: { value: "p1" } });
    expect(onProjectChange).toHaveBeenCalledWith("p1");
    fireEvent.click(screen.getByText(/More options/));
    fireEvent.change(screen.getByLabelText("Area"), { target: { value: "b" } });
    expect(screen.getByLabelText("Project")).toHaveValue("");
    expect(onProjectChange).toHaveBeenCalledWith(null);
    expect(planning.onFieldChange).toHaveBeenCalledWith("project", []);
  });

  it("guards duplicate submission and retains the draft on failure for retry", async () => {
    let rejectSave!: (reason: Error) => void;
    const onSave = vi.fn().mockImplementationOnce(() => new Promise<void>((_resolve, reject) => { rejectSave = reject; })).mockResolvedValue(undefined);
    render(<TaskComposer onSave={onSave} onCancel={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Task title"), { target: { value: "Keep me" } });
    const form = screen.getByLabelText("Task title").closest("form")!;
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();
    expect(screen.getByLabelText("Task title")).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent("Saving task");
    await act(async () => rejectSave(new Error("Network unavailable")));
    expect(screen.getByRole("alert")).toHaveTextContent("Could not save");
    expect(screen.getByLabelText("Task title")).toHaveValue("Keep me");
    fireEvent.click(screen.getByRole("button", { name: "Create task" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Task created."));
    expect(onSave).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(screen.getByLabelText("Task title")).toHaveValue(""));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("saves an empty people list when moving out of a project removes planning", async () => {
    const planning = planningProps();
    const unlockedPlanning = { ...planning, fields: planning.fields.filter((field) => field.key !== "project") };
    const onSave = vi.fn(async (_draft: TaskDraft) => undefined);
    const props = { projects, onSave, onProjectChange: vi.fn(), onCancel: vi.fn() };
    const { rerender } = render(<TaskComposer {...props} planning={unlockedPlanning} />);
    fireEvent.change(screen.getByLabelText("Project"), { target: { value: "p1" } });
    fireEvent.change(screen.getByLabelText("Project"), { target: { value: "" } });
    rerender(<TaskComposer {...props} />);
    fireEvent.change(screen.getByLabelText("Task title"), { target: { value: "Solo" } });
    fireEvent.click(screen.getByRole("button", { name: "Create task" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Task created."));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ projectId: null, peopleIds: [] }));
  });

  it("hides project, area, and status implied by the creation context but still saves them", async () => {
    const onSave = vi.fn(async (_draft: TaskDraft) => undefined);
    render(<TaskComposer areas={areas} projects={projects} initialContext={{ projectId: "p1", status: "backlog" }} onSave={onSave} onCancel={vi.fn()} />);
    expect(screen.queryByLabelText("Project")).not.toBeInTheDocument();
    expect(screen.queryByText("No project")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Area")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Status")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Priority")).toBeInTheDocument();
    expect(screen.getByLabelText("Due date")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Task title"), { target: { value: "Build it" } });
    fireEvent.click(screen.getByRole("button", { name: "Create task" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Task created."));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ title: "Build it", projectId: "p1", areaId: "a", status: "backlog" }));
  });

  it("hides the area field when the area is locked by context", () => {
    render(<TaskComposer areas={areas} projects={projects} initialContext={{ areaId: "a" }} onSave={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.queryByLabelText("Area")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Project")).toBeInTheDocument();
  });

  it("hides the project field when planning already pins the project", () => {
    render(<TaskComposer projects={projects} planning={planningProps()} onSave={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.queryByLabelText("Project")).not.toBeInTheDocument();
    expect(screen.queryByText("No project")).not.toBeInTheDocument();
  });

  it("keeps every optional field behind a single collapsed More options section", () => {
    render(<TaskComposer areas={areas} projects={projects} planning={planningProps()} onSave={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.queryByText("More details", { selector: "summary" })).not.toBeInTheDocument();
    const details = screen.getByText(/More options/).closest("details")!;
    expect(details).not.toHaveAttribute("open");
    // Description and assignee sit on the main surface; the rest stays tucked away.
    for (const label of ["Task description", "Assignee"]) {
      expect(screen.getByLabelText(label).closest("details")).toBeNull();
    }
    for (const label of ["Follow up", "Labels"]) {
      expect(screen.getByLabelText(label).closest("details")).not.toHaveAttribute("open");
    }
    expect(screen.getByRole("region", { name: "Task people" }).closest("details")).not.toHaveAttribute("open");
    fireEvent.click(screen.getByText(/More options/));
    expect(details).toHaveAttribute("open");
  });

  it("shows the project breadcrumb and submits with Ctrl/Cmd + Enter", async () => {
    const onSave = vi.fn(async (_draft: TaskDraft) => undefined);
    render(<TaskComposer projects={projects} initialContext={{ projectId: "p1" }} onSave={onSave} onCancel={vi.fn()} />);
    const breadcrumb = screen.getByRole("navigation", { name: "Task location" });
    expect(breadcrumb).toHaveTextContent("Launch");
    expect(breadcrumb).toHaveTextContent("New task");
    fireEvent.change(screen.getByLabelText("Task title"), { target: { value: "Keyboard only" } });
    fireEvent.keyDown(screen.getByLabelText("Task title"), { key: "Enter", ctrlKey: true });
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ title: "Keyboard only", projectId: "p1" })));
  });

  it("keeps the sheet in its creation context when Create more is on", async () => {
    const onSave = vi.fn(async (_draft: TaskDraft, _options?: { keepOpen: boolean }) => undefined);
    render(<TaskComposer areas={areas} projects={projects} initialContext={{ projectId: "p1", status: "backlog" }} allowCreateMore onSave={onSave} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByRole("switch", { name: "Create more" }));
    fireEvent.change(screen.getByLabelText("Task title"), { target: { value: "First" } });
    fireEvent.click(screen.getByRole("button", { name: "Create task" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ title: "First", projectId: "p1", status: "backlog" }), { keepOpen: true }));
    await waitFor(() => expect(screen.getByLabelText("Task title")).toHaveValue(""));
    fireEvent.change(screen.getByLabelText("Task title"), { target: { value: "Second" } });
    fireEvent.click(screen.getByRole("button", { name: "Create task" }));
    await waitFor(() => expect(onSave).toHaveBeenLastCalledWith(expect.objectContaining({ title: "Second", projectId: "p1", areaId: "a", status: "backlog" }), { keepOpen: true }));
  });

  it("does not offer Create more when editing", () => {
    render(<TaskComposer task={task} projects={projects} allowCreateMore onSave={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.queryByRole("switch", { name: "Create more" })).not.toBeInTheDocument();
  });

  it("allows viewers to inspect details but disables all mutations and guards direct submission", () => {
    const planning = { ...planningProps(), readOnly: true };
    const onSave = vi.fn();
    const onCancel = vi.fn();
    render(<TaskComposer task={task} planning={planning} projects={projects} areas={areas} onSave={onSave} onCancel={onCancel} />);
    fireEvent.click(screen.getByText(/More options/));
    expect(screen.getByRole("region", { name: "Task people" })).toBeInTheDocument();
    const dialog = screen.getByRole("dialog");
    dialog.querySelectorAll("input, textarea, select").forEach((control) => expect(control).toBeDisabled());
    expect(within(dialog).getByRole("button", { name: "Save task" })).toBeDisabled();
    expect(within(dialog).getByRole("button", { name: "Important" })).toBeDisabled();
    fireEvent.submit(dialog.querySelector("form")!);
    expect(onSave).not.toHaveBeenCalled();
    expect(planning.onPeopleChange).not.toHaveBeenCalled();
    expect(planning.onFieldChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
