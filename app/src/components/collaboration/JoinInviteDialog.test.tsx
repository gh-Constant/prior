import "@testing-library/jest-dom/vitest";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { JoinInviteDialog, alreadyCovered, canPromptToJoin, joinFailure, type JoinInviteDialogProps } from "./JoinInviteDialog";
import { ApiCodeError, ApiRequestError, PlanLimitError } from "../../lib/api";
import type { InvitePreview } from "../../lib/gamification/state";

afterEach(cleanup);

const TOKEN = "ab".repeat(32);
const preview: InvitePreview = { kind: "link", projectName: "Launch", projectIcon: "folder", inviterName: "Alex", inviterAvatarUrl: "", memberCount: 3, role: "editor", status: "pending" };

function setup(overrides: Partial<JoinInviteDialogProps> = {}, previewValue: Partial<InvitePreview> = {}) {
  const props: JoinInviteDialogProps = {
    token: TOKEN,
    ready: true,
    loadPreview: vi.fn().mockResolvedValue({ ...preview, ...previewValue }),
    onJoin: vi.fn().mockResolvedValue({ projectId: "project-1", result: "joined", role: "editor" }),
    onJoined: vi.fn(),
    onAlreadyMember: vi.fn(),
    onInvalid: vi.fn(),
    onLater: vi.fn(),
    onDecline: vi.fn(),
    ...overrides,
  };
  const view = render(<JoinInviteDialog {...props} />);
  return { props, view };
}

describe("canPromptToJoin", () => {
  const base = { signedIn: true, onboardingOpen: false, tourOpen: false, onboardingKnown: true, onboardingPending: false };
  it("waits for sign-in, the onboarding and the tour", () => {
    expect(canPromptToJoin(base)).toBe(true);
    expect(canPromptToJoin({ ...base, signedIn: false })).toBe(false);
    expect(canPromptToJoin({ ...base, onboardingOpen: true })).toBe(false);
    expect(canPromptToJoin({ ...base, tourOpen: true })).toBe(false);
    // The account's onboarding status is not loaded yet, or it is about to open.
    expect(canPromptToJoin({ ...base, onboardingKnown: false })).toBe(false);
    expect(canPromptToJoin({ ...base, onboardingPending: true })).toBe(false);
  });
});

// Mirrors how App wires the dialog: the onboarding and the tour replace the
// whole screen (so the dialog is not mounted), and their buttons flip the same
// flags App keeps. The invitation is known (a sync already stored it) before
// the onboarding even opens, as for an account that just signed up on a link.
function SignupFlow({ finish }: { readonly finish: "skip" | "complete" }) {
  const [onboardingOpen, setOnboardingOpen] = useState(true);
  const [onboardingPutOff, setOnboardingPutOff] = useState(false);
  const [tourOpen, setTourOpen] = useState(false);
  const needsOnboarding = onboardingOpen; // the server marks it done when it is finished
  const ready = canPromptToJoin({ signedIn: true, onboardingOpen, tourOpen, onboardingKnown: true, onboardingPending: needsOnboarding && !onboardingPutOff });
  if (onboardingOpen) return <button type="button" onClick={() => { setOnboardingOpen(false); setOnboardingPutOff(true); setTourOpen(true); }}>Start using Prior</button>;
  if (tourOpen) return finish === "skip"
    ? <button type="button" onClick={() => setTourOpen(false)}>Skip</button>
    : <button type="button" onClick={() => setTourOpen(false)}>Go to Today</button>;
  return <JoinInviteDialog token={TOKEN} ready={ready} loadPreview={async () => preview} onJoin={vi.fn()} onJoined={vi.fn()} onAlreadyMember={vi.fn()} onInvalid={vi.fn()} onLater={vi.fn()} onDecline={vi.fn()} />;
}

