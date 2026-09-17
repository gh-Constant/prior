import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../lib/api";
import { SettingsPage } from "./SettingsPage";

vi.mock("../lib/api", () => ({
  api: { updateProfile: vi.fn(), getSettings: vi.fn(), saveSettings: vi.fn() },
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
    fireEvent.click(screen.getByRole("tab", { name: "Profile" }));
    fireEvent.change(screen.getByPlaceholderText("Your username"), { target: { value: "Ada Lovelace" } });
    fireEvent.click(screen.getByRole("button", { name: "Save profile" }));

    await waitFor(() => expect(onUserUpdated).toHaveBeenCalledWith({ ...user, displayName: "Ada Lovelace" }));
    expect(api.updateProfile).toHaveBeenCalledWith("Ada Lovelace", "session-token");
    expect(screen.getByRole("status")).toHaveTextContent("Saved");
  });

  it("saves the per-user OpenAI transcription key with assistant settings", async () => {
    vi.mocked(api.saveSettings).mockResolvedValue({ openrouterApiKey: "", openaiApiKey: "sk-openai", webSearch: true });
    vi.mocked(api.getSettings).mockResolvedValue({ openrouterApiKey: "", openaiApiKey: "", webSearch: true });

    render(<SettingsPage user={user} onUserUpdated={vi.fn()} />);
    fireEvent.click(screen.getByRole("tab", { name: "Assistant" }));
    await waitFor(() => expect(api.getSettings).toHaveBeenCalledWith("session-token"));
    fireEvent.change(screen.getByPlaceholderText("sk-..."), { target: { value: "sk-openai" } });
    fireEvent.click(screen.getByRole("button", { name: "Save keys" }));

    await waitFor(() => expect(api.saveSettings).toHaveBeenCalledWith({ openrouterApiKey: "", openaiApiKey: "sk-openai", webSearch: true }, "session-token"));
  });
});
