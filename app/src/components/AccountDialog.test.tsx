import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { AccountDialog } from "./AccountDialog";
import { signInWithPassword } from "../lib/auth";

vi.mock("../lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/auth")>();
  return {
    ...actual,
    signInWithPassword: vi.fn(async () => ({ id: "u1", email: "a@b.c", displayName: "Ada" })),
    signUpWithPassword: vi.fn(),
  };
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const baseProps = {
  user: null,
  onClose: () => undefined,
  onAuthenticated: () => undefined,
  onGoogle: () => undefined,
  onLogout: async () => undefined,
  onSettings: () => undefined,
};

describe("AccountDialog", () => {
  it("shows the login screen when signed out", () => {
    render(<AccountDialog {...baseProps} />);
    expect(screen.getByText("Sign in", { selector: "h2" })).toBeDefined();
    fireEvent.click(screen.getByText("Create account", { selector: "button[role='tab']" }));
    expect(screen.getByText("Create account", { selector: "h2" })).toBeDefined();
    expect(screen.getByPlaceholderText("Your name")).toBeDefined();
  });

  it("signs in and reports the authenticated user", async () => {
    const onAuthenticated = vi.fn();
    render(<AccountDialog {...baseProps} onAuthenticated={onAuthenticated} />);
    fireEvent.change(screen.getByPlaceholderText("you@example.com"), { target: { value: "a@b.c" } });
    fireEvent.change(screen.getByPlaceholderText("At least 8 characters"), { target: { value: "password1" } });
    fireEvent.click(screen.getByText("Sign in", { selector: "button.auth-submit" }));

    await screen.findByText("Sign in", { selector: "h2" });
    expect(signInWithPassword).toHaveBeenCalledWith("a@b.c", "password1");
    expect(onAuthenticated).toHaveBeenCalledWith({ id: "u1", email: "a@b.c", displayName: "Ada" });
  });

  it("offers settings or logout when signed in", () => {
    const onSettings = vi.fn();
    const onLogout = vi.fn(async () => undefined);
    render(<AccountDialog {...baseProps} user={{ id: "u1", email: "a@b.c", displayName: "Ada" }} onSettings={onSettings} onLogout={onLogout} />);
    expect(screen.getByText("Account", { selector: "h2" })).toBeDefined();
    fireEvent.click(screen.getByText("Settings"));
    expect(onSettings).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText("Log out"));
    expect(onLogout).toHaveBeenCalledTimes(1);
  });

  it("offers settings alongside login when signed out", () => {
    const onSettings = vi.fn();
    render(<AccountDialog {...baseProps} onSettings={onSettings} />);
    expect(screen.getByText("Sign in", { selector: "h2" })).toBeDefined();
    fireEvent.click(screen.getByText("Settings"));
    expect(onSettings).toHaveBeenCalledTimes(1);
  });
});
