import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { ProjectCollaboration } from "./ProjectCollaboration";
import { ProjectCycleEditor } from "./ProjectCycleEditor";
import type { ProjectCollaborationProps } from "./types";
import type { Project } from "../../types";

afterEach(cleanup);

const owner = { id: "alex", name: "Alex", email: "alex@example.com", role: "owner" as const };
const project: Project = { id: "project-1", name: "Launch", description: "A calmer way to plan.", status: "active", areaId: null, projectType: "software", createdAt: "", updatedAt: "", deletedAt: null };
const scrum: Project = { ...project, methodology: "scrum" };
const scrumban: Project = { ...project, methodology: "scrumban" };

// One finished sprint (done: 3 + 5), the running sprint and an issue in no sprint.
const base: ProjectCollaborationProps = {
  project: scrum,
  states: [{ id: "todo", name: "To do", category: "unstarted" }, { id: "done", name: "Done", category: "completed" }],
  issues: [
    { id: "past-1", title: "Old work", stateId: "done", priority: 2, storyPoints: 3, people: [] },
    { id: "past-2", title: "Older work", stateId: "done", priority: 3, storyPoints: 5, people: [] },
    { id: "now-1", title: "Current work", stateId: "todo", priority: 2, storyPoints: 8, people: [owner] },
    { id: "now-2", title: "Unsized work", stateId: "todo", priority: 4, storyPoints: null, people: [] },
    { id: "later", title: "Backlog item", stateId: "todo", priority: 4, storyPoints: 2, people: [] },
  ],
  cycles: [
    { id: "c-past", name: "Sprint 1", phase: "past", dateLabel: "2020-01-01 – 2020-01-14", startsOn: "2020-01-01", endsOn: "2020-01-14", issueIds: ["past-1", "past-2"], issueCount: 2, completedCount: 2 },
    { id: "c-now", name: "Sprint 2", phase: "current", dateLabel: "now", startsOn: "2020-01-15", endsOn: "2999-01-01", issueIds: ["now-1", "now-2"], issueCount: 2, completedCount: 0 },
  ],
  sharing: { members: [owner], invites: [], canManage: true },
};

const openTab = (name: string) => fireEvent.click(screen.getByRole("tab", { name }));

