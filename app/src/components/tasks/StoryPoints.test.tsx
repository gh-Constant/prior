import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { Project, Task } from "../../types";
import { TaskRow } from "../TaskRow";
import { KanbanTaskCard } from "../kanban/TaskCard";
import { TaskDetailPanel } from "../TaskDetailPanel";
import { TaskComposer } from "../TaskComposer";
import { ProjectKindSelect } from "../ProjectKindSelect";
import { StoryPointsChip, StoryPointsPicker, TaskSizeBadge } from "./StoryPoints";

afterEach(cleanup);

const stamps = { createdAt: "2026-09-16T10:00:00.000Z", updatedAt: "2026-09-16T10:00:00.000Z", deletedAt: null };
const scrum: Project = { id: "p-scrum", areaId: null, name: "Sprint app", description: "", status: "active", projectType: "software", methodology: "scrum", ...stamps };
const kanban: Project = { ...scrum, id: "p-kanban", name: "Board app", methodology: "kanban" };
const standard: Project = { ...scrum, id: "p-std", name: "Home", projectType: "standard", methodology: undefined };
const baseTask: Task = { id: "t1", title: "Ship it", description: "", dueDate: null, priority: 1, completed: false, important: false, urgent: false, projectId: "p-scrum", ...stamps };
const sized: Task = { ...baseTask, storyPoints: 5 };
const noop = async () => undefined;

describe("StoryPointsChip", () => {
  it("shows pts, a half point and the dashed empty chip", () => {
    const { rerender } = render(<StoryPointsChip points={5} />);
    expect(screen.getByText("5 pts")).toBeVisible();
    rerender(<StoryPointsChip points={1} />);
    expect(screen.getByText("1 pt")).toBeVisible();
    rerender(<StoryPointsChip points={0.5} />);
    expect(screen.getByText("½ pt")).toBeVisible();
    rerender(<StoryPointsChip points={null} variant="project" />);
    const empty = screen.getByRole("img", { name: "Not estimated" });
    expect(empty).toHaveTextContent("–");
    expect(empty).toHaveClass("project-chip", "is-empty");
  });
});

describe("TaskSizeBadge", () => {
  it("swaps the fallback for the chip only in points mode", () => {
    const { rerender } = render(<TaskSizeBadge task={sized} project={scrum}><span>P1 glyph</span></TaskSizeBadge>);
    expect(screen.getByText("5 pts")).toBeVisible();
    expect(screen.queryByText("P1 glyph")).not.toBeInTheDocument();
    rerender(<TaskSizeBadge task={sized} project={kanban}><span>P1 glyph</span></TaskSizeBadge>);
    expect(screen.getByText("P1 glyph")).toBeVisible();
    rerender(<TaskSizeBadge task={sized} project={null}><span>P1 glyph</span></TaskSizeBadge>);
    expect(screen.getByText("P1 glyph")).toBeVisible();
  });
});

describe("TaskRow in a Scrum project", () => {
  it("shows the points and no priority glyph in the compact row", () => {
    const { container } = render(<TaskRow task={sized} project={scrum} variant="compact" onChange={noop} onDelete={noop} />);
    expect(screen.getByText("5 pts")).toBeVisible();
    expect(container.querySelector(".priority-glyph")).toBeNull();
  });

  it("marks a task without an estimate with the dashed chip", () => {
    render(<TaskRow task={baseTask} project={scrum} variant="compact" onChange={noop} onDelete={noop} />);
    expect(screen.getByRole("img", { name: "Not estimated" })).toBeVisible();
  });

  it("shows the points instead of P1 in the default row", () => {
    render(<TaskRow task={sized} project={scrum} onChange={noop} onDelete={noop} />);
    expect(screen.getByText("5 pts")).toBeVisible();
    expect(screen.queryByText("P1")).not.toBeInTheDocument();
  });

  it("keeps the priority for Kanban, standard and project-less tasks", () => {
    for (const project of [kanban, standard, null]) {
      const { container, unmount } = render(<TaskRow task={{ ...sized, projectId: project?.id }} project={project} variant="compact" onChange={noop} onDelete={noop} />);
      expect(container.querySelector(".priority-glyph-1")).not.toBeNull();
      expect(screen.queryByText("5 pts")).not.toBeInTheDocument();
      unmount();
    }
    render(<TaskRow task={sized} project={kanban} onChange={noop} onDelete={noop} />);
    expect(screen.getByText("P1")).toBeVisible();
  });
});

