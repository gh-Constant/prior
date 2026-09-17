import { describe, expect, it, vi, afterEach } from "vitest";
import type { AgentMessage, ProposedFolder, ProposedHabit, ProposedNote, ProposedTask } from "../types";
import {
  AssistantMessage,
  folderDraftOf,
  getQuadrantBadge,
  habitDraftOf,
  markFoldersAdded,
  markHabitsAdded,
  markNotesAdded,
  markTasksAdded,
  noteDraftOf,
  taskDraftOf,
  updateFolderProposal,
  updateHabitProposal,
  updateNoteProposal,
  updateTaskProposal,
} from "./AgentMessageView";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

afterEach(() => cleanup());

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
    });
    expect(noteDraftOf(makeNote())).toEqual({
      title: "Sprint review",
      folderName: "Projects",
      bodyMarkdown: "## Decisions\n\n- [ ] Ship\n\n| A | B |\n| --- | --- |\n| 1 | 2 |",
      favorite: false,
    });
    expect(folderDraftOf(makeFolder())).toEqual({ name: "Projects", parentName: null });
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
  };

  it("renders user messages without proposals", () => {
    render(<AssistantMessage message={makeMessage({ role: "user", content: "hello" })} handlers={handlers} />);
    expect(screen.getByText("hello")).toBeDefined();
  });

  it("renders task proposals with quadrant, priority, and add-all", () => {
    render(<AssistantMessage message={makeMessage({ proposedTasks: [makeTask(), makeTask({ id: "task-2", title: "Second", selected: false, important: false, urgent: true, reasoning: "" })] })} handlers={handlers} />);
    expect(screen.getByText("Write report")).toBeDefined();
    expect(screen.getByText("Plan (Schedule)")).toBeDefined();
    expect(screen.getByText("Quick (Delegate)")).toBeDefined();
    expect(screen.getByText("High impact")).toBeDefined();
    fireEvent.click(screen.getByText("Add all to Prior"));
    expect(handlers.onAddAllTasks).toHaveBeenCalledTimes(1);
  });

  it("forwards toggle and single-add interactions", () => {
    render(<AssistantMessage message={makeMessage({ proposedTasks: [makeTask()] })} handlers={handlers} />);
    fireEvent.click(screen.getByLabelText("Mark urgent"));
    expect(handlers.onToggleTaskUrgent).toHaveBeenCalledWith("msg-1", "task-1");
    fireEvent.click(screen.getByLabelText("Remove important flag"));
    expect(handlers.onToggleTaskImportant).toHaveBeenCalledWith("msg-1", "task-1");
    fireEvent.click(screen.getByTitle("Add task to Prior"));
    expect(handlers.onAddSingleTask).toHaveBeenCalledTimes(1);
  });

  it("shows an Added badge instead of the add button once added", () => {
    render(<AssistantMessage message={makeMessage({ proposedTasks: [makeTask({ added: true })] })} handlers={handlers} />);
    expect(screen.getByText("Added")).toBeDefined();
    expect(screen.queryByTitle("Add task to Prior")).toBeNull();
  });

  it("renders habit proposals with schedule labels", () => {
    render(<AssistantMessage message={makeMessage({ proposedHabits: [makeHabit()] })} handlers={handlers} />);
    expect(screen.getByText("Morning run")).toBeDefined();
    expect(screen.getByText("Add habits to Prior")).toBeDefined();
    fireEvent.click(screen.getByTitle("Add habit to Prior"));
    expect(handlers.onAddSingleHabit).toHaveBeenCalledWith("msg-1", expect.objectContaining({ id: "habit-1" }));
  });

  it("renders note and folder proposals with add-all actions", () => {
    render(<AssistantMessage message={makeMessage({ proposedNotes: [makeNote()], proposedFolders: [makeFolder()] })} handlers={handlers} />);
    expect(screen.getByText("Sprint review")).toBeDefined();
    expect(screen.getByText("Add notes to Prior")).toBeDefined();
    expect(screen.getByText("Add folders to Prior")).toBeDefined();
    fireEvent.click(screen.getByTitle("Add note to Prior"));
    expect(handlers.onAddSingleNote).toHaveBeenCalledWith("msg-1", expect.objectContaining({ id: "note-1" }));
    fireEvent.click(screen.getByTitle("Add folder to Prior"));
    expect(handlers.onAddSingleFolder).toHaveBeenCalledWith("msg-1", expect.objectContaining({ id: "folder-1" }));
  });

  it("shows the resolved model when present", () => {
    render(<AssistantMessage message={makeMessage({ actualModel: "x-ai/grok-4" })} handlers={handlers} />);
    expect(screen.getByText("x-ai/grok-4")).toBeDefined();
  });
});
