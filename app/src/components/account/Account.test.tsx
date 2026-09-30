import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, ApiCodeError } from "../../lib/api";
import { SignInPanel } from "../SignInPanel";
import { AccountLinkPage, parseAccountLinkRoute } from "./AccountLinkPage";
import { ACCOUNT_DELETED_EVENT, DeleteAccountDialog, secondFactorInput } from "./DeleteAccountDialog";
import { SecuritySettings } from "./SecuritySettings";
import { needsEmailVerification, VerifyEmailBanner } from "./VerifyEmailBanner";

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return {
    ...actual,
    api: {
      login: vi.fn(),
      register: vi.fn(),
      verifyTwoFactor: vi.fn(),
      forgotPassword: vi.fn(),
      resetPassword: vi.fn(),
      verifyEmail: vi.fn(),
      resendVerification: vi.fn(),
      deleteAccount: vi.fn(),
      exportAccount: vi.fn(),
      twoFactorStatus: vi.fn(),
      twoFactorSetup: vi.fn(),
      twoFactorEnable: vi.fn(),
      twoFactorDisable: vi.fn(),
      twoFactorRecoveryCodes: vi.fn(),
    },
  };
});

vi.mock("../../lib/secureStore", () => ({
  getSecret: vi.fn(async () => "session-token"),
  setSecret: vi.fn(async () => undefined),
  removeSecret: vi.fn(async () => undefined),
}));

