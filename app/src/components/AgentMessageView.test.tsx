import { describe, expect, it, vi, afterEach, beforeEach } from "vitest";
import type { AgentMessage, ProposedArea, ProposedEntityUpdate, ProposedFolder, ProposedHabit, ProposedNote, ProposedProject, ProposedTask, ProposedTaskUpdate } from "../types";
import {
  AssistantMessage,
  areaDraftOf,
  folderDraftOf,
  getQuadrantBadge,
  habitDraftOf,
  markAreasAdded,
  markFoldersAdded,
  markHabitsAdded,
  markNotesAdded,
  markProjectsAdded,
  markTasksAdded,
  markTaskUpdatesApplied,
  noteDraftOf,
  projectDraftOf,
  taskDraftOf,
  updateAreaProposal,
  updateFolderProposal,
  updateHabitProposal,
  updateNoteProposal,
  updateProjectProposal,
  updateTaskProposal,
} from "./AgentMessageView";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { EMPTY_CONTEXT, type ProposalContext } from "./agent/reviewModel";

afterEach(() => cleanup());

function makeArea(overrides: Partial<ProposedArea> = {}): ProposedArea {
  return {
    id: "area-1",
    name: "Work",
    reasoning: "Career and projects",
    selected: true,
    added: false,
    ...overrides,
  };
}

function makeProject(overrides: Partial<ProposedProject> = {}): ProposedProject {
  return {
    id: "project-1",
    name: "App Launch",
    areaName: "Work",
    description: "Launch v1 to public",
    status: "active",
    reasoning: "Main Q3 priority",
    selected: true,
    added: false,
    ...overrides,
  };
}

function makeTask(overrides: Partial<ProposedTask> = {}): ProposedTask {
  return {
    id: "task-1",
    title: "Write report",
    description: "Quarterly numbers",
    dueDate: null,
    priority: 2,
    important: true,
    urgent: false,
    reasoning: "High impact",
    selected: true,
    added: false,
    ...overrides,
  };
}

function makeHabit(overrides: Partial<ProposedHabit> = {}): ProposedHabit {
  return {
    id: "habit-1",
    title: "Morning run",
    important: false,
    urgent: false,
    interval: 1,
    unit: "day",
    reasoning: "",
    selected: true,
    added: false,
    ...overrides,
  };
}

function makeNote(overrides: Partial<ProposedNote> = {}): ProposedNote {
  return {
    id: "note-1",
    title: "Sprint review",
    folderName: "Projects",
    bodyMarkdown: "## Decisions\n\n- [ ] Ship\n\n| A | B |\n| --- | --- |\n| 1 | 2 |",
    favorite: false,
    reasoning: "Captures the meeting",
    selected: true,
    added: false,
    ...overrides,
  };
}

function makeFolder(overrides: Partial<ProposedFolder> = {}): ProposedFolder {
  return {
    id: "folder-1",
    name: "Projects",
    parentName: null,
    reasoning: "Groups work",
    selected: true,
    added: false,
    ...overrides,
  };
}

