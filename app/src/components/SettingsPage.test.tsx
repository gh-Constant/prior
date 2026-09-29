import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../lib/api";
import { SettingsPage } from "./SettingsPage";

vi.mock("../lib/api", () => ({
  api: { updateProfile: vi.fn(), getSettings: vi.fn(), saveSettings: vi.fn(), listSessions: vi.fn(), createMcpToken: vi.fn(), revokeSession: vi.fn() },
  API_URL: "https://api.prior.test",
  isAuthError: () => false,
  isRetriableError: () => false,
}));

vi.mock("../lib/auth", () => ({
  getToken: vi.fn(async () => "session-token"),
}));

describe("SettingsPage profile", () => {
  const user = { id: "u1", email: "ada@example.com", displayName: "Ada" };

  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
    vi.mocked(api.updateProfile).mockResolvedValue({ ...user, displayName: "Ada Lovelace" });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it("updates the signed-in username and reports the new profile", async () => {
    const onUserUpdated = vi.fn();
    render(<SettingsPage user={user} onUserUpdated={onUserUpdated} />);
    fireEvent.click(screen.getByRole("tab", { name: "Profile & account" }));
    fireEvent.change(screen.getByPlaceholderText("Your username"), { target: { value: "Ada Lovelace" } });
    fireEvent.click(screen.getByRole("button", { name: "Save profile" }));

    await waitFor(() => expect(onUserUpdated).toHaveBeenCalledWith({ ...user, displayName: "Ada Lovelace" }));
    expect(api.updateProfile).toHaveBeenCalledWith("Ada Lovelace", "session-token");
    expect(screen.getByRole("status")).toHaveTextContent("Saved");
  });

  it("saves the per-user OpenAI transcription key with assistant settings", async () => {
    vi.mocked(api.saveSettings).mockResolvedValue({ openrouterApiKey: "", openaiApiKey: "sk-openai", webSearch: false });
    vi.mocked(api.getSettings).mockResolvedValue({ openrouterApiKey: "", openaiApiKey: "", webSearch: false });

    render(<SettingsPage user={user} onUserUpdated={vi.fn()} />);
    fireEvent.click(screen.getByRole("tab", { name: "Prior Agent" }));
    await waitFor(() => expect(api.getSettings).toHaveBeenCalledWith("session-token"));
    fireEvent.change(screen.getByPlaceholderText("sk-..."), { target: { value: "sk-openai" } });
    fireEvent.change(screen.getByLabelText("OpenRouter key for Today recommendations"), { target: { value: "sk-today" } });
    fireEvent.change(screen.getByLabelText("Today recommendation model"), { target: { value: "vendor/planner" } });
    fireEvent.click(screen.getByRole("button", { name: "Save keys" }));

    await waitFor(() => expect(api.saveSettings).toHaveBeenCalledWith({ openrouterApiKey: "", recommendationOpenrouterApiKey: "sk-today", openaiApiKey: "sk-openai", webSearch: false }, "session-token"));
  });

  it("shows that a key is still local when account sync fails", async () => {
    vi.mocked(api.getSettings).mockResolvedValue({ initialized: true, openrouterApiKey: "", openaiApiKey: "", webSearch: false });
    vi.mocked(api.saveSettings).mockRejectedValue(new Error("offline"));
    render(<SettingsPage user={user} onUserUpdated={vi.fn()} />);
    fireEvent.click(screen.getByRole("tab", { name: "Prior Agent" }));
    await waitFor(() => expect(api.getSettings).toHaveBeenCalled());
    fireEvent.change(screen.getByLabelText("OpenRouter key for Today recommendations"), { target: { value: "sk-pending" } });
    fireEvent.click(screen.getByRole("button", { name: "Save keys" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Saved on this device. Account sync is pending.");
  });
});

describe("SettingsPage Claude Code integration", () => {
  const user = { id: "u1", email: "ada@example.com", displayName: "Ada" };
  const key = { id: "s1", deviceName: "Claude Code", platform: "mcp", createdAt: "2026-09-29T10:00:00Z", lastUsedAt: "2026-09-29T10:00:00Z", expiresAt: "2027-09-29T10:00:00Z", current: false };

  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it("creates a key, shows the claude mcp add command and revokes keys", async () => {
    vi.mocked(api.listSessions).mockResolvedValueOnce([{ ...key, id: "web", platform: "web", current: true }]).mockResolvedValue([key]);
    vi.mocked(api.createMcpToken).mockResolvedValue({ token: "secret-key", name: "Claude Code", expiresAt: key.expiresAt });
    vi.mocked(api.revokeSession).mockResolvedValue(undefined);

    render(<SettingsPage user={user} onUserUpdated={vi.fn()} />);
    fireEvent.click(screen.getByRole("tab", { name: "Integrations" }));
    expect(await screen.findByText("No active key.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Create access key" }));
    expect(await screen.findByLabelText("Run this once in a terminal")).toHaveTextContent(
      'claude mcp add --transport http prior https://api.prior.test/mcp --header "Authorization: Bearer secret-key"',
    );
    expect(api.createMcpToken).toHaveBeenCalledWith("Claude Code", "session-token");

    fireEvent.click(await screen.findByRole("button", { name: "Revoke" }));
    await waitFor(() => expect(api.revokeSession).toHaveBeenCalledWith("s1", "session-token"));
  });
});

describe("SettingsPage layout", () => {
  const user = { id: "u1", email: "ada@example.com", displayName: "Ada" };

  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ tag_name: "0.5.15" }) }));
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it("opens on General with titled sections and no updater chip on the web", async () => {
    render(<SettingsPage user={user} onUserUpdated={vi.fn()} />);
    expect(screen.getByRole("tab", { name: "General" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("heading", { level: 2, name: "Language & region" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Application" })).toBeInTheDocument();
    expect(await screen.findByText("Web app · latest release v0.5.15")).toBeInTheDocument();
    expect(screen.queryByText("Up to date")).not.toBeInTheDocument();
  });

  it("moves between sections with the arrow keys", () => {
    render(<SettingsPage user={user} onUserUpdated={vi.fn()} />);
    const general = screen.getByRole("tab", { name: "General" });
    general.focus();
    fireEvent.keyDown(general, { key: "ArrowDown" });
    const profile = screen.getByRole("tab", { name: "Profile & account" });
    expect(profile).toHaveAttribute("aria-selected", "true");
    expect(profile).toHaveFocus();
    expect(screen.getByRole("tabpanel")).toHaveAttribute("aria-labelledby", profile.id);
    fireEvent.keyDown(profile, { key: "End" });
    expect(screen.getAllByRole("tab").at(-1)).toHaveAttribute("aria-selected", "true");
  });
});
