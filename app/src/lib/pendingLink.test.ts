import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { memoryStorage } from "../test/memoryStorage";
import { capturePendingLink, clearPendingLink, inviteTokenFromPath, pendingLink } from "./pendingLink";

describe("pending shared links", () => {
  beforeEach(() => vi.stubGlobal("localStorage", memoryStorage()));
  afterEach(() => {
    vi.unstubAllGlobals();
    window.history.replaceState(null, "", "/");
    vi.useRealTimers();
  });

  it("moves an invite from the address bar into storage so sign-in cannot lose it", () => {
    window.history.replaceState(null, "", "/#invite=abc123");
    expect(capturePendingLink()).toEqual({ invite: "abc123", project: undefined });
    expect(window.location.hash).toBe("");
    // After the Google round trip the hash is gone, the invite is not.
    expect(capturePendingLink()).toEqual({ invite: "abc123" });
    expect(pendingLink()).toEqual({ invite: "abc123" });
  });

  it("captures the invitation page link from an email and lands on the projects", () => {
    const token = "a".repeat(64);
    window.history.replaceState(null, "", `/invite/${token}`);
    expect(capturePendingLink()).toEqual({ invite: token, project: undefined });
    expect(window.location.pathname).toBe("/projects");
  });

  it("keeps a share link through sign-up, Google round trips and the onboarding", () => {
    // Share links use the same /invite/<token> address as emailed invitations.
    const token = "c0".repeat(32);
    window.history.replaceState(null, "", `/invite/${token}`);
    capturePendingLink();
    expect(window.location.pathname).toBe("/projects");
    // Several reloads (OAuth return, app restart) keep the token until it is settled.
    for (const path of ["/auth/callback?code=x", "/", "/today"]) {
      window.history.replaceState(null, "", path);
      expect(capturePendingLink()).toEqual({ invite: token });
    }
    expect(pendingLink()).toEqual({ invite: token });
    // "Decline" (or a successful join) forgets it for good.
    clearPendingLink();
    expect(capturePendingLink()).toBeNull();
  });

  it("recognises the invitation page address", () => {
    const token = "9f".repeat(32);
    expect(inviteTokenFromPath(`/invite/${token}`)).toBe(token);
    expect(inviteTokenFromPath(`/invite/${token}/`)).toBe(token);
    expect(inviteTokenFromPath("/invite/short")).toBeUndefined();
    expect(inviteTokenFromPath(`/projects/${token}`)).toBeUndefined();
  });

  it("keeps a shared project link too", () => {
    window.history.replaceState(null, "", "/?x=1#project=p-42");
    expect(capturePendingLink()).toEqual({ invite: undefined, project: "p-42" });
    expect(window.location.search).toBe("?x=1");
  });

  it("returns nothing without a link and forgets handled or stale ones", () => {
    expect(capturePendingLink()).toBeNull();
    window.history.replaceState(null, "", "/#invite=old");
    capturePendingLink();
    clearPendingLink();
    expect(pendingLink()).toBeNull();

    vi.useFakeTimers();
    window.history.replaceState(null, "", "/#invite=stale");
    capturePendingLink();
    vi.setSystemTime(Date.now() + 15 * 24 * 60 * 60 * 1000);
    expect(pendingLink()).toBeNull();
  });
});
