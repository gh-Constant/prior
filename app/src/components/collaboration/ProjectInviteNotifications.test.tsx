import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ProjectInviteNotifications } from "./ProjectInviteNotifications";
import { ProjectCollaboration } from "./ProjectCollaboration";
import type { IncomingProjectInvite } from "../../lib/api";

afterEach(cleanup);

const invite: IncomingProjectInvite = { id: "invite-1", projectId: "project-1", projectName: "Launch", inviterName: "Alex", inviterId: "alex", role: "editor", expiresAt: "", createdAt: "" };

describe("ProjectInviteNotifications", () => {
  it("renders nothing without invites", () => {
    const { container } = render(<ProjectInviteNotifications invites={[]} onRespond={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("lets the invitee join or decline", async () => {
    const onRespond = vi.fn().mockResolvedValue(undefined);
    render(<ProjectInviteNotifications invites={[invite]} onRespond={onRespond} />);
    expect(screen.getByText(/Alex/)).toHaveTextContent("Launch");
    fireEvent.click(screen.getByRole("button", { name: "Join" }));
    await waitFor(() => expect(onRespond).toHaveBeenCalledWith(invite, true));
    fireEvent.click(screen.getByRole("button", { name: "Decline" }));
    await waitFor(() => expect(onRespond).toHaveBeenCalledWith(invite, false));
  });
});

describe("ProjectCollaboration offline", () => {
  it("explains that a shared project needs a connection and hides edits", () => {
    render(<ProjectCollaboration
      project={{ id: "project-1", name: "Launch", description: "", status: "active" }}
      issues={[]} states={[{ id: "todo", name: "To do", category: "unstarted" }]} cycles={[]}
      sharing={{ members: [], invites: [] }}
      readOnly offline onCreateIssue={vi.fn()}
    />);
    expect(screen.getByText(/offline/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /new issue/i })).not.toBeInTheDocument();
  });
});