const account = { id: "u1", email: "ada@example.com", displayName: "Ada", hasPassword: true, emailVerified: false, twoFactorEnabled: false };

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("sign-in panel", () => {
  it("asks for a reset link without revealing whether the account exists", async () => {
    vi.mocked(api.forgotPassword).mockResolvedValue(undefined);
    render(<SignInPanel mode="signin" onModeChange={vi.fn()} onAuthenticated={vi.fn()} onGoogle={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText("you@example.com"), { target: { value: "ada@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Forgot password?" }));
    expect(screen.getByRole("heading", { name: "Reset your password" })).toBeInTheDocument();
    expect(screen.getByDisplayValue("ada@example.com")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Send the link" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("If an account uses ada@example.com"));
    expect(api.forgotPassword).toHaveBeenCalledWith("ada@example.com", "en");
    fireEvent.click(screen.getByRole("button", { name: "Back to sign in" }));
    expect(screen.getByRole("tab", { name: "Sign in" })).toBeInTheDocument();
  });

  it("switches to the code step when the account has two-step verification", async () => {
    vi.mocked(api.login).mockResolvedValue({ twoFactorRequired: true, challenge: "challenge-1", expiresAt: "2026-01-01T00:00:00Z" });
    vi.mocked(api.verifyTwoFactor).mockRejectedValueOnce(new ApiCodeError("bad", "INVALID_CODE", 400))
      .mockResolvedValueOnce({ token: "session", user: { ...account, twoFactorEnabled: true } });
    const onAuthenticated = vi.fn();
    render(<SignInPanel mode="signin" onModeChange={vi.fn()} onAuthenticated={onAuthenticated} onGoogle={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText("you@example.com"), { target: { value: "ada@example.com" } });
    fireEvent.change(screen.getByPlaceholderText("At least 8 characters"), { target: { value: "correct horse" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Sign in" }).at(-1)!);

    const code = await screen.findByLabelText("Authentication code");
    expect(onAuthenticated).not.toHaveBeenCalled();
    fireEvent.change(code, { target: { value: "123 456" } });
    fireEvent.click(screen.getByRole("button", { name: "Verify" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("This code is not valid.");
    expect(api.verifyTwoFactor).toHaveBeenLastCalledWith("challenge-1", { code: "123456" });

    fireEvent.click(screen.getByRole("button", { name: "Use a recovery code instead" }));
    fireEvent.change(screen.getByLabelText("Recovery code"), { target: { value: "abcde-fghij" } });
    fireEvent.click(screen.getByRole("button", { name: "Verify" }));
    await waitFor(() => expect(onAuthenticated).toHaveBeenCalledWith(expect.objectContaining({ id: "u1", twoFactorEnabled: true })));
    expect(api.verifyTwoFactor).toHaveBeenLastCalledWith("challenge-1", { recoveryCode: "abcde-fghij" });
  });
});

describe("emailed links", () => {
  it("recognizes the reset and verification routes", () => {
    expect(parseAccountLinkRoute({ pathname: "/reset-password", search: "?token=abc" })).toEqual({ kind: "reset", token: "abc" });
    expect(parseAccountLinkRoute({ pathname: "/verify-email/", search: "" })).toEqual({ kind: "verify", token: "" });
    expect(parseAccountLinkRoute({ pathname: "/", search: "?token=abc" })).toBeNull();
  });

  it("checks both passwords and reports an expired link", async () => {
    vi.mocked(api.resetPassword).mockRejectedValue(new ApiCodeError("expired", "TOKEN_INVALID", 400));
    render(<AccountLinkPage route={{ kind: "reset", token: "t1" }} onDone={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("New password"), { target: { value: "a new password" } });
    fireEvent.change(screen.getByLabelText("Confirm the password"), { target: { value: "another one!" } });
    fireEvent.click(screen.getByRole("button", { name: "Save the new password" }));
    expect(screen.getByRole("alert")).toHaveTextContent("The passwords do not match.");
    expect(api.resetPassword).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Confirm the password"), { target: { value: "a new password" } });
    fireEvent.click(screen.getByRole("button", { name: "Save the new password" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("This link is invalid or has expired.");
    expect(api.resetPassword).toHaveBeenCalledWith("t1", "a new password");
  });

  it("confirms an email once and offers to continue", async () => {
    vi.mocked(api.verifyEmail).mockResolvedValue({ verified: true });
    const onDone = vi.fn();
    render(<AccountLinkPage route={{ kind: "verify", token: "v1" }} onDone={onDone} />);
    expect(await screen.findByText("Your email is confirmed. Thank you!")).toBeInTheDocument();
    expect(api.verifyEmail).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Continue to Prior" }));
    expect(onDone).toHaveBeenCalled();
    expect(screen.getByRole("link", { name: "Open the Prior app" })).toHaveAttribute("href", "prior://auth");
  });
});

describe("verify-email banner", () => {
  it("only shows for unverified password accounts and can resend", async () => {
    expect(needsEmailVerification({ ...account, hasPassword: false })).toBe(false);
    expect(needsEmailVerification({ ...account, emailVerified: true })).toBe(false);
    vi.mocked(api.resendVerification).mockResolvedValue(undefined);
    render(<VerifyEmailBanner user={account} />);
    fireEvent.click(screen.getByRole("button", { name: "Resend the email" }));
    await waitFor(() => expect(screen.getByText("Email sent to ada@example.com.")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByRole("region", { name: "Email confirmation" })).toBeNull();
  });
});

describe("account deletion", () => {
  it("reads codes as TOTP or recovery codes", () => {
    expect(secondFactorInput("123 456")).toEqual({ code: "123456" });
    expect(secondFactorInput("abcde-fghij")).toEqual({ recoveryCode: "abcde-fghij" });
    expect(secondFactorInput(" ")).toEqual({});
  });

  it("needs the typed email and password, then announces the deletion", async () => {
    vi.mocked(api.deleteAccount).mockRejectedValueOnce(new ApiCodeError("wrong", "INVALID_PASSWORD", 403)).mockResolvedValueOnce(undefined);
    const deleted = vi.fn();
    window.addEventListener(ACCOUNT_DELETED_EVENT, deleted);
    render(<DeleteAccountDialog user={account} onClose={vi.fn()} onExport={vi.fn()} />);
    const confirm = screen.getByRole("button", { name: "Delete permanently" });
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Type ada@example.com to confirm"), { target: { value: "ADA@example.com" } });
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Current password"), { target: { value: "nope" } });
    fireEvent.click(confirm);
    expect(await screen.findByRole("alert")).toHaveTextContent("The password is incorrect.");
    expect(deleted).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Delete permanently" }));
    await waitFor(() => expect(deleted).toHaveBeenCalled());
    expect(api.deleteAccount).toHaveBeenLastCalledWith({ email: "ADA@example.com", password: "nope" }, expect.any(String));
    window.removeEventListener(ACCOUNT_DELETED_EVENT, deleted);
  });

  it("asks Google accounts for a recent sign-in instead of a password", () => {
    render(<DeleteAccountDialog user={{ ...account, hasPassword: false }} onClose={vi.fn()} onExport={vi.fn()} />);
    expect(screen.queryByLabelText("Current password")).toBeNull();
    expect(screen.getByText("For your security, you must have signed in within the last 10 minutes.")).toBeInTheDocument();
  });
});

describe("two-step verification settings", () => {
  it("shows a QR code and the key, then the recovery codes", async () => {
    vi.mocked(api.twoFactorStatus).mockResolvedValue({ enabled: false, available: true, recoveryCodesLeft: 0 });
    vi.mocked(api.twoFactorSetup).mockResolvedValue({ secret: "JBSWY3DPEHPK3PXP", otpauthUrl: "otpauth://totp/Prior:ada@example.com?secret=JBSWY3DPEHPK3PXP&issuer=Prior" });
    vi.mocked(api.twoFactorEnable).mockResolvedValue({ recoveryCodes: ["aaaaa-bbbbb", "ccccc-ddddd"] });
    render(<SecuritySettings user={account} onUserUpdated={vi.fn()} />);
    const turnOn = await screen.findByRole("button", { name: "Turn on" });
    await waitFor(() => expect(turnOn).toBeEnabled());
    fireEvent.click(turnOn);
    expect(await screen.findByRole("img", { name: "QR code to add Prior to your authenticator app" })).toBeInTheDocument();
    expect(screen.getByText("JBSW Y3DP EHPK 3PXP")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Enter the 6-digit code the app shows"), { target: { value: "123456" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Turn on" }).at(-1)!);
    expect(await screen.findByText("aaaaa-bbbbb")).toBeInTheDocument();
    expect(api.twoFactorEnable).toHaveBeenCalledWith("123456", expect.any(String));
    expect(screen.getByRole("button", { name: "Download" })).toBeInTheDocument();
  });

  it("explains when the server cannot offer 2FA", async () => {
    vi.mocked(api.twoFactorStatus).mockResolvedValue({ enabled: false, available: false, recoveryCodesLeft: 0 });
    render(<SecuritySettings user={account} onUserUpdated={vi.fn()} />);
    expect(await screen.findByText("Not available on this server yet.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Turn on" })).toBeDisabled();
  });
});
