import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ShareLinkSection } from "./ShareLinkSection";
import { ProjectShareDialog } from "./ProjectShareDialog";
import type { ShareLinkActions, ShareLinkItem } from "./types";
import { memoryStorage } from "../../test/memoryStorage";
import { rememberShareLink } from "../../lib/shareLinkCache";

const URL_EDITOR = `https://app.example/invite/${"a".repeat(64)}`;
const editorLink: ShareLinkItem = { id: "link-editor", role: "editor", useCount: 2 };

function actions(overrides: Partial<ShareLinkActions> = {}): ShareLinkActions {
  return {
    list: vi.fn().mockResolvedValue([]),
    create: vi.fn().mockImplementation(async (role) => ({ link: { id: `new-${role}`, role, useCount: 0 }, url: `https://app.example/invite/${"b".repeat(64)}` })),
    revoke: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

beforeEach(() => {
  vi.stubGlobal("localStorage", memoryStorage());
  Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ShareLinkSection", () => {
  it("offers one link per role and creates an editor link, copying it", async () => {
    const api = actions();
    render(<ShareLinkSection actions={api} />);
    expect(await screen.findByText("Editor link")).toBeInTheDocument();
    expect(screen.getByText("Viewer link")).toBeInTheDocument();
    const [createEditor] = screen.getAllByRole("button", { name: "Create link" });
    fireEvent.click(createEditor);
    await waitFor(() => expect(api.create).toHaveBeenCalledWith("editor", undefined));
    const field = await screen.findByLabelText("Editor link") as HTMLInputElement;
    expect(field.value).toContain("/invite/");
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith(field.value));
    expect(screen.getByText(/Not used yet/)).toBeInTheDocument();
  });

  it("creates a link that expires when the owner chose a validity", async () => {
    const api = actions();
    render(<ShareLinkSection actions={api} />);
    await screen.findByText("Viewer link");
    fireEvent.click(screen.getByText("Never"));
    fireEvent.click(await screen.findByRole("option", { name: "After 7 days" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Create link" })[1]);
    await waitFor(() => expect(api.create).toHaveBeenCalledWith("viewer", 7));
  });

  it("shows how many people used a link and lets the owner copy it again on this device", async () => {
    rememberShareLink(editorLink.id, URL_EDITOR);
    render(<ShareLinkSection actions={actions({ list: vi.fn().mockResolvedValue([editorLink]) })} />);
    expect(await screen.findByText(/Used by 2 people/)).toBeInTheDocument();
    expect(screen.getByLabelText("Editor link")).toHaveValue(URL_EDITOR);
    fireEvent.click(screen.getByRole("button", { name: "Copy link" }));
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith(URL_EDITOR));
  });

  it("never invents a link it does not have: it asks to regenerate", async () => {
    render(<ShareLinkSection actions={actions({ list: vi.fn().mockResolvedValue([editorLink]) })} />);
    expect(await screen.findByText(/only shown when it is created/)).toBeInTheDocument();
    expect(screen.queryByLabelText("Editor link")).not.toBeInTheDocument();
  });

  it("asks before regenerating, then replaces the link", async () => {
    rememberShareLink(editorLink.id, URL_EDITOR);
    const api = actions({ list: vi.fn().mockResolvedValue([editorLink]) });
    render(<ShareLinkSection actions={api} />);
    fireEvent.click(await screen.findByRole("button", { name: "Regenerate the Editor link" }));
    expect(api.create).not.toHaveBeenCalled();
    expect(screen.getByText(/current link stops working/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Regenerate" }));
    await waitFor(() => expect(api.create).toHaveBeenCalledWith("editor", undefined));
  });

  it("turns a link off after a confirmation", async () => {
    const api = actions({ list: vi.fn().mockResolvedValue([editorLink]) });
    render(<ShareLinkSection actions={api} />);
    fireEvent.click(await screen.findByRole("button", { name: "Turn off the Editor link" }));
    expect(api.revoke).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Turn off" }));
    await waitFor(() => expect(api.revoke).toHaveBeenCalledWith("link-editor"));
    await waitFor(() => expect(screen.getAllByRole("button", { name: "Create link" })).toHaveLength(2));
  });

  it("flags an expired link", async () => {
    const expired: ShareLinkItem = { ...editorLink, expiresAt: new Date(Date.now() - 1000).toISOString() };
    render(<ShareLinkSection actions={actions({ list: vi.fn().mockResolvedValue([expired]) })} />);
    expect(await screen.findByText(/expired/)).toBeInTheDocument();
  });

  it("reports a failure to load and lets the owner retry", async () => {
    const list = vi.fn().mockRejectedValueOnce(new Error("boom")).mockResolvedValue([]);
    render(<ShareLinkSection actions={actions({ list })} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("boom");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
  });
});

describe("ProjectShareDialog invitation links", () => {
  const sharing = { members: [], invites: [], onClose: () => undefined, projectName: "Launch" };

  it("is part of the owner's share dialog", async () => {
    render(<ProjectShareDialog {...sharing} canManage shareLinks={actions()} />);
    expect(await screen.findByRole("region", { name: "Invitation link" })).toBeInTheDocument();
  });

  it("is hidden from people who cannot manage the project", () => {
    render(<ProjectShareDialog {...sharing} canManage={false} shareLinks={actions()} />);
    expect(screen.queryByRole("region", { name: "Invitation link" })).not.toBeInTheDocument();
  });
});
