import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MailView } from "./MailView";
import { I18nProvider } from "../lib/i18n";
import { memoryStorage } from "../test/memoryStorage";

vi.mock("../lib/auth", () => ({ getToken: vi.fn(async () => null) }));

describe("MailView", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", memoryStorage());
    localStorage.setItem("prior.language", "en");
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("lists mail, filters unread and turns the open mail into a task", async () => {
    const onCreateTask = vi.fn(async () => undefined);
    const onCreateTaskAI = vi.fn(async () => undefined);
    render(<I18nProvider><MailView user={null} onCreateTask={onCreateTask} onCreateTaskAI={onCreateTaskAI} /></I18nProvider>);

    const firstRow = await screen.findByRole("button", { name: /Amélie Laurent/ });
    expect(screen.getByRole("heading", { name: "No message selected" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /SNCF Connect/ })).toBeTruthy();

    // "Unread" hides mail that has already been read.
    fireEvent.click(screen.getByRole("button", { name: /^Unread/ }));
    expect(screen.queryByRole("button", { name: /SNCF Connect/ })).toBeNull();

    fireEvent.click(firstRow);
    const reader = await screen.findByRole("article");
    expect(within(reader).getByRole("heading", { name: "Re: Brand sprint — final assets handoff" })).toBeTruthy();
    expect(within(reader).getByRole("heading", { name: "Turn into a task" })).toBeTruthy();

    fireEvent.click(within(reader).getByRole("button", { name: "Draft with Prior Agent" }));
    expect(onCreateTaskAI).toHaveBeenCalledWith(expect.objectContaining({ id: "m1" }));

    fireEvent.click(within(reader).getByRole("button", { name: "Create task" }));
    expect(onCreateTask).toHaveBeenCalledWith(expect.objectContaining({ title: "Re: Brand sprint — final assets handoff", status: "inbox" }));
  });

  it("shows the Gmail connection page when no mailbox is available", async () => {
    vi.stubEnv("DEV", false);
    render(<I18nProvider><MailView user={null} onCreateTask={vi.fn()} onCreateTaskAI={vi.fn()} /></I18nProvider>);
    expect(await screen.findByRole("heading", { name: "Connect your Gmail", level: 1 })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Continue with Google" })).toBeTruthy();
    expect(screen.queryByRole("list", { name: "Messages" })).toBeNull();
  });
});
