import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ProjectCollaboration } from "./ProjectCollaboration";
import { ProjectEditor } from "./ProjectEditor";
import { ProjectCycleEditor } from "./ProjectCycleEditor";
import { PersonAvatar } from "./PersonAvatar";
import type { EditableProject, ProjectCollaborationProps } from "./types";

afterEach(cleanup);

const project: EditableProject = { id: "p", name: "Launch", description: "Brief", icon: "rocket", status: "active", areaId: "work", createdAt: "created", updatedAt: "updated", deletedAt: null, health: "On track", startDate: "2026-09-01", targetDate: "2026-09-30" };
const props: ProjectCollaborationProps = {
  project, readOnly: false,
  states: [
    { id: "inbox", name: "Backlog", category: "backlog" },
    { id: "next", name: "Todo", category: "unstarted" },
    { id: "in_progress", name: "In progress", category: "started" },
    { id: "waiting", name: "Waiting", category: "started" },
    { id: "done", name: "Done", category: "completed" },
  ],
  issues: [{ id: "one", title: "Design", stateId: "next", people: [] }, { id: "two", title: "Ship", stateId: "done", people: [] }],
  cycles: [{ id: "c", name: "Sprint", phase: "current", dateLabel: "", startsOn: "2026-09-01", endsOn: "2026-09-30", issueIds: ["one", "two", "deleted"], issueCount: 99, completedCount: 99 }],
  sharing: { members: [{ id: "alex", name: "Alex", role: "owner", avatarUrl: "https://example.com/alex.jpg" }], invites: [] },
};

