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
    expect(screen.getByRole("tab", { name: "Board" })).toHaveAttribute("aria-selected", "true");
    fireEvent.click(screen.getByRole("tab", { name: "Overview" }));
    expect(screen.getByRole("progressbar", { name: "Project completion" })).toHaveAttribute("value", "1");
    fireEvent.click(screen.getByRole("button", { name: "New issue" }));
    expect(onCreateIssue).toHaveBeenCalledOnce();
    const boardTab = screen.getByRole("tab", { name: "Board" });
    boardTab.focus();
    fireEvent.keyDown(boardTab, { key: "ArrowRight" });
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
    expect(screen.getByRole("tab", { name: "Activity" })).toHaveFocus();
    fireEvent.click(screen.getByRole("tab", { name: "Cycles" }));
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
    expect(screen.queryByRole("combobox", { name: "Project role for Sam" })).not.toBeInTheDocument();
    expect(screen.getByText("Viewer")).toBeVisible();
    expect(onInvite).not.toHaveBeenCalled();
  });
});

describe("ProjectShareDialog", () => {
  it("invites in one click and confirms the real outcome with a link to copy", async () => {
    const onInvite = vi.fn().mockResolvedValue({ kind: "invited", email: "invite@example.com", link: "https://app.example/invite/abc", emailSent: true });
    render(<ProjectShareDialog {...base.sharing} projectName="Launch" onClose={vi.fn()} onInvite={onInvite} />);
    expect(screen.getByText("Owner")).toBeVisible();
    expect(screen.getByText(/Editor · Pending/)).toBeVisible();
    fireEvent.change(screen.getByLabelText("Email address"), { target: { value: "invite@example.com" } });
    fireEvent.change(screen.getByLabelText("Invite role"), { target: { value: "viewer" } });
    fireEvent.click(screen.getByRole("button", { name: "Invite" }));
    expect(onInvite).toHaveBeenCalledWith("invite@example.com", "viewer");
    expect(await screen.findByText("Invitation sent to invite@example.com")).toBeVisible();
    expect(screen.getByLabelText("Invite link for invite@example.com")).toHaveValue("https://app.example/invite/abc");
    // The field is cleared once the invitation exists.
    expect(screen.getByLabelText("Email address")).toHaveValue("");
  });

  it("invites several addresses and keeps the ones that failed", async () => {
    const onInvite = vi.fn()
      .mockResolvedValueOnce({ kind: "invited", email: "a@example.com", link: "https://app.example/invite/a", emailSent: false })
      .mockRejectedValueOnce(new Error("Plan limit reached"));
    render(<ProjectShareDialog {...base.sharing} projectName="Launch" onClose={vi.fn()} onInvite={onInvite} />);
    fireEvent.change(screen.getByLabelText("Email address"), { target: { value: "a@example.com, b@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Invite" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Plan limit reached");
    expect(screen.getByText(/The email couldn't be sent/)).toBeVisible();
    expect(screen.getByLabelText("Email address")).toHaveValue("b@example.com");
  });

  it("changes a role with a saved confirmation and asks before removing someone", async () => {
    const onRoleChange = vi.fn().mockResolvedValue(undefined);
    const onRemoveMember = vi.fn().mockResolvedValue(undefined);
    const onRevokeInvite = vi.fn().mockResolvedValue(undefined);
    render(<ProjectShareDialog {...base.sharing} projectName="Launch" onClose={vi.fn()} onRoleChange={onRoleChange} onRemoveMember={onRemoveMember} onRevokeInvite={onRevokeInvite} />);
    fireEvent.change(screen.getByLabelText("Project role for Sam"), { target: { value: "editor" } });
    expect(onRoleChange).toHaveBeenCalledWith("sam", "editor");
    expect(await screen.findByText("Saved")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Remove Sam from project" }));
    expect(onRemoveMember).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Confirm removing Sam" }));
    expect(onRemoveMember).toHaveBeenCalledWith("sam");
    fireEvent.click(screen.getByRole("button", { name: "Revoke invite for new@example.com" }));
    expect(onRevokeInvite).toHaveBeenCalledWith("invite-1");
  });

  it("rejects duplicate invites and invalid emails", () => {
    const onInvite = vi.fn();
    render(<ProjectShareDialog {...base.sharing} projectName="Launch" onClose={vi.fn()} onInvite={onInvite} />);
    fireEvent.change(screen.getByLabelText("Email address"), { target: { value: "NEW@example.com" } });
    expect(screen.getByRole("button", { name: "Invite" })).toBeDisabled();
    expect(screen.getByText("This person is already a member or has a pending invitation.")).toBeVisible();
    fireEvent.change(screen.getByLabelText("Email address"), { target: { value: "invalid" } });
    expect(screen.getByText("“invalid” is not a valid email address.")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Invite" }));
    expect(onInvite).not.toHaveBeenCalled();
  });

  it("suggests people the user already works with", () => {
    render(<ProjectShareDialog {...base.sharing} projectName="Launch" onClose={vi.fn()} onInvite={vi.fn()} suggestions={[{ id: "lea", name: "Léa", email: "lea@example.com" }, sam]} />);
    // Sam is already a member, so only Léa is suggested.
    const group = screen.getByRole("group", { name: "People you work with" });
    expect(within(group).queryByRole("button", { name: /Sam/ })).not.toBeInTheDocument();
    fireEvent.click(within(group).getByRole("button", { name: /Léa/ }));
    expect(screen.getByLabelText("Email address")).toHaveValue("lea@example.com, ");
  });

  it("lets a member leave, and hides management from them", async () => {
    const onLeave = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();
    render(<ProjectShareDialog {...base.sharing} canManage={false} currentUserId="sam" projectName="Launch" onClose={onClose} onLeave={onLeave} />);
    expect(screen.queryByRole("button", { name: "Invite" })).not.toBeInTheDocument();
    expect(screen.getByText("(you)")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Leave project" }));
    fireEvent.click(screen.getByRole("button", { name: "Leave" }));
    expect(onLeave).toHaveBeenCalledOnce();
    await vi.waitFor(() => expect(onClose).toHaveBeenCalled());
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
    expect(screen.getByRole("button", { name: "Close" })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole("button", { name: "Close" }), { key: "Tab" });
    expect(close).toHaveFocus();
    fireEvent.keyDown(close, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  it("shows loading and empty membership states", () => {
    const props = { projectName: "Launch", onClose: vi.fn(), members: [], invites: [], canManage: true };
    const { rerender } = render(<ProjectShareDialog {...props} loading />);
    expect(screen.getByText("Loading project members…")).toBeVisible();
    rerender(<ProjectShareDialog {...props} />);
    expect(screen.getByText("No members to display.")).toBeVisible();
    expect(screen.getByText("No pending invitations.")).toBeVisible();
  });
});

describe("Task people and planning", () => {
  it("adds and removes people while keeping at least one, and marks the assignee", () => {
    function Harness() {
      const [people, setPeople] = useState<TaskPerson[]>([owner]);
      return <TaskPeoplePicker people={people} availablePeople={[owner, sam]} assigneeId="sam" onPeopleChange={setPeople} />;
    }
    render(<Harness />);
    expect(screen.getByRole("button", { name: "Remove Alex" })).toBeDisabled();
    fireEvent.click(screen.getByText("Add people"));
    fireEvent.change(screen.getByLabelText("Find a project member"), { target: { value: "sam@" } });
    fireEvent.click(screen.getByRole("button", { name: "Sam" }));
    expect(screen.queryByRole("button", { name: "Sam" })).not.toBeInTheDocument();
    expect(screen.getByText("Assignee")).toBeVisible();
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

  it("shows the agile workspace only for software projects, whoever opens them", () => {
    const { rerender } = render(<WorkHubView {...props} />);
    expect(screen.getByRole("tab", { name: /List/ })).toBeVisible();
    expect(screen.getByRole("tab", { name: "Board" })).toBeVisible();
    expect(screen.getByRole("tab", { name: /Notes/ })).toBeVisible();
    expect(screen.queryByRole("tab", { name: "Overview" })).not.toBeInTheDocument();
    // A shared standard project stays standard for its members too.
    rerender(<WorkHubView {...props} collaborationByProject={{ [project.id]: base }} />);
    expect(screen.queryByRole("tab", { name: "Overview" })).not.toBeInTheDocument();
    rerender(<WorkHubView {...props} projects={[{ ...project, projectType: "software" }]} collaborationByProject={{ [project.id]: base }} />);
    expect(screen.getByRole("tab", { name: "Overview" })).toBeVisible();
    expect(screen.queryByRole("tab", { name: /List/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Projects" }));
    expect(props.onOpenProject).toHaveBeenCalledWith("");
  });

  it("saves an edited project through onSaveProject, so a shared one reaches the server", () => {
    const onSaveProject = vi.fn().mockResolvedValue(undefined);
    const shared = { ...project, projectType: "standard" as const };
    render(<WorkHubView {...props} projects={[shared]} onSaveProject={onSaveProject} collaborationByProject={{ [project.id]: base }} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit project" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /Standard/ }));
    fireEvent.click(screen.getAllByRole("option", { name: /Agile · Scrum/ })[0]!);
    fireEvent.click(within(dialog).getByRole("button", { name: "Save changes" }));
    expect(onSaveProject).toHaveBeenCalledWith(expect.objectContaining({ id: project.id, projectType: "software", methodology: "scrum" }));
  });

  it("offers Share on non-software projects too", () => {
    const onInvite = vi.fn();
    const personal = { ...project, projectType: "standard" as const };
    render(<WorkHubView {...props} projects={[personal]} collaborationByProject={{ [project.id]: { ...base, readOnly: false, sharing: { ...base.sharing, canManage: true, onInvite } } }} />);
    fireEvent.click(screen.getByRole("button", { name: "Share" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Email address"), { target: { value: "lea@example.com" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Invite" }));
    expect(onInvite).toHaveBeenCalledWith("lea@example.com", "editor");
  });
});