describe("KanbanTaskCard", () => {
  it("replaces the priority glyph with story points in Scrum and Scrumban projects", () => {
    const { container, rerender } = render(<KanbanTaskCard task={sized} today="2026-09-16" sizeProject={scrum} onOpen={vi.fn()} />);
    expect(screen.getByText("5 pts")).toBeVisible();
    expect(container.querySelector(".priority-glyph")).toBeNull();
    rerender(<KanbanTaskCard task={sized} today="2026-09-16" sizeProject={{ projectType: "software", methodology: "scrumban" }} onOpen={vi.fn()} />);
    expect(screen.getByText("5 pts")).toBeVisible();
    rerender(<KanbanTaskCard task={sized} today="2026-09-16" sizeProject={standard} onOpen={vi.fn()} />);
    expect(container.querySelector(".priority-glyph-1")).not.toBeNull();
    expect(screen.queryByText("5 pts")).not.toBeInTheDocument();
  });
});

describe("StoryPointsPicker", () => {
  it("selects a card, reports the value and clears", () => {
    const onChange = vi.fn();
    const { rerender } = render(<StoryPointsPicker value={null} onChange={onChange} />);
    expect(screen.getByRole("button", { name: "Clear the estimate" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "8 story points" }));
    expect(onChange).toHaveBeenLastCalledWith(8);
    fireEvent.click(screen.getByRole("button", { name: "½ story points" }));
    expect(onChange).toHaveBeenLastCalledWith(0.5);
    rerender(<StoryPointsPicker value={8} onChange={onChange} />);
    expect(screen.getByRole("button", { name: "8 story points" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Clear the estimate" }));
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it("shows a value outside the deck as its own selected card", () => {
    render(<StoryPointsPicker value={4} onChange={vi.fn()} compact />);
    expect(screen.getByRole("button", { name: "4 story points" })).toHaveAttribute("aria-pressed", "true");
  });
});

describe("TaskDetailPanel", () => {
  const props = { onEdit: vi.fn(), onClose: vi.fn() };
  it("edits the story points of a task in a Scrum project, above the priority", () => {
    const onChange = vi.fn(async () => undefined);
    render(<TaskDetailPanel task={sized} project={scrum} onChange={onChange} {...props} />);
    expect(screen.getByRole("group", { name: "Story points" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "13 story points" }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ id: "t1", storyPoints: 13, priority: 1 }));
  });

  it("has no story points row for other projects", () => {
    render(<TaskDetailPanel task={sized} project={kanban} onChange={noop} {...props} />);
    expect(screen.queryByRole("group", { name: "Story points" })).not.toBeInTheDocument();
  });
});

describe("TaskComposer", () => {
  it("offers story points in a Scrum project and saves them with the task", async () => {
    const onSave = vi.fn(async () => undefined);
    render(<TaskComposer task={sized} projects={[scrum]} onSave={onSave} onCancel={vi.fn()} />);
    const select = screen.getByRole("combobox", { name: "Story points" });
    expect(select).toHaveValue("5");
    fireEvent.change(select, { target: { value: "13" } });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    await vi.waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ storyPoints: 13 }));
  });

  it("does not offer story points elsewhere", () => {
    render(<TaskComposer task={{ ...baseTask, projectId: "p-kanban" }} projects={[kanban]} onSave={noop} onCancel={vi.fn()} />);
    expect(screen.queryByRole("combobox", { name: "Story points" })).not.toBeInTheDocument();
  });
});

describe("ProjectKindSelect", () => {
  it("offers the four kinds, each with a one-line description, and reports the choice", () => {
    const onChange = vi.fn();
    render(<ProjectKindSelect value="standard" onChange={onChange} ariaLabel="Project type" />);
    const select = screen.getByRole("combobox", { name: "Project type" });
    expect([...select.querySelectorAll("option")].map((option) => option.getAttribute("value"))).toEqual(["standard", "kanban", "scrum", "scrumban"]);
    expect(screen.getByText("Tasks and notes with simple statuses and priorities.")).toBeVisible();
    fireEvent.change(select, { target: { value: "scrumban" } });
    expect(onChange).toHaveBeenCalledWith("scrumban");
    fireEvent.click(screen.getAllByRole("button")[0]);
    expect(screen.getByRole("option", { name: /^Agile · Scrum\s*Sprints/ })).toHaveTextContent("Sprints, story points and Planning Poker for the team.");
    expect(screen.getByRole("option", { name: /Agile · Kanban/ })).toBeVisible();
    expect(screen.getByRole("option", { name: /Agile · Scrumban/ })).toBeVisible();
  });
});