describe("collaboration editing actions", () => {
  it("keeps project editing across tabs, switches creation actions, preserves notes and hides empty placeholders", () => {
    const onEditProject = vi.fn(), onCreateCycle = vi.fn(), onEditCycle = vi.fn(), onOpenNotes = vi.fn();
    render(<ProjectCollaboration {...props} onEditProject={onEditProject} onCreateIssue={vi.fn()} onCreateCycle={onCreateCycle} onEditCycle={onEditCycle} onOpenNotes={onOpenNotes} />);
    expect(screen.queryByRole("heading", { name: "Milestones" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Latest update" })).not.toBeInTheDocument();
    expect(within(screen.getByRole("group", { name: "Project people" })).getByRole("img", { name: "Alex" }).querySelector("img")).toHaveAttribute("src", "https://example.com/alex.jpg");
    fireEvent.click(screen.getByRole("button", { name: "Open project notes" }));
    expect(onOpenNotes).toHaveBeenCalledOnce();
    for (const tab of ["Overview", "Issues", "Board", "Cycles"]) {
      fireEvent.click(screen.getByRole("tab", { name: tab }));
      fireEvent.click(screen.getByRole("button", { name: "Edit project" }));
    }
    expect(onEditProject).toHaveBeenCalledTimes(4);
    expect(screen.queryByRole("button", { name: "New issue" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "New cycle" }));
    fireEvent.click(screen.getByRole("button", { name: "Edit Sprint" }));
    expect(onCreateCycle).toHaveBeenCalledOnce();
    expect(onEditCycle).toHaveBeenCalledWith("c");
    expect(screen.getByText("1 of 2 issues complete")).toBeVisible();
  });

  it("moves via drag-drop silently, prevents duplicate moves and waits for parent data", async () => {
    let finish!: () => void;
    const onMoveIssue = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    const { rerender } = render(<ProjectCollaboration {...props} onMoveIssue={onMoveIssue} />);
    fireEvent.click(screen.getByRole("tab", { name: "Board" }));
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    const dataTransfer = { setData: vi.fn(), effectAllowed: "", dropEffect: "" };
    const card = screen.getByText("Design").closest("article")!;
    expect(card).toHaveAttribute("draggable", "true");
    fireEvent.dragStart(card, { dataTransfer });
    const column = screen.getByRole("region", { name: "Waiting" });
    fireEvent.dragOver(column, { dataTransfer });
    expect(column).toHaveClass("collab-drop-target");
    fireEvent.drop(column, { dataTransfer });
    expect(onMoveIssue).toHaveBeenCalledWith("one", "waiting");
    expect(onMoveIssue).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Todo" })).getByText("Design")).toBeVisible();
    await act(async () => finish());
    rerender(<ProjectCollaboration {...props} issues={[{ ...props.issues[0], stateId: "waiting" }, props.issues[1]]} onMoveIssue={onMoveIssue} />);
    expect(within(screen.getByRole("region", { name: "Waiting" })).getByText("Design")).toBeVisible();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("supports dragging and retains the original card on failure for retry", async () => {
    const onMoveIssue = vi.fn().mockRejectedValueOnce(new Error("Move failed")).mockResolvedValue(undefined);
    render(<ProjectCollaboration {...props} onMoveIssue={onMoveIssue} />);
    fireEvent.click(screen.getByRole("tab", { name: "Board" }));
    const dataTransfer = { setData: vi.fn(), effectAllowed: "", dropEffect: "" };
    const card = screen.getByText("Design").closest("article")!;
    expect(card).toHaveAttribute("draggable", "true");
    fireEvent.dragStart(card, { dataTransfer });
    const column = screen.getByRole("region", { name: "In progress" });
    fireEvent.dragOver(column, { dataTransfer });
    expect(column).toHaveClass("collab-drop-target");
    fireEvent.drop(column, { dataTransfer });
    expect(onMoveIssue).toHaveBeenCalledWith("one", "in_progress");
    expect(await screen.findByRole("alert")).toHaveTextContent("Move failed");
    expect(within(screen.getByRole("region", { name: "Todo" })).getByText("Design")).toBeVisible();
    const retryCard = screen.getByText("Design").closest("article")!;
    fireEvent.dragStart(retryCard, { dataTransfer });
    fireEvent.dragOver(column, { dataTransfer });
    fireEvent.drop(column, { dataTransfer });
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    expect(onMoveIssue).toHaveBeenCalledTimes(2);
  });

  it("blocks all edit actions and dragging for viewers", () => {
    const callback = vi.fn();
    render(<ProjectCollaboration {...props} readOnly onEditProject={callback} onMoveIssue={vi.fn(async () => {})} onCreateCycle={callback} onEditCycle={callback} />);
    expect(screen.queryByRole("button", { name: "Edit project" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Board" }));
    expect(screen.getByText("Design").closest("article")).toHaveAttribute("draggable", "false");
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Cycles" }));
    expect(screen.queryByRole("button", { name: "New cycle" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit Sprint" })).not.toBeInTheDocument();
    expect(callback).not.toHaveBeenCalled();
  });
});

describe("project editor", () => {
  it("saves all editable fields and preserves the full project identity", async () => {
    const onSave = vi.fn(async () => {}), onClose = vi.fn();
    render(<ProjectEditor project={project} avatarUrl="https://example.com/photo.jpg" onSave={onSave} onClose={onClose} />);
    fireEvent.change(screen.getByLabelText("Project name"), { target: { value: " New name " } });
    fireEvent.change(screen.getByLabelText("Description"), { target: { value: "New description" } });
    fireEvent.change(screen.getByLabelText("Project status"), { target: { value: "paused" } });
    fireEvent.change(screen.getByLabelText("Project health"), { target: { value: "At risk" } });
    fireEvent.change(screen.getByLabelText("Target date"), { target: { value: "2026-10-01" } });
    fireEvent.click(screen.getByRole("button", { name: "Use my profile photo" }));
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(onSave).toHaveBeenCalledWith({ ...project, name: "New name", description: "New description", status: "paused", health: "At risk", targetDate: "2026-10-01", icon: "https://example.com/photo.jpg" });
  });

  it("validates dates, reports failed saves, and preserves the draft for retry", async () => {
    const onSave = vi.fn().mockRejectedValueOnce(new Error("Offline")).mockResolvedValue(undefined), onClose = vi.fn();
    render(<ProjectEditor project={project} onSave={onSave} onClose={onClose} />);
    fireEvent.change(screen.getByLabelText("Target date"), { target: { value: "2026-08-01" } });
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Target date"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Project health"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Offline");
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(onSave).toHaveBeenLastCalledWith({ ...project, targetDate: null, health: null });
  });

  it("supports image upload and includes the resulting icon in the save", async () => {
    const onSave = vi.fn(async () => {});
    render(<ProjectEditor project={project} onSave={onSave} onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Upload project image"), { target: { files: [new File(["image"], "photo.png", { type: "image/png" })] } });
    await waitFor(() => expect(screen.getByRole("button", { name: "Save changes" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ icon: expect.stringMatching(/^data:image\/png;base64,/) })));
  });
});

describe("cycle editor", () => {
  it("requires dates and saves selected issues across search filters", async () => {
    const onSave = vi.fn(async () => {}), onClose = vi.fn();
    render(<ProjectCycleEditor issues={props.issues} onSave={onSave} onClose={onClose} />);
    fireEvent.change(screen.getByLabelText("Cycle name"), { target: { value: " Sprint " } });
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Start date"), { target: { value: "2026-09-18" } });
    fireEvent.change(screen.getByLabelText("End date"), { target: { value: "2026-09-17" } });
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("End date"), { target: { value: "2026-09-30" } });
    fireEvent.click(screen.getByLabelText("Design"));
    fireEvent.change(screen.getByLabelText("Find project issues"), { target: { value: "ship" } });
    expect(screen.queryByLabelText("Design")).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Ship"));
    expect(screen.getByRole("status")).toHaveTextContent("2 project issues selected");
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(onSave).toHaveBeenCalledWith({ name: "Sprint", startsOn: "2026-09-18", endsOn: "2026-09-30", issueIds: ["one", "two"] });
  });

  it("edits existing assignment, blocks closing/duplicate saves while pending and retains failures", async () => {
    let reject!: (error: Error) => void;
    const onSave = vi.fn(() => new Promise<void>((_, fail) => { reject = fail; })), onClose = vi.fn();
    render(<ProjectCycleEditor cycle={{ name: "Sprint", startsOn: "2026-09-01", endsOn: "2026-09-30", issueIds: ["one", "two"] }} issues={props.issues} onSave={onSave} onClose={onClose} />);
    fireEvent.click(screen.getByLabelText("Design"));
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(screen.getByLabelText("Cycle name")).toBeDisabled();
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "Close dialog" }));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.submit(screen.getByLabelText("Cycle name").closest("form")!);
    expect(onSave).toHaveBeenCalledOnce();
    await act(async () => reject(new Error("Unable to save cycle")));
    expect(screen.getByRole("alert")).toHaveTextContent("Unable to save cycle");
    expect(screen.getByLabelText("Ship")).toBeChecked();
    expect(screen.getByLabelText("Design")).not.toBeChecked();
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ issueIds: ["two"] }));
  });
});

it("falls back to initials after avatar failure and retries when the URL changes", () => {
  const { container, rerender } = render(<PersonAvatar person={{ id: "a", name: "Alex", avatarUrl: "https://example.com/old.jpg" }} />);
  fireEvent.error(container.querySelector("img")!);
  expect(container.querySelector("img")).toBeNull();
  expect(screen.getByText("A")).toBeInTheDocument();
  rerender(<PersonAvatar person={{ id: "a", name: "Alex", avatarUrl: "https://example.com/new.jpg" }} />);
  expect(container.querySelector("img")).toHaveAttribute("src", "https://example.com/new.jpg");
});