describe("Scrum project", () => {
  it("calls cycles sprints and keeps cycles for Kanban", () => {
    const { unmount } = render(<ProjectCollaboration {...base} />);
    expect(screen.getByRole("tab", { name: "Sprints" })).toBeVisible();
    expect(screen.queryByRole("tab", { name: "Cycles" })).not.toBeInTheDocument();
    expect(screen.getByText("Scrum · Sprint 2")).toBeVisible();
    expect(screen.getByText("Current sprint")).toBeVisible();
    unmount();
    render(<ProjectCollaboration {...base} project={{ ...project, methodology: "kanban" }} />);
    expect(screen.getByRole("tab", { name: "Cycles" })).toBeVisible();
    expect(screen.queryByRole("tab", { name: "Sprints" })).not.toBeInTheDocument();
    expect(screen.getByText("Current cycle")).toBeVisible();
  });

  it("shows story points instead of the priority on issues and board cards", () => {
    render(<ProjectCollaboration {...base} />);
    expect(within(screen.getByRole("region", { name: "To do" })).getByText("8 pts")).toBeVisible();
    openTab("Issues");
    fireEvent.click(screen.getByRole("button", { name: "All" }));
    expect(screen.getByText("8 pts")).toBeVisible();
    expect(screen.getByText("3 pts")).toBeVisible();
    expect(screen.getAllByRole("img", { name: "Not estimated" }).length).toBeGreaterThan(0);
    expect(screen.queryByText(/^Priority \d$/)).not.toBeInTheDocument();
  });

  it("keeps the priority in a Kanban project", () => {
    render(<ProjectCollaboration {...base} project={{ ...project, methodology: "kanban" }} />);
    openTab("Issues");
    expect(screen.getAllByText("Priority 2").length).toBeGreaterThan(0);
    expect(screen.queryByText("8 pts")).not.toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Sprint" })).not.toBeInTheDocument();
  });

  it("filters the issues by sprint, starting on the running one", () => {
    render(<ProjectCollaboration {...base} />);
    openTab("Issues");
    const filter = screen.getByRole("group", { name: "Sprint" });
    expect(within(filter).getByRole("button", { name: "Active sprint" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("Current work")).toBeVisible();
    expect(screen.getByText("Unsized work")).toBeVisible();
    expect(screen.queryByText("Old work")).not.toBeInTheDocument();
    expect(screen.queryByText("Backlog item")).not.toBeInTheDocument();
    fireEvent.click(within(filter).getByRole("button", { name: "Backlog" }));
    expect(screen.getByText("Backlog item")).toBeVisible();
    expect(screen.queryByText("Current work")).not.toBeInTheDocument();
    fireEvent.click(within(filter).getByRole("button", { name: "All" }));
    expect(screen.getByText("Old work")).toBeVisible();
    expect(screen.getByText("Backlog item")).toBeVisible();
  });

  it("starts on all issues when no sprint is running", () => {
    render(<ProjectCollaboration {...base} cycles={base.cycles.filter((cycle) => cycle.phase === "past")} />);
    openTab("Issues");
    expect(screen.getByRole("button", { name: "All" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("Backlog item")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Active sprint" }));
    expect(screen.getByText("No sprint is running")).toBeVisible();
  });

  it("shows committed and done points on sprints and the velocity", () => {
    render(<ProjectCollaboration {...base} />);
    openTab("Sprints");
    expect(screen.getByText("8 of 8 pts done")).toBeVisible();
    expect(screen.getByText("0 of 8 pts done")).toBeVisible();
    expect(screen.getByText("1 not estimated")).toBeVisible();
    expect(screen.getByText("8 pts per sprint")).toBeVisible();
    expect(screen.getByText("Finished")).toBeVisible();
  });

  it("explains the velocity while no sprint is finished", () => {
    render(<ProjectCollaboration {...base} cycles={base.cycles.filter((cycle) => cycle.phase === "current")} />);
    openTab("Sprints");
    expect(screen.getByText("Finish a sprint to see your velocity")).toBeVisible();
  });

  it("offers the sprint wording to create one", () => {
    render(<ProjectCollaboration {...base} readOnly={false} onCreateCycle={vi.fn()} onEditCycle={vi.fn()} />);
    openTab("Sprints");
    expect(screen.getByRole("button", { name: "New sprint" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Edit Sprint 1" })).toBeVisible();
  });
});

describe("Planning Poker tab", () => {
  const renderPoker = () => <div>Poker table</div>;

  it("is shown for Scrum and Scrumban once the app provides the content", () => {
    const { rerender } = render(<ProjectCollaboration {...base} renderPoker={renderPoker} />);
    expect(screen.getByRole("tab", { name: "Planning Poker" })).toBeVisible();
    openTab("Planning Poker");
    expect(screen.getByText("Poker table")).toBeVisible();
    rerender(<ProjectCollaboration {...base} project={scrumban} renderPoker={renderPoker} />);
    expect(screen.getByRole("tab", { name: "Planning Poker" })).toBeVisible();
    // Scrumban keeps cycles as they were.
    expect(screen.getByRole("tab", { name: "Cycles" })).toBeVisible();
  });

  it("is hidden without content, for Kanban and for standard-looking projects", () => {
    const { rerender } = render(<ProjectCollaboration {...base} />);
    expect(screen.queryByRole("tab", { name: "Planning Poker" })).not.toBeInTheDocument();
    rerender(<ProjectCollaboration {...base} project={{ ...project, methodology: "kanban" }} renderPoker={renderPoker} />);
    expect(screen.queryByRole("tab", { name: "Planning Poker" })).not.toBeInTheDocument();
    rerender(<ProjectCollaboration {...base} project={project} renderPoker={renderPoker} />);
    expect(screen.queryByRole("tab", { name: "Planning Poker" })).not.toBeInTheDocument();
  });

  it("is a controlled tab named poker, and falls back when it is not available", () => {
    const onTabChange = vi.fn();
    const { rerender } = render(<ProjectCollaboration {...base} renderPoker={renderPoker} tab="poker" onTabChange={onTabChange} />);
    expect(screen.getByRole("tab", { name: "Planning Poker" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("Poker table")).toBeVisible();
    openTab("Overview");
    expect(onTabChange).toHaveBeenLastCalledWith("overview");
    rerender(<ProjectCollaboration {...base} tab="poker" onTabChange={onTabChange} />);
    expect(screen.queryByText("Poker table")).not.toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Board" })).toHaveAttribute("aria-selected", "true");
  });
});

describe("ProjectCycleEditor for sprints", () => {
  it("speaks of sprints and totals the committed points", () => {
    render(<ProjectCycleEditor sprint points cycle={{ name: "Sprint 2", startsOn: "2026-01-01", endsOn: "2026-01-14", issueIds: ["now-1", "later"] }} issues={base.issues} onSave={vi.fn(async () => undefined)} onClose={vi.fn()} />);
    expect(screen.getByRole("dialog", { name: "Edit sprint" })).toBeVisible();
    expect(screen.getByLabelText("Sprint name")).toHaveValue("Sprint 2");
    expect(screen.getByText("10 pts committed")).toBeVisible();
    fireEvent.click(screen.getByRole("checkbox", { name: /Backlog item/ }));
    expect(screen.getByText("8 pts committed")).toBeVisible();
  });

  it("keeps the cycle wording and no points by default", () => {
    render(<ProjectCycleEditor issues={base.issues} onSave={vi.fn(async () => undefined)} onClose={vi.fn()} />);
    expect(screen.getByRole("dialog", { name: "New cycle" })).toBeVisible();
    expect(screen.queryByText(/committed/)).not.toBeInTheDocument();
  });
});