describe("sign-up from a share link: the dialog follows the onboarding and the tour", () => {
  it.each([["skip", "Skip"], ["complete", "Go to Today"]] as const)("appears right after the tour is %sd, without a reload", async (finish, label) => {
    render(<SignupFlow finish={finish} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Start using Prior" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: label }));
    expect(await screen.findByRole("dialog", { name: /Join “Launch”\?/ })).toBeInTheDocument();
  });
});

describe("JoinInviteDialog", () => {
  it("shows nothing, and asks the server nothing, until it is ready (after the onboarding)", async () => {
    const { props, view } = setup({ ready: false });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(props.loadPreview).not.toHaveBeenCalled();
    view.rerender(<JoinInviteDialog {...props} ready />);
    expect(await screen.findByRole("dialog", { name: /Join “Launch”\?/ })).toBeInTheDocument();
    expect(props.loadPreview).toHaveBeenCalledWith(TOKEN);
    expect(props.onJoin).not.toHaveBeenCalled();
  });

  it("explains who invites, the role and the team before asking", async () => {
    setup();
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("Launch");
    expect(dialog).toHaveTextContent("Invited by Alex");
    expect(dialog).toHaveTextContent("3 people work here");
    expect(dialog).toHaveTextContent(/as an editor/);
  });

  it("describes a viewer link as read-only", async () => {
    setup({}, { role: "viewer" });
    expect(await screen.findByText(/as a viewer/)).toBeInTheDocument();
  });

  it("joins only when Join is pressed, with the token, then reports the result", async () => {
    const { props } = setup();
    await screen.findByRole("dialog");
    expect(props.onJoin).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Join" }));
    await waitFor(() => expect(props.onJoin).toHaveBeenCalledWith(TOKEN));
    await waitFor(() => expect(props.onJoined).toHaveBeenCalledWith({ projectId: "project-1", result: "joined", role: "editor" }, expect.objectContaining({ projectName: "Launch" })));
    expect(props.onDecline).not.toHaveBeenCalled();
  });

  it("Later keeps the link pending and joins nothing", async () => {
    const { props } = setup();
    await screen.findByRole("dialog");
    fireEvent.click(screen.getByRole("button", { name: "Later" }));
    expect(props.onLater).toHaveBeenCalledTimes(1);
    expect(props.onJoin).not.toHaveBeenCalled();
    expect(props.onDecline).not.toHaveBeenCalled();
  });

  it("Decline dismisses the link for good without joining", async () => {
    const { props } = setup();
    await screen.findByRole("dialog");
    fireEvent.click(screen.getByRole("button", { name: "Decline" }));
    expect(props.onDecline).toHaveBeenCalledTimes(1);
    expect(props.onJoin).not.toHaveBeenCalled();
  });

  it("offers an upgrade to a viewer who opens an editor link", async () => {
    setup({}, { alreadyMember: true, currentRole: "viewer", projectId: "project-1" });
    expect(await screen.findByRole("dialog", { name: /Become editor of “Launch”\?/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Become editor" })).toBeInTheDocument();
  });

  it("does not ask people who already have the role: they just open the project", async () => {
    const { props } = setup({}, { alreadyMember: true, currentRole: "editor", projectId: "project-1" });
    await waitFor(() => expect(props.onAlreadyMember).toHaveBeenCalledWith(expect.objectContaining({ projectId: "project-1" })));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(alreadyCovered({ ...preview, alreadyMember: true, currentRole: "owner" })).toBe(true);
    expect(alreadyCovered({ ...preview, alreadyMember: true, currentRole: "viewer" })).toBe(false);
  });

  it.each([
    ["expired", /expired/],
    ["revoked", /turned off/],
    ["accepted", /already used/],
  ] as const)("explains a %s invitation and forgets it", async (status, message) => {
    const { props } = setup({}, { status });
    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    expect(props.onInvalid).toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Join" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "OK" }));
    expect(props.onDecline).toHaveBeenCalled();
  });

  it("tells when the link was disabled between the preview and the click", async () => {
    const onJoin = vi.fn().mockRejectedValue(new ApiCodeError("disabled", "LINK_REVOKED", 410));
    const { props } = setup({ onJoin });
    await screen.findByRole("dialog");
    fireEvent.click(screen.getByRole("button", { name: "Join" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/turned off/);
    expect(props.onInvalid).toHaveBeenCalled();
    expect(props.onJoined).not.toHaveBeenCalled();
  });

  it("keeps the invitation and allows a retry when the network fails", async () => {
    const onJoin = vi.fn().mockRejectedValueOnce(new ApiRequestError("network", "offline")).mockResolvedValue({ projectId: "project-1", result: "joined", role: "editor" });
    const { props } = setup({ onJoin });
    await screen.findByRole("dialog");
    fireEvent.click(screen.getByRole("button", { name: "Join" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/can't reach the server/);
    expect(props.onInvalid).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Join" }));
    await waitFor(() => expect(props.onJoined).toHaveBeenCalled());
  });

  it("offers a retry when the preview cannot be loaded offline, and treats an unknown token as invalid", async () => {
    const loadPreview = vi.fn().mockRejectedValueOnce(new ApiRequestError("network", "offline")).mockResolvedValue(preview);
    const { props } = setup({ loadPreview });
    expect(await screen.findByRole("alert")).toHaveTextContent(/can't reach the server/);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("dialog", { name: /Join “Launch”\?/ })).toBeInTheDocument();
    expect(props.onInvalid).not.toHaveBeenCalled();
    cleanup();
    const unknown = setup({ loadPreview: vi.fn().mockRejectedValue(new Error("not found")) });
    expect(await screen.findByRole("alert")).toHaveTextContent(/isn't valid anymore/);
    expect(unknown.props.onInvalid).toHaveBeenCalled();
  });
});

describe("joinFailure", () => {
  it("maps API answers to what the person should be told", () => {
    expect(joinFailure(new ApiCodeError("x", "LINK_EXPIRED", 410))).toEqual({ reason: "expired" });
    expect(joinFailure(new ApiCodeError("x", "INVITE_NOT_FOUND", 404))).toEqual({ reason: "notFound" });
    expect(joinFailure(new PlanLimitError("full", "members"))).toEqual({ reason: "full" });
    expect(joinFailure(new Error("invite email does not match the signed-in account"))).toEqual({ reason: "mismatch" });
    expect(joinFailure(new ApiRequestError("timeout", "slow"))).toEqual({ retry: true });
  });
});
