import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, type PokerSession } from "../../lib/api";
import { setOnline } from "../../lib/connectivity";
import { REALTIME_EVENT } from "../../lib/realtime";
import { memoryStorage } from "../../test/memoryStorage";
import { PlanningPokerPanel } from "./PlanningPokerPanel";

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return {
    ...actual,
    api: { pokerActive: vi.fn(), pokerStart: vi.fn(), pokerGet: vi.fn(), pokerVote: vi.fn(), pokerReveal: vi.fn(), pokerRevote: vi.fn(), pokerSetCurrent: vi.fn(), pokerEstimate: vi.fn(), pokerClose: vi.fn() },
  };
});
vi.mock("../../lib/auth", () => ({ getToken: vi.fn(async () => "session"), getUser: vi.fn(() => ({ id: "me" })) }));

const tasks = [
  { id: "t1", title: "Login page", storyPoints: null, completed: false },
  { id: "t2", title: "Billing webhook", storyPoints: 3, completed: false },
  { id: "t3", title: "Already shipped", storyPoints: 2, completed: true },
];
const me = { id: "me", name: "Ada", avatarUrl: "" };

function session(overrides: Partial<PokerSession> = {}): PokerSession {
  return {
    id: "s1", projectId: "p1", status: "active", deck: "fibonacci", facilitatorId: "me", canControl: true, currentIndex: 0, round: 1, revealed: false,
    items: [{ taskId: "t1", title: "Login page", storyPoints: null, finalPoints: null }, { taskId: "t2", title: "Billing webhook", storyPoints: 3, finalPoints: null }],
    participants: [
      { userId: "me", displayName: "Ada", avatarUrl: "", role: "owner", online: true, voted: false, vote: null },
      { userId: "bob", displayName: "Bob Martin", avatarUrl: "", role: "editor", online: true, voted: true, vote: null },
      { userId: "eve", displayName: "Eve", avatarUrl: "", role: "viewer", online: true, voted: false, vote: null },
    ],
    myVote: null, createdAt: "2026-10-02T09:00:00Z", updatedAt: "2026-10-02T09:00:00Z",
    ...overrides,
  };
}

function shared(props: Partial<React.ComponentProps<typeof PlanningPokerPanel>> = {}) {
  return render(<PlanningPokerPanel projectId="p1" projectName="Apollo" shared role="owner" currentUser={me} tasks={tasks} cycles={[]} onSetPoints={vi.fn(async () => undefined)} {...props} />);
}

beforeEach(() => {
  Object.defineProperty(window, "localStorage", { configurable: true, value: memoryStorage() });
  setOnline(true);
  vi.mocked(api.pokerActive).mockResolvedValue({ session: session() });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); setOnline(true); });

