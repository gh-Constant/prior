import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { memoryStorage } from "../test/memoryStorage";
import { capturePendingLink, clearPendingLink, pendingLink } from "./pendingLink";

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