function makeMessage(overrides: Partial<AgentMessage> = {}): AgentMessage {
  return {
    id: "msg-1",
    role: "assistant",
    content: "Here is the plan",
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("proposal updaters", () => {
  const messages = [makeMessage({ proposedTasks: [makeTask(), makeTask({ id: "task-2", added: true })] })];

  it("toggles a single task flag without touching other messages", () => {
    const other = makeMessage({ id: "msg-2" });
    const next = updateTaskProposal([...messages, other], "msg-1", "task-1", (task) => ({ ...task, urgent: true }));
    expect(next[0].proposedTasks?.[0].urgent).toBe(true);
    expect(next[0].proposedTasks?.[1].added).toBe(true);
    expect(next[1]).toBe(other);
  });

  it("marks added tasks by id set", () => {
    const next = markTasksAdded(messages, "msg-1", new Set(["task-1"]));
    expect(next[0].proposedTasks?.map((task) => task.added)).toEqual([true, true]);
  });

  it("leaves messages without proposals untouched", () => {
    const bare = [makeMessage()];
    expect(updateTaskProposal(bare, "msg-1", "task-1", (task) => task)).toEqual(bare);
    expect(markTasksAdded(bare, "msg-1", new Set(["task-1"]))).toEqual(bare);
  });

  it("updates and marks habits", () => {
    const withHabits = [makeMessage({ proposedHabits: [makeHabit()] })];
    const updated = updateHabitProposal(withHabits, "msg-1", "habit-1", { important: true });
    expect(updated[0].proposedHabits?.[0].important).toBe(true);
    const marked = markHabitsAdded(withHabits, "msg-1", new Set(["habit-1"]));
    expect(marked[0].proposedHabits?.[0].added).toBe(true);
  });

  it("updates and marks notes and folders", () => {
    const withNotes = [makeMessage({ proposedNotes: [makeNote()], proposedFolders: [makeFolder()] })];
    const updatedNote = updateNoteProposal(withNotes, "msg-1", "note-1", { favorite: true });
    expect(updatedNote[0].proposedNotes?.[0].favorite).toBe(true);
    const markedNote = markNotesAdded(withNotes, "msg-1", new Set(["note-1"]));
    expect(markedNote[0].proposedNotes?.[0].added).toBe(true);
    const updatedFolder = updateFolderProposal(withNotes, "msg-1", "folder-1", { selected: false });
    expect(updatedFolder[0].proposedFolders?.[0].selected).toBe(false);
    const markedFolder = markFoldersAdded(withNotes, "msg-1", new Set(["folder-1"]));
    expect(markedFolder[0].proposedFolders?.[0].added).toBe(true);
  });

  it("builds drafts with only persistable fields", () => {
    expect(taskDraftOf(makeTask())).toEqual({
      title: "Write report",
      description: "Quarterly numbers",
      dueDate: null,
      priority: 2,
      important: true,
      urgent: false,
    });
    expect(habitDraftOf(makeHabit())).toEqual({
      title: "Morning run",
      important: false,
      urgent: false,
      interval: 1,
      unit: "day",
      endDate: null,
      daysOfWeek: [],
    });
    expect(noteDraftOf(makeNote())).toEqual({
      title: "Sprint review",
      folderName: "Projects",
      bodyMarkdown: "## Decisions\n\n- [ ] Ship\n\n| A | B |\n| --- | --- |\n| 1 | 2 |",
      favorite: false,
    });
    expect(folderDraftOf(makeFolder())).toEqual({ name: "Projects", parentName: null });
    expect(areaDraftOf(makeArea())).toEqual({ name: "Work", color: undefined, icon: undefined });
    expect(projectDraftOf(makeProject())).toEqual({ name: "App Launch", areaName: "Work", description: "Launch v1 to public", status: "active", targetDate: undefined, icon: undefined });
  });

  it("updates and marks areas and projects as added", () => {
    const area = makeArea({ id: "a1" });
    const project = makeProject({ id: "p1" });
    const msg = makeMessage({ proposedAreas: [area], proposedProjects: [project] });

    const updatedArea = updateAreaProposal([msg], "msg-1", "a1", { selected: false });
    expect(updatedArea[0].proposedAreas?.[0].selected).toBe(false);

    const markedArea = markAreasAdded([msg], "msg-1", new Set(["a1"]));
    expect(markedArea[0].proposedAreas?.[0].added).toBe(true);

    const updatedProject = updateProjectProposal([msg], "msg-1", "p1", { selected: false });
    expect(updatedProject[0].proposedProjects?.[0].selected).toBe(false);

    const markedProject = markProjectsAdded([msg], "msg-1", new Set(["p1"]));
    expect(markedProject[0].proposedProjects?.[0].added).toBe(true);
  });

  it("maps importance/urgency to quadrants", () => {
    expect(getQuadrantBadge({ important: true, urgent: true }).key).toBe("focus");
    expect(getQuadrantBadge({ important: true, urgent: false }).key).toBe("plan");
    expect(getQuadrantBadge({ important: false, urgent: true }).key).toBe("quick");
    expect(getQuadrantBadge({ important: false, urgent: false }).key).toBe("later");
  });
});

describe("AssistantMessage", () => {
  const handlers = {
    addingIds: {},
    onUpdateArea: vi.fn(),
    onAddSingleArea: vi.fn(),
    onAddAllAreas: vi.fn(),
    onUpdateProject: vi.fn(),
    onAddSingleProject: vi.fn(),
    onAddAllProjects: vi.fn(),
    onToggleTaskSelect: vi.fn(),
    onToggleTaskImportant: vi.fn(),
    onToggleTaskUrgent: vi.fn(),
    onAddSingleTask: vi.fn(),
    onAddAllTasks: vi.fn(),
    onUpdateHabit: vi.fn(),
    onAddSingleHabit: vi.fn(),
    onAddAllHabits: vi.fn(),
    onUpdateNote: vi.fn(),
    onAddSingleNote: vi.fn(),
    onAddAllNotes: vi.fn(),
    onUpdateFolder: vi.fn(),
    onAddSingleFolder: vi.fn(),
    onAddAllFolders: vi.fn(),
    onUpdateTaskUpdate: vi.fn(),
    onApplyTaskUpdate: vi.fn(),
    onApplyAllTaskUpdates: vi.fn(),
    onUpdateEntityUpdate: vi.fn(),
    onApplyEntityUpdate: vi.fn(),
    onApplyAllEntityUpdates: vi.fn(),
  };

  beforeEach(() => {
    localStorage.clear();
    vi.resetAllMocks();
  });

  it("renders user messages without proposals", () => {
    render(<AssistantMessage message={makeMessage({ role: "user", content: "hello" })} handlers={handlers} />);
    expect(screen.getByText("hello")).toBeDefined();
    expect(screen.queryByRole("region", { name: "Proposed changes" })).toBeNull();
  });

  it("renders task proposals as rows with quadrant, priority, status, project and the selected apply count", async () => {
    render(<AssistantMessage message={makeMessage({ proposedTasks: [makeTask({ status: "waiting", projectName: "App Launch", assigneeName: "Dev Team" }), makeTask({ id: "task-2", title: "Second", selected: false, important: false, urgent: true, reasoning: "" })] })} handlers={handlers} />);
    expect(screen.getByRole("region", { name: "Proposed changes" })).toBeDefined();
    expect(screen.getByText("2 new tasks")).toBeDefined();
    expect(screen.getByText("Write report")).toBeDefined();
    expect(screen.getByText("Plan (Schedule)")).toBeDefined();
    expect(screen.getByText("Quick (Delegate)")).toBeDefined();
    expect(screen.getByText("High impact")).toBeDefined();
    expect(screen.getByText("Waiting")).toBeDefined();
    expect(screen.getByText("App Launch")).toBeDefined();
    expect(screen.getByText("Waiting on Dev Team")).toBeDefined();
    expect(screen.getByText("1 of 2 selected")).toBeDefined();
    // Only the ticked task is applied by the bar.
    fireEvent.click(screen.getByRole("button", { name: "Apply 1" }));
    await waitFor(() => expect(handlers.onAddAllTasks).toHaveBeenCalledTimes(1));
    expect(handlers.onAddAllTasks).toHaveBeenCalledWith("msg-1", [expect.objectContaining({ id: "task-1" })]);
  });

  it("toggles a proposal with its round check and keeps unticked rows out of Apply all", () => {
    render(<AssistantMessage message={makeMessage({ proposedTasks: [makeTask(), makeTask({ id: "task-2", title: "Second", selected: false })] })} handlers={handlers} />);
    const second = screen.getByRole("checkbox", { name: "Include “Second”" }) as HTMLInputElement;
    expect(second.checked).toBe(false);
    fireEvent.click(second);
    expect(handlers.onToggleTaskSelect).toHaveBeenCalledWith("msg-1", "task-2");
  });

  it("applies areas and projects before everything else, in order", async () => {
    const calls: string[] = [];
    handlers.onAddAllAreas.mockImplementation(async () => { calls.push("areas"); });
    handlers.onAddAllProjects.mockImplementation(async () => { calls.push("projects"); });
    handlers.onAddAllTasks.mockImplementation(async () => { calls.push("tasks"); });
    render(<AssistantMessage message={makeMessage({ proposedTasks: [makeTask()], proposedAreas: [makeArea()], proposedProjects: [makeProject()] })} handlers={handlers} />);
    expect(screen.getByText("1 new area · 1 new project · 1 new task")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Apply all" }));
    await waitFor(() => expect(calls).toEqual(["areas", "projects", "tasks"]));
  });

  it("stops Apply all when a step fails", async () => {
    handlers.onAddAllProjects.mockRejectedValue(new Error("nope"));
    render(<AssistantMessage message={makeMessage({ proposedTasks: [makeTask()], proposedProjects: [makeProject()] })} handlers={handlers} />);
    fireEvent.click(screen.getByRole("button", { name: "Apply all" }));
    await waitFor(() => expect(handlers.onAddAllProjects).toHaveBeenCalledTimes(1));
    await waitFor(() => expect((screen.getByRole("button", { name: "Apply all" }) as HTMLButtonElement).disabled).toBe(false));
    expect(handlers.onAddAllTasks).not.toHaveBeenCalled();
  });

  it("renders area and project proposals with single apply actions", () => {
    render(<AssistantMessage message={makeMessage({ proposedAreas: [makeArea()], proposedProjects: [makeProject()] })} handlers={handlers} />);
    expect(screen.getByText("Work", { selector: ".review-title" })).toBeDefined();
    expect(screen.getByText("App Launch")).toBeDefined();
    expect(screen.getByText("New areas")).toBeDefined();
    fireEvent.click(screen.getByTitle("Add area to Prior"));
    expect(handlers.onAddSingleArea).toHaveBeenCalledWith("msg-1", expect.objectContaining({ id: "area-1" }));
    fireEvent.click(screen.getByTitle("Add project to Prior"));
    expect(handlers.onAddSingleProject).toHaveBeenCalledWith("msg-1", expect.objectContaining({ id: "project-1" }));
  });

  it("forwards flag toggles and single-add interactions", () => {
    render(<AssistantMessage message={makeMessage({ proposedTasks: [makeTask()] })} handlers={handlers} />);
    fireEvent.click(screen.getByLabelText("Mark urgent"));
    expect(handlers.onToggleTaskUrgent).toHaveBeenCalledWith("msg-1", "task-1");
    fireEvent.click(screen.getByLabelText("Remove important flag"));
    expect(handlers.onToggleTaskImportant).toHaveBeenCalledWith("msg-1", "task-1");
    fireEvent.click(screen.getByTitle("Add task to Prior"));
    expect(handlers.onAddSingleTask).toHaveBeenCalledTimes(1);
  });

  it("shows an Added badge instead of the add button once added, and folds the panel when all is applied", () => {
    render(<AssistantMessage message={makeMessage({ proposedTasks: [makeTask({ added: true })] })} handlers={handlers} />);
    expect(screen.getByText("Added")).toBeDefined();
    expect(screen.queryByTitle("Add task to Prior")).toBeNull();
    expect(screen.getByText("All applied")).toBeDefined();
    const toggle = screen.getByRole("button", { name: "Show details" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(toggle);
    expect(screen.getByRole("button", { name: "Hide details" }).getAttribute("aria-expanded")).toBe("true");
    expect(screen.queryByRole("button", { name: /^Apply/ })).toBeNull();
  });

  it("dismisses the proposals and brings them back", () => {
    render(<AssistantMessage message={makeMessage({ proposedTasks: [makeTask()] })} handlers={handlers} />);
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.getByText("Proposals dismissed")).toBeDefined();
    expect(screen.queryByText("Write report")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show again" }));
    expect(screen.getByText("Write report")).toBeDefined();
  });

  it("edits a proposed task title, due date and priority before it is added", () => {
    const onEditTask = vi.fn();
    render(<AssistantMessage message={makeMessage({ proposedTasks: [makeTask()] })} handlers={{ ...handlers, onEditTask }} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit before adding" }));
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Write the Q3 report" } });
    expect(onEditTask).toHaveBeenCalledWith("msg-1", "task-1", { title: "Write the Q3 report" });
    fireEvent.change(screen.getByLabelText("Due date"), { target: { value: "2026-10-09" } });
    expect(onEditTask).toHaveBeenCalledWith("msg-1", "task-1", { dueDate: "2026-10-09" });
    fireEvent.click(screen.getByRole("button", { name: "P1" }));
    expect(onEditTask).toHaveBeenCalledWith("msg-1", "task-1", { priority: 1 });
    // A blank title is never pushed to the proposal.
    onEditTask.mockClear();
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "  " } });
    expect(onEditTask).not.toHaveBeenCalled();
  });

  it("does not offer editing when the host cannot edit", () => {
    render(<AssistantMessage message={makeMessage({ proposedTasks: [makeTask()] })} handlers={handlers} />);
    expect(screen.queryByRole("button", { name: "Edit before adding" })).toBeNull();
  });

  it("renders habit proposals with schedule labels", () => {
    render(<AssistantMessage message={makeMessage({ proposedHabits: [makeHabit()] })} handlers={handlers} />);
    expect(screen.getByText("Morning run")).toBeDefined();
    expect(screen.getByText("Every 1 day")).toBeDefined();
    fireEvent.click(screen.getByTitle("Add habit to Prior"));
    expect(handlers.onAddSingleHabit).toHaveBeenCalledWith("msg-1", expect.objectContaining({ id: "habit-1" }));
  });

  it("renders note and folder proposals with single add actions", () => {
    render(<AssistantMessage message={makeMessage({ proposedNotes: [makeNote()], proposedFolders: [makeFolder()] })} handlers={handlers} />);
    expect(screen.getByText("Sprint review")).toBeDefined();
    expect(screen.getByText("New notes")).toBeDefined();
    expect(screen.getByText("New folders")).toBeDefined();
    fireEvent.click(screen.getByTitle("Add note to Prior"));
    expect(handlers.onAddSingleNote).toHaveBeenCalledWith("msg-1", expect.objectContaining({ id: "note-1" }));
    fireEvent.click(screen.getByTitle("Add folder to Prior"));
    expect(handlers.onAddSingleFolder).toHaveBeenCalledWith("msg-1", expect.objectContaining({ id: "folder-1" }));
  });

  it("shows the resolved model when present", () => {
    render(<AssistantMessage message={makeMessage({ actualModel: "x-ai/grok-4" })} handlers={handlers} />);
    expect(screen.getByText("x-ai/grok-4")).toBeDefined();
  });

  it("renders proposed edits to existing tasks and applies them on confirm", async () => {
    const update: ProposedTaskUpdate = { id: "upd-1", taskId: "task-9", taskTitle: "Send invoice", changes: { priority: 1, status: "done", completed: true }, reasoning: "Paid already", selected: true, added: false };
    render(<AssistantMessage message={makeMessage({ proposedTaskUpdates: [update] })} handlers={handlers} />);
    expect(screen.getByText("Send invoice")).toBeDefined();
    expect(screen.getByText("P1")).toBeDefined();
    expect(screen.getByText("Paid already")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Apply this change" }));
    expect(handlers.onApplyTaskUpdate).toHaveBeenCalledWith("msg-1", expect.objectContaining({ taskId: "task-9" }));
    fireEvent.click(screen.getByRole("button", { name: "Apply all" }));
    await waitFor(() => expect(handlers.onApplyAllTaskUpdates).toHaveBeenCalledTimes(1));
  });

  it("shows task edits as a diff: the old value struck through, the new one highlighted", () => {
    const update: ProposedTaskUpdate = { id: "upd-1", taskId: "task-9", taskTitle: "Send invoice", changes: { title: "Send the invoice", priority: 1, dueDate: "2026-10-09", description: "Same as before" }, reasoning: "", selected: true, added: false };
    const context: ProposalContext = {
      ...EMPTY_CONTEXT,
      tasks: [{ id: "task-9", title: "Send invoice", description: "Same as before", dueDate: "2026-10-03", priority: 3, important: false, urgent: false, completed: false }],
    };
    const { container } = render(<AssistantMessage message={makeMessage({ proposedTaskUpdates: [update] })} handlers={{ ...handlers, context }} />);
    const rows = Array.from(container.querySelectorAll(".review-diff-row")).map((row) => row.querySelector(".review-diff-label")?.textContent);
    // Unchanged fields (the description) are left out.
    expect(rows).toEqual(["Title", "Priority", "Due date"]);
    expect(container.querySelector(".field-title .review-old")?.textContent).toBe("Send invoice");
    expect(container.querySelector(".field-title .review-new")?.textContent).toBe("Send the invoice");
    expect(container.querySelector(".field-priority .review-old")?.textContent).toContain("P3");
    expect(container.querySelector(".field-priority .review-new")?.textContent).toContain("P1");
  });

  it("shows entity changes with their previous values", () => {
    const update: ProposedEntityUpdate = { id: "ent-1", kind: "project", targetId: "project-1", targetTitle: "App Launch", changes: { name: "App Launch v2", status: "paused" }, reasoning: "Waiting on design", selected: true, added: false };
    const context: ProposalContext = {
      ...EMPTY_CONTEXT,
      projects: [{ id: "project-1", name: "App Launch", description: "", status: "active" }],
    };
    const { container } = render(<AssistantMessage message={makeMessage({ proposedUpdates: [update] })} handlers={{ ...handlers, context }} />);
    expect(container.querySelector(".field-name .review-old")?.textContent).toBe("App Launch");
    expect(container.querySelector(".field-name .review-new")?.textContent).toBe("App Launch v2");
    expect(container.querySelector(".field-status .review-old")?.textContent).toBe("Active");
    expect(container.querySelector(".field-status .review-new")?.textContent).toBe("Paused");
    fireEvent.click(screen.getByRole("button", { name: "Apply this change" }));
    expect(handlers.onApplyEntityUpdate).toHaveBeenCalledWith("msg-1", expect.objectContaining({ id: "ent-1" }));
  });

  it("tells the host when proposals were applied", () => {
    const onApplied = vi.fn();
    const message = makeMessage({ proposedTasks: [makeTask()] });
    const { rerender } = render(<AssistantMessage message={message} handlers={{ ...handlers, onApplied }} />);
    expect(onApplied).not.toHaveBeenCalled();
    rerender(<AssistantMessage message={makeMessage({ proposedTasks: [makeTask({ added: true })] })} handlers={{ ...handlers, onApplied }} />);
    expect(onApplied).toHaveBeenCalledTimes(1);
  });

  it("marks applied task edits", () => {
    const update: ProposedTaskUpdate = { id: "upd-1", taskId: "task-9", taskTitle: "Send invoice", changes: { priority: 1 }, reasoning: "", selected: true, added: false };
    const [message] = markTaskUpdatesApplied([makeMessage({ proposedTaskUpdates: [update] })], "msg-1", new Set(["upd-1"]));
    expect(message.proposedTaskUpdates?.[0].added).toBe(true);
  });
});
