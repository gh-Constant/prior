import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Task } from "../types";
import { ProjectPhoneGroups, ProjectPhoneSummary } from "./ProjectDetailParts";
import { projectStatusGroups } from "./ProjectTaskBoard";
import { ProjectCollaboration } from "./collaboration/ProjectCollaboration";
import type { ProjectCollaborationProps } from "./collaboration/types";

function phone(matches: boolean): void {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: matches && query.includes("max-width: 760px"), media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
}

beforeEach(() => phone(true));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function task(id: string, overrides: Partial<Task> = {}): Task {
  return {
    id, title: `Task ${id}`, description: "", dueDate: null, priority: 4, completed: false, important: false, urgent: false,
    createdAt: "2026-09-01T10:00:00.000Z", updatedAt: "2026-09-02T10:00:00.000Z", deletedAt: null, ...overrides,
  };
}

describe("project page on phones", () => {
  it("lists a project by status, hides empty sections and folds finished work", () => {
    const tasks = [task("a", { status: "next" }), task("b", { status: "inbox" }), task("c", { status: "done", completed: true })];
    render(<ProjectPhoneGroups groups={projectStatusGroups("standard", tasks, (key) => key.split(".").pop() ?? key)} label="List" renderItem={(item) => <span>{item.title}</span>} />);
    const sections = screen.getAllByRole("listitem");
    expect(sections.map((section) => section.getAttribute("aria-label"))).toEqual(["statusTodo", "statusDone"]);
    expect(within(sections[0]).getByText("Task b")).toBeVisible();
    const done = within(sections[1]).getByRole("button", { name: /statusDone/ });
    expect(done).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Task c")).not.toBeInTheDocument();
    fireEvent.click(done);
    expect(screen.getByText("Task c")).toBeVisible();
  });

  it("summarises progress, due date and cycle in one card", () => {
    render(<ProjectPhoneSummary progress={{ completed: 1, total: 4, percent: 25 }} targetDate="2999-01-01" cycle={{ name: "Sprint 3", endsOn: "2999-01-01" }} health="At risk" />);
    expect(screen.getByText("1 of 4 done")).toBeVisible();
    expect(screen.getByText("Cycle")).toBeVisible();
    expect(screen.getByText("Sprint 3")).toBeVisible();
    expect(screen.getByText("At risk")).toHaveClass("is-warning");
  });

  it("opens agile projects on their issues grouped by state, with a back button", () => {
    const onBack = vi.fn();
    const props: ProjectCollaborationProps = {
      project: { id: "p", name: "Launch", description: "", status: "active", projectType: "software" },
      states: [{ id: "todo", name: "To do", category: "unstarted" }, { id: "done", name: "Done", category: "completed" }],
      issues: [{ id: "one", title: "Design navigation", stateId: "todo", priority: 2, people: [] }, { id: "two", title: "Write the brief", stateId: "done", people: [] }],
      cycles: [],
      sharing: { members: [], invites: [], canManage: false },
      areaName: "Work",
      onBack,
    };
    render(<ProjectCollaboration {...props} />);
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["Issues", "Board", "Overview", "Cycles", "Activity"]);
    expect(screen.getByRole("tab", { name: "Issues" })).toHaveAttribute("aria-selected", "true");
    expect(within(screen.getByRole("listitem", { name: "To do" })).getByText("Design navigation")).toBeVisible();
    expect(screen.queryByText("Write the brief")).not.toBeInTheDocument();
    expect(screen.getByText("Work")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Back to projects" }));
    expect(onBack).toHaveBeenCalledOnce();
  });
});