describe("PlanningPokerPanel (shared)", () => {
  it("shows face-down cards before the reveal and the values after", async () => {
    shared();
    const table = await screen.findByRole("list", { name: "Players" });
    expect(within(table).getByRole("img", { name: "Bob Martin: has voted" })).toBeInTheDocument();
    expect(within(table).getByRole("img", { name: "Ada (you): is thinking" })).toBeInTheDocument();
    expect(within(table).queryByText("8")).toBeNull();
    expect(screen.getByText("1 of 2 voted")).toBeInTheDocument();
    // Eve only watches: no card for her.
    expect(within(table).queryByText("Eve")).toBeNull();

    vi.mocked(api.pokerActive).mockResolvedValue({
      session: session({
        revealed: true, myVote: "5",
        participants: [
          { userId: "me", displayName: "Ada", avatarUrl: "", role: "owner", online: true, voted: true, vote: "5" },
          { userId: "bob", displayName: "Bob Martin", avatarUrl: "", role: "editor", online: true, voted: true, vote: "8" },
          { userId: "eve", displayName: "Eve", avatarUrl: "", role: "viewer", online: true, voted: false, vote: null },
        ],
      }),
    });
    act(() => { window.dispatchEvent(new CustomEvent(REALTIME_EVENT, { detail: { type: "poker_required" } })); });
    expect(await within(table).findByRole("img", { name: "Bob Martin: 8" })).toBeInTheDocument();
    expect(within(table).getByRole("img", { name: "Ada (you): 5" })).toBeInTheDocument();
    expect(screen.getByText("The votes are split. Ask the lowest and highest to explain.")).toBeInTheDocument();
    expect(screen.getByText("Lowest")).toBeInTheDocument();
    // Proposed estimate: the deck card closest to the 6.5 average (ties up).
    expect(screen.getByRole("button", { name: /Accept 8 points/ })).toBeInTheDocument();
    // The cards are on the table: the hand is locked.
    expect(screen.getByRole("button", { name: "13" })).toBeDisabled();
  });

  it("highlights a consensus", async () => {
    vi.mocked(api.pokerActive).mockResolvedValue({
      session: session({ revealed: true, myVote: "5", participants: [
        { userId: "me", displayName: "Ada", avatarUrl: "", role: "owner", online: true, voted: true, vote: "5" },
        { userId: "bob", displayName: "Bob Martin", avatarUrl: "", role: "editor", online: true, voted: true, vote: "5" },
      ] }),
    });
    shared();
    expect(await screen.findByText("Everyone agrees: 5 points")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Accept 5 points/ })).toBeInTheDocument();
  });

  it("hides the controls from people who cannot control the table", async () => {
    vi.mocked(api.pokerActive).mockResolvedValue({ session: session({ canControl: false, facilitatorId: "bob" }) });
    shared({ role: "editor" });
    expect(await screen.findByText("Waiting for Bob Martin to reveal the cards.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reveal cards" })).toBeNull();
    expect(screen.queryByRole("button", { name: "End session" })).toBeNull();
    // They still play.
    expect(screen.getByRole("button", { name: "5" })).toBeEnabled();
  });

  it("lets viewers watch without cards", async () => {
    shared({ role: "viewer" });
    expect(await screen.findByText("You are watching this session. Only owners and editors play cards.")).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Pick a card" })).toBeNull();
  });

  it("votes optimistically, then reveals with the controller button", async () => {
    vi.mocked(api.pokerVote).mockResolvedValue(session({ myVote: "5", participants: [
      { userId: "me", displayName: "Ada", avatarUrl: "", role: "owner", online: true, voted: true, vote: null },
      { userId: "bob", displayName: "Bob Martin", avatarUrl: "", role: "editor", online: true, voted: true, vote: null },
    ] }));
    vi.mocked(api.pokerReveal).mockResolvedValue(session({ revealed: true, myVote: "5" }));
    shared();
    const five = await screen.findByRole("button", { name: "5" });
    expect(screen.getByRole("button", { name: "Reveal cards" })).toBeEnabled();
    fireEvent.click(five);
    expect(five).toHaveAttribute("aria-pressed", "true");
    await waitFor(() => expect(api.pokerVote).toHaveBeenCalledWith("p1", "s1", "t1", "5", "session"));
    fireEvent.click(screen.getByRole("button", { name: "Reveal cards" }));
    await waitFor(() => expect(api.pokerReveal).toHaveBeenCalledWith("p1", "s1", "session"));
  });

  it("plays from the keyboard: a number picks a card, Enter reveals", async () => {
    vi.mocked(api.pokerVote).mockResolvedValue(session({ myVote: "8" }));
    vi.mocked(api.pokerReveal).mockResolvedValue(session({ revealed: true, myVote: "8" }));
    shared();
    await screen.findByRole("button", { name: "8" });
    fireEvent.keyDown(window, { key: "8" });
    await waitFor(() => expect(api.pokerVote).toHaveBeenCalledWith("p1", "s1", "t1", "8", "session"));
    fireEvent.keyDown(window, { key: "Enter" });
    await waitFor(() => expect(api.pokerReveal).toHaveBeenCalled());
  });

  it("waits for the next digit when a card is ambiguous", async () => {
    vi.mocked(api.pokerVote).mockResolvedValue(session({ myVote: "13" }));
    shared();
    await screen.findByRole("button", { name: "13" });
    fireEvent.keyDown(window, { key: "1" });
    fireEvent.keyDown(window, { key: "3" });
    await waitFor(() => expect(api.pokerVote).toHaveBeenCalledWith("p1", "s1", "t1", "13", "session"));
    expect(api.pokerVote).toHaveBeenCalledTimes(1);
  });

  it("accepts the suggested estimate and moves on", async () => {
    vi.mocked(api.pokerActive).mockResolvedValue({
      session: session({ revealed: true, myVote: "3", participants: [
        { userId: "me", displayName: "Ada", avatarUrl: "", role: "owner", online: true, voted: true, vote: "3" },
        { userId: "bob", displayName: "Bob Martin", avatarUrl: "", role: "editor", online: true, voted: true, vote: "3" },
      ] }),
    });
    vi.mocked(api.pokerEstimate).mockResolvedValue({ session: session({ currentIndex: 1 }), task: {} as never });
    shared();
    fireEvent.click(await screen.findByRole("button", { name: /Accept 3 points/ }));
    await waitFor(() => expect(api.pokerEstimate).toHaveBeenCalledWith("p1", "s1", { taskId: "t1", storyPoints: 3, advance: true }, "session"));
    expect(await screen.findByText("Task 2 of 2")).toBeInTheDocument();
  });

  it("refetches on poker realtime events, debounced, and ignores other events", async () => {
    shared();
    await screen.findByRole("list", { name: "Players" });
    expect(api.pokerActive).toHaveBeenCalledTimes(1);
    act(() => { window.dispatchEvent(new CustomEvent(REALTIME_EVENT, { detail: { type: "comments_required" } })); });
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(api.pokerActive).toHaveBeenCalledTimes(1);
    act(() => {
      for (let i = 0; i < 3; i += 1) window.dispatchEvent(new CustomEvent(REALTIME_EVENT, { detail: { type: "poker_required" } }));
    });
    await waitFor(() => expect(api.pokerActive).toHaveBeenCalledTimes(2));
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(api.pokerActive).toHaveBeenCalledTimes(2);
  });

  it("freezes the table offline", async () => {
    shared();
    await screen.findByRole("list", { name: "Players" });
    act(() => { setOnline(false); });
    expect(await screen.findByText(/You are offline/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reveal cards" })).toBeDisabled();
    expect(screen.queryByRole("group", { name: "Pick a card" })).toBeNull();
  });

  it("shows a retry when the table cannot be loaded", async () => {
    vi.mocked(api.pokerActive).mockRejectedValueOnce(new Error("boom"));
    shared();
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load the table");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(api.pokerActive).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole("list", { name: "Players" })).toBeInTheDocument();
  });

  it("starts a session from the preselected unestimated tasks", async () => {
    vi.mocked(api.pokerActive).mockResolvedValue({ session: null });
    vi.mocked(api.pokerStart).mockResolvedValue(session());
    shared();
    const start = await screen.findByRole("button", { name: "Deal the cards" });
    expect(screen.getByText("1 task selected")).toBeInTheDocument();
    expect(screen.queryByText("Already shipped")).toBeNull();
    fireEvent.click(screen.getByRole("radio", { name: /T-shirt sizes/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Billing webhook/ }));
    fireEvent.click(start);
    await waitFor(() => expect(api.pokerStart).toHaveBeenCalledWith("p1", { taskIds: ["t1", "t2"], deck: "tshirt" }, "session"));
    expect(await screen.findByRole("list", { name: "Players" })).toBeInTheDocument();
  });

  it("keeps the hand, controls and tasks in the sticky dock layout used on phones", async () => {
    shared();
    const hand = await screen.findByRole("group", { name: "Pick a card" });
    const dock = hand.closest(".poker-dock");
    expect(dock).not.toBeNull();
    expect(within(dock as HTMLElement).getByRole("button", { name: "Reveal cards" })).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Tasks to estimate" })).toBeInTheDocument();
    expect(within(hand).getAllByRole("button")).toHaveLength(10);
  });
});

