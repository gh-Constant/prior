import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, type TaskComment } from "../../lib/api";
import { REALTIME_EVENT } from "../../lib/realtime";
import { MentionNotifications } from "./MentionNotifications";
import { TaskComments } from "./TaskComments";

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return { ...actual, api: { listTaskComments: vi.fn(), createTaskComment: vi.fn(), updateTaskComment: vi.fn(), deleteTaskComment: vi.fn() } };
});
vi.mock("../../lib/auth", () => ({ getToken: vi.fn(async () => "session"), getUser: vi.fn(() => ({ id: "me" })) }));

const members = [
  { userId: "me", displayName: "Ada" },
  { userId: "bob", displayName: "Bob Martin", avatarUrl: "" },
];
const comment = (overrides: Partial<TaskComment>): TaskComment => ({ id: "c1", taskId: "t1", projectId: "p1", author: { id: "bob", displayName: "Bob Martin" }, body: "Hello", mentions: [], createdAt: new Date(Date.now() - 3 * 60_000).toISOString(), ...overrides });

beforeEach(() => {
  vi.mocked(api.listTaskComments).mockResolvedValue({ comments: [
    comment({ id: "c1", body: "See https://example.com @Ada", mentions: ["me"], editedAt: new Date().toISOString() }),
    comment({ id: "c2", author: null, body: "Old note" }),
    comment({ id: "c3", author: { id: "me", displayName: "Ada" }, body: "Mine" }),
  ] });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("TaskComments", () => {
  it("renders links, mentions, edited markers, relative times and deleted users", async () => {
    render(<TaskComments projectId="p1" taskId="t1" currentUserId="me" role="editor" members={members} />);
    expect(await screen.findByRole("link", { name: "https://example.com" })).toHaveAttribute("rel", "noopener noreferrer nofollow");
    expect(screen.getByText("@Ada")).toHaveClass("task-comment-mention");
    expect(screen.getByText("(edited)")).toBeInTheDocument();
    expect(screen.getByText("Deleted user")).toBeInTheDocument();
    expect(screen.getAllByText("3 minutes ago").length).toBeGreaterThan(0);
    // An editor edits and deletes only their own comment.
    expect(screen.getAllByRole("button", { name: "Edit" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: /^Delete the comment/ })).toHaveLength(1);
  });

  it("posts with @mention autocomplete and refreshes on realtime events", async () => {
    vi.mocked(api.createTaskComment).mockImplementation(async (_project, _task, input) => comment({ id: input.id, author: { id: "me", displayName: "Ada" }, body: input.body, mentions: input.mentions }));
    render(<TaskComments projectId="p1" taskId="t1" currentUserId="me" role="editor" members={members} />);
    await screen.findByText("Mine");
    const box = screen.getByRole("combobox", { name: "New comment" });
    fireEvent.change(box, { target: { value: "Thanks @bo", selectionStart: 10 } });
    const option = await screen.findByRole("option", { name: /Bob Martin/ });
    expect(screen.queryByRole("option", { name: /Ada/ })).toBeNull();
    fireEvent.keyDown(box, { key: "Enter" });
    expect(box).toHaveValue("Thanks @Bob Martin ");
    expect(option).not.toBeInTheDocument();
    fireEvent.keyDown(box, { key: "Enter", ctrlKey: true });
    await waitFor(() => expect(api.createTaskComment).toHaveBeenCalledWith("p1", "t1", expect.objectContaining({ body: "Thanks @Bob Martin", mentions: ["bob"] }), "session"));
    expect(await screen.findByText("@Bob Martin")).toBeInTheDocument();
    act(() => { window.dispatchEvent(new CustomEvent(REALTIME_EVENT, { detail: { type: "comments_required" } })); });
    await waitFor(() => expect(api.listTaskComments).toHaveBeenCalledTimes(2));
  });

  it("is read-only for viewers, and owners can delete any comment", async () => {
    const { unmount } = render(<TaskComments projectId="p1" taskId="t1" currentUserId="me" role="viewer" members={members} />);
    await screen.findByText("Mine");
    expect(screen.queryByRole("combobox", { name: "New comment" })).toBeNull();
    expect(screen.getByText("You can read the comments of this project but not write.")).toBeInTheDocument();
    unmount();
    vi.mocked(api.deleteTaskComment).mockResolvedValue(undefined);
    render(<TaskComments projectId="p1" taskId="t1" currentUserId="me" role="owner" members={members} />);
    await screen.findByText("Mine");
    const deletes = screen.getAllByRole("button", { name: /^Delete the comment/ });
    expect(deletes).toHaveLength(3);
    fireEvent.click(deletes[0]);
    await waitFor(() => expect(api.deleteTaskComment).toHaveBeenCalledWith("p1", "t1", "c1", "session"));
    await waitFor(() => expect(screen.queryByText("https://example.com")).toBeNull());
  });
});

describe("MentionNotifications", () => {
  it("shows unread mentions with open and mark-as-read actions", async () => {
    const onOpen = vi.fn(async () => undefined);
    const onRead = vi.fn(async () => undefined);
    const mention = { commentId: "c1", taskId: "t1", taskTitle: "Ship it", projectId: "p1", projectName: "Launch", authorName: "Bob", excerpt: "please review", createdAt: "" };
    render(<MentionNotifications mentions={[mention, { ...mention, commentId: "c2" }, { ...mention, commentId: "c3", readAt: "x" }]} onOpen={onOpen} onRead={onRead} />);
    expect(screen.getByRole("region", { name: "Mentions (2)" })).toBeInTheDocument();
    expect(screen.getAllByText("Bob mentioned you on “Ship it” in Launch")).toHaveLength(2);
    fireEvent.click(screen.getAllByRole("button", { name: "Open" })[0]);
    await waitFor(() => expect(onOpen).toHaveBeenCalledWith(mention));
    fireEvent.click(screen.getByRole("button", { name: "Mark all 2 as read" }));
    await waitFor(() => expect(onRead).toHaveBeenCalledWith([]));
  });
});
