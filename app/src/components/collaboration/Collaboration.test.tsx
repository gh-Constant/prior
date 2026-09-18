import "@testing-library/jest-dom/vitest";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { ProjectCollaboration } from "./ProjectCollaboration";
import { ProjectShareDialog } from "./ProjectShareDialog";
import { TaskPeoplePicker, TaskPlanning } from "./TaskPlanning";
import { TaskComposer } from "../TaskComposer";
import { WorkHubView } from "../WorkHubView";
import type { ProjectCollaborationProps, TaskPerson } from "./types";
import type { Project, TaskDraft } from "../../types";

afterEach(cleanup);

const owner = { id: "alex", name: "Alex", email: "alex@example.com", role: "owner" as const };
const sam = { id: "sam", name: "Sam", email: "sam@example.com", role: "viewer" as const };
const project: Project = { id: "project-1", name: "Launch", description: "A calmer way to plan.", status: "active", areaId: null, createdAt: "", updatedAt: "", deletedAt: null };
const base: ProjectCollaborationProps = {
  project,
  states: [{ id: "todo", name: "To do", category: "unstarted" }, { id: "done", name: "Done", category: "completed" }],
  issues: [
    { id: "one", identifier: "PR-1", title: "Design navigation", stateId: "todo", priority: 2, people: [owner], properties: [{ key: "cycle", label: "Cycle 1" }] },
    { id: "two", title: "Write the brief", stateId: "done", people: [] },
    { id: "three", title: "Imported issue", stateId: "missing", people: [] },
  ],
  cycles: [{ id: "c1", name: "Cycle 1", phase: "current", dateLabel: "Sep 18 – Oct 2", issueCount: 3, completedCount: 1, capacity: 5 }],
  sharing: { members: [owner, sam], invites: [{ id: "invite-1", email: "new@example.com", role: "editor" }], canManage: true },
};

describe("ProjectCollaboration", () => {
  it("renders overview, navigates tabs by keyboard, filters issues, and opens details", () => {
    const onOpenIssue = vi.fn();
    const onCreateIssue = vi.fn();
    render(<ProjectCollaboration {...base} readOnly={false} onOpenIssue={onOpenIssue} onCreateIssue={onCreateIssue} />);
    expect(screen.getByText(project.description)).toBeVisible();
    expect(screen.getByRole("progressbar", { name: "Project completion" })).toHaveAttribute("value", "1");
    fireEvent.click(screen.getByRole("button", { name: "New issue" }));
    expect(onCreateIssue).toHaveBeenCalledOnce();
    const overviewTab = screen.getByRole("tab", { name: "Overview" });
    overviewTab.focus();
    fireEvent.keyDown(overviewTab, { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: "Issues" })).toHaveFocus();
    expect(screen.getByRole("tabpanel", { name: "Issues" })).toBeVisible();
    fireEvent.change(screen.getByRole("searchbox", { name: "Find an issue" }), { target: { value: "PR-1" } });
    expect(screen.queryByText("Write the brief")).not.toBeInTheDocument();
    expect(screen.getByText("Priority 2")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Design navigation" }));
    expect(onOpenIssue).toHaveBeenCalledWith("one");
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "absent" } });
    expect(screen.getByText("No matching issues")).toBeVisible();
  });

  it("groups every issue on the board, including unknown workflow states", () => {
    render(<ProjectCollaboration {...base} />);
    fireEvent.click(screen.getByRole("tab", { name: "Board" }));
    expect(within(screen.getByRole("region", { name: "To do" })).getByText("Design navigation")).toBeVisible();
    expect(within(screen.getByRole("region", { name: "Done" })).getByText("Write the brief")).toBeVisible();
    expect(within(screen.getByRole("region", { name: "Unassigned state" })).getByText("Imported issue")).toBeVisible();
  });

  it("renders cycles and their capacity", () => {
    render(<ProjectCollaboration {...base} />);
    fireEvent.keyDown(screen.getByRole("tab", { name: "Overview" }), { key: "End" });
    expect(screen.getByRole("tab", { name: "Cycles" })).toHaveFocus();
    expect(screen.getByText("1 of 3 issues complete · Capacity 5")).toBeVisible();
    expect(screen.getByRole("progressbar", { name: "Cycle 1 completion" })).toHaveAttribute("max", "3");
  });

  it("renders empty and loading states without stale issue content", () => {
    const { rerender } = render(<ProjectCollaboration {...base} issues={[]} cycles={[]} />);
    fireEvent.click(screen.getByRole("tab", { name: "Cycles" }));
    expect(screen.getByText("No cycles planned")).toBeVisible();
    fireEvent.click(screen.getByRole("tab", { name: "Issues" }));
    expect(screen.getByText("No issues yet")).toBeVisible();
    rerender(<ProjectCollaboration {...base} loading />);
    expect(screen.getByRole("tabpanel")).toHaveAttribute("aria-busy", "true");
    expect(screen.getByText("Loading project…")).toBeVisible();
    expect(screen.queryByText("Design navigation")).not.toBeInTheDocument();
  });

  it("defaults to view-only and prevents management even if callbacks are supplied", () => {
    const onInvite = vi.fn();
    render(<ProjectCollaboration {...base} sharing={{ ...base.sharing, onInvite }} onCreateIssue={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "New issue" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Share" }));
    expect(screen.getByRole("dialog", { name: "Share Launch" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Invite" })).not.toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Project role for Sam" })).toBeDisabled();
    expect(onInvite).not.toHaveBeenCalled();
  });
});