describe("PlanningPokerPanel (solo)", () => {
  it("plays the same table alone and saves the accepted estimate on the task", async () => {
    const onSetPoints = vi.fn(async () => undefined);
    const onShare = vi.fn();
    render(<PlanningPokerPanel projectId="p1" projectName="Apollo" shared={false} role="owner" currentUser={me} tasks={tasks} cycles={[]} onSetPoints={onSetPoints}
      sharing={{ members: [], invites: [], canManage: true }} />);
    expect(api.pokerActive).not.toHaveBeenCalled();
    expect(screen.getByText(/You are playing solo/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Deal the cards" }));
    expect(await screen.findByText("Task 1 of 1")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Login page" })).toBeInTheDocument();

    expect(screen.getByRole("button", { name: "Reveal cards" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "5" }));
    fireEvent.click(screen.getByRole("button", { name: "Reveal cards" }));
    const table = screen.getByRole("list", { name: "Players" });
    expect(within(table).getByRole("img", { name: "Ada (you): 5" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Accept 5 points/ }));
    await waitFor(() => expect(onSetPoints).toHaveBeenCalledWith("t1", 5));
    expect(await screen.findByText("Everything is estimated")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Finish session" }));
    expect(await screen.findByRole("button", { name: "Deal the cards" })).toBeInTheDocument();
    expect(onShare).not.toHaveBeenCalled();
  });

  it("opens the sharing dialog from the call to action", async () => {
    render(<PlanningPokerPanel projectId="p1" projectName="Apollo" shared={false} role="owner" currentUser={me} tasks={tasks} cycles={[]} onSetPoints={vi.fn()}
      sharing={{ members: [], invites: [], canManage: true, onInvite: vi.fn() }} />);
    fireEvent.click(screen.getByRole("button", { name: "Share to play with your team" }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  it("surfaces a failed save and stays on the task", async () => {
    const onSetPoints = vi.fn(async () => { throw new Error("Read-only project"); });
    render(<PlanningPokerPanel projectId="p1" projectName="Apollo" shared={false} role="owner" currentUser={me} tasks={tasks} cycles={[]} onSetPoints={onSetPoints} />);
    fireEvent.click(screen.getByRole("button", { name: "Deal the cards" }));
    fireEvent.click(await screen.findByRole("button", { name: "3" }));
    fireEvent.click(screen.getByRole("button", { name: "Reveal cards" }));
    fireEvent.click(screen.getByRole("button", { name: /Accept 3 points/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Read-only project");
    expect(screen.getByText("Task 1 of 1")).toBeInTheDocument();
  });

  it("explains when there is nothing to estimate", () => {
    render(<PlanningPokerPanel projectId="p1" projectName="Apollo" shared={false} role="owner" currentUser={me} tasks={[]} cycles={[]} onSetPoints={vi.fn()} />);
    expect(screen.getByText("Nothing to estimate")).toBeInTheDocument();
  });
});
