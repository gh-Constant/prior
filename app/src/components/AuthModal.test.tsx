import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { AuthModal } from "./AuthModal";
import { signInWithPassword } from "../lib/auth";

vi.mock("../lib/updater", () => ({
  supportsDesktopUpdates: () => false,
  checkForUpdate: vi.fn(),
  getAppVersion: vi.fn(),
  installAvailableUpdate: vi.fn(),
}));

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
};

describe("AuthModal", () => {
  it("switches between sign in and account creation", () => {
    render(<AuthModal {...baseProps} />);
    expect(screen.getByText("Sign in", { selector: "h2" })).toBeDefined();
    fireEvent.click(screen.getByText("Create account", { selector: "button[role='tab']" }));
    expect(screen.getByText("Create account", { selector: "h2" })).toBeDefined();
    expect(screen.getByPlaceholderText("Your name")).toBeDefined();
  });

  it("signs in and reports the authenticated user", async () => {
    const onAuthenticated = vi.fn();
    render(<AuthModal {...baseProps} onAuthenticated={onAuthenticated} />);
    fireEvent.change(screen.getByPlaceholderText("you@example.com"), { target: { value: "a@b.c" } });
    fireEvent.change(screen.getByPlaceholderText("At least 8 characters"), { target: { value: "password1" } });
    fireEvent.click(screen.getByText("Sign in", { selector: "button.auth-submit" }));

    await screen.findByText("Sign in", { selector: "h2" });
    expect(signInWithPassword).toHaveBeenCalledWith("a@b.c", "password1");
    expect(onAuthenticated).toHaveBeenCalledWith({ id: "u1", email: "a@b.c", displayName: "Ada" });
  });

  it("shows the account panel with logout for signed-in users", () => {
    const onLogout = vi.fn(async () => undefined);
    render(<AuthModal {...baseProps} user={{ id: "u1", email: "a@b.c", displayName: "Ada" }} onLogout={onLogout} />);
    expect(screen.getByText("Account", { selector: "h2" })).toBeDefined();
    fireEvent.click(screen.getByText("Log out"));
    expect(onLogout).toHaveBeenCalledTimes(1);
  });
});