describe("ProjectShareDialog", () => {
  it("shows member roles and pending invites and emits controlled actions", () => {
    const onInvite = vi.fn();
    const onRoleChange = vi.fn();
    const onRevokeInvite = vi.fn();
    const onCopyLink = vi.fn();
    render(<ProjectShareDialog {...base.sharing} projectName="Launch" onClose={vi.fn()} onInvite={onInvite} onRoleChange={onRoleChange} onRevokeInvite={onRevokeInvite} onCopyLink={onCopyLink} />);
    expect(screen.getByText("Owner")).toBeVisible();
    expect(screen.getByText("Editor · Pending")).toBeVisible();
    expect(screen.getByText(/A link does not grant access/)).toBeVisible();
    fireEvent.change(screen.getByLabelText("Project role for Sam"), { target: { value: "editor" } });
    expect(onRoleChange).toHaveBeenCalledWith("sam", "editor");
    fireEvent.change(screen.getByLabelText("Email address"), { target: { value: "invite@example.com" } });
    fireEvent.change(screen.getByLabelText("Invite role"), { target: { value: "viewer" } });
    fireEvent.click(screen.getByRole("button", { name: "Invite" }));
    expect(onInvite).toHaveBeenCalledWith("invite@example.com", "viewer");
    // A callback is not a successful send: no invented invite/success message.
    expect(screen.getByLabelText("Email address")).toHaveValue("invite@example.com");
    fireEvent.click(screen.getByRole("button", { name: "Revoke invite for new@example.com" }));
    expect(onRevokeInvite).toHaveBeenCalledWith("invite-1");
    fireEvent.click(screen.getByRole("button", { name: "Copy project link" }));
    expect(onCopyLink).toHaveBeenCalledOnce();
  });

  it("rejects duplicate invites and invalid emails, and disables actions while busy", () => {
    const onInvite = vi.fn();
    const props = { ...base.sharing, projectName: "Launch", onClose: vi.fn(), onInvite };
    const { rerender } = render(<ProjectShareDialog {...props} />);
    fireEvent.change(screen.getByLabelText("Email address"), { target: { value: "NEW@example.com" } });
    expect(screen.getByRole("button", { name: "Invite" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Email address"), { target: { value: "invalid" } });
    fireEvent.click(screen.getByRole("button", { name: "Invite" }));
    expect(onInvite).not.toHaveBeenCalled();
    rerender(<ProjectShareDialog {...props} busy error="Unable to send invitation. Try again." />);
    expect(screen.getByRole("alert")).toHaveTextContent("Unable to send invitation");
    expect(screen.getByRole("button", { name: "Working…" })).toBeDisabled();
    expect(screen.getByLabelText("Email address")).toBeDisabled();
  });

  it("keeps focus in the modal, closes on Escape, and restores the opener", () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      return <><button onClick={() => setOpen(true)}>Open share</button>{open && <ProjectShareDialog {...base.sharing} projectName="Launch" onClose={() => setOpen(false)} />}</>;
    }
    render(<Harness />);
    const opener = screen.getByRole("button", { name: "Open share" });
    opener.focus();
    fireEvent.click(opener);
    const close = screen.getByRole("button", { name: "Close dialog" });
    expect(close).toHaveFocus();
    fireEvent.keyDown(close, { key: "Tab", shiftKey: true });
    expect(screen.getByRole("button", { name: "Done" })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole("button", { name: "Done" }), { key: "Tab" });
    expect(close).toHaveFocus();
    fireEvent.keyDown(close, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  it("shows loading and empty membership states", () => {
    const props = { projectName: "Launch", onClose: vi.fn(), members: [], invites: [] };
    const { rerender } = render(<ProjectShareDialog {...props} loading />);
    expect(screen.getByText("Loading project members…")).toBeVisible();
    rerender(<ProjectShareDialog {...props} />);
    expect(screen.getByText("No members to display.")).toBeVisible();
    expect(screen.getByText("No pending invitations.")).toBeVisible();
  });
});

describe("Task people and planning", () => {
  it("adds, assigns, and removes people while retaining the last owner", () => {
    function Harness() {
      const [people, setPeople] = useState<TaskPerson[]>([owner]);
      return <TaskPeoplePicker people={people} availablePeople={[owner, sam]} onPeopleChange={setPeople} />;
    }
    render(<Harness />);
    expect(screen.getByRole("button", { name: "Remove Alex" })).toBeDisabled();
    expect(screen.getByLabelText("Task role for Alex")).toBeDisabled();
    fireEvent.click(screen.getByText("Add people"));
    fireEvent.change(screen.getByLabelText("Find a project member"), { target: { value: "sam@" } });
    fireEvent.click(screen.getByRole("button", { name: "Sam" }));
    expect(screen.getByLabelText("Task role for Sam")).toHaveValue("collaborator");
    expect(screen.queryByRole("button", { name: "Sam" })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Task role for Sam"), { target: { value: "owner" } });
    expect(screen.getByRole("button", { name: "Remove Alex" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Remove Alex" }));
    expect(screen.getByRole("button", { name: "Remove Sam" })).toBeDisabled();
  });

  it("shows no matches and read-only/loading people states", () => {
    const onPeopleChange = vi.fn();
    const props = { people: [owner], availablePeople: [sam], onPeopleChange };
    const { rerender } = render(<TaskPeoplePicker {...props} />);
    fireEvent.click(screen.getByText("Add people"));
    fireEvent.change(screen.getByLabelText("Find a project member"), { target: { value: "Nobody" } });
    expect(screen.getByText("No matching members.")).toBeVisible();
    rerender(<TaskPeoplePicker {...props} readOnly />);
    expect(screen.queryByText("Add people")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove Alex" })).toBeDisabled();
    rerender(<TaskPeoplePicker {...props} loading />);
    expect(screen.getByText("Loading people…")).toBeVisible();
    expect(onPeopleChange).not.toHaveBeenCalled();
  });

  it("renders collapsed, controlled planning fields and emits single/multiple selections", () => {
    const onFieldChange = vi.fn();
    render(<TaskPlanning people={[]} availablePeople={[]} fields={[
      { key: "cycle", label: "Cycle", options: [{ id: "c1", name: "Cycle 1" }], selectedIds: [] },
      { key: "labels", label: "Labels", options: [{ id: "bug", name: "Bug" }, { id: "ui", name: "UI" }], selectedIds: [] },
    ]} onFieldChange={onFieldChange} />);
    expect(screen.getByText("Planning").closest("details")).not.toHaveAttribute("open");
    fireEvent.click(screen.getByText("Planning"));
    fireEvent.change(screen.getByLabelText("Cycle"), { target: { value: "c1" } });
    expect(onFieldChange).toHaveBeenCalledWith("cycle", ["c1"]);
    const labels = screen.getByLabelText("Labels") as HTMLSelectElement;
    for (const option of labels.options) option.selected = true;
    fireEvent.change(labels);
    expect(onFieldChange).toHaveBeenCalledWith("labels", ["bug", "ui"]);
  });

  it("integrates optional planning without changing the existing task save payload", () => {
    const onSave = vi.fn(async (_draft: TaskDraft) => undefined);
    render(<TaskComposer planning={{ people: [owner], availablePeople: [owner], fields: [] }} onSave={onSave} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByText(/More options/));
    expect(screen.getByRole("region", { name: "Task people" })).toBeVisible();
    fireEvent.change(screen.getByLabelText("Task title"), { target: { value: "Draft" } });
    fireEvent.click(screen.getByRole("button", { name: "Create task" }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ title: "Draft", priority: 4 }));
    expect(onSave.mock.calls[0]?.[0]).not.toHaveProperty("people");
  });
});

describe("WorkHubView opt-in integration", () => {
  const props = { view: "project" as const, tasks: [], areas: [], projects: [project], selectedProjectId: project.id, onOpenProject: vi.fn(), onOpenNotes: vi.fn(), onOpenWaiting: vi.fn(), onNewTask: vi.fn(), onTaskChange: vi.fn(), onTaskDelete: vi.fn(), onTaskEdit: vi.fn(), onWorkspaceChange: vi.fn() };

  it("preserves personal project tabs until collaboration props are supplied", () => {
    const { rerender } = render(<WorkHubView {...props} />);
    expect(screen.getByRole("tab", { name: /Tasks/ })).toBeVisible();
    expect(screen.getByRole("tab", { name: /Notes/ })).toBeVisible();
    expect(screen.queryByRole("tab", { name: "Overview" })).not.toBeInTheDocument();
    rerender(<WorkHubView {...props} collaborationByProject={{ [project.id]: base }} />);
    expect(screen.getByRole("tab", { name: "Overview" })).toBeVisible();
    expect(screen.queryByRole("tab", { name: /Tasks/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "All projects" }));
    expect(props.onOpenProject).toHaveBeenCalledWith("");
  });
});
