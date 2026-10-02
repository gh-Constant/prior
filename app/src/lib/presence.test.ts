import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IDLE_AFTER_MS, presenceFromApi, presenceLabelKey, startActivityTracker } from "./presence";

describe("presenceFromApi", () => {
  it("prefers the explicit state", () => {
    expect(presenceFromApi({ online: true, presence: "away" })).toBe("away");
    expect(presenceFromApi({ online: false, presence: "offline" })).toBe("offline");
    expect(presenceFromApi({ online: true, presence: "online" })).toBe("online");
  });

  it("falls back to the online flag of older servers", () => {
    expect(presenceFromApi({ online: true })).toBe("online");
    expect(presenceFromApi({ online: false })).toBe("offline");
    expect(presenceFromApi({})).toBe("offline");
    expect(presenceFromApi({ presence: "weird" })).toBe("offline");
  });

  it("maps every state to a label key", () => {
    expect(presenceLabelKey("online")).toBe("collab.presence.online");
    expect(presenceLabelKey("away")).toBe("collab.presence.away");
    expect(presenceLabelKey("offline")).toBe("collab.presence.offline");
  });
});

describe("startActivityTracker", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("goes idle after five quiet minutes and active again on interaction", () => {
    const changes: string[] = [];
    const tracker = startActivityTracker({ onChange: (state) => changes.push(state), now: () => Date.now() });
    vi.advanceTimersByTime(IDLE_AFTER_MS - 1_000);
    expect(changes).toEqual([]);
    vi.advanceTimersByTime(2_000);
    expect(changes).toEqual(["idle"]);
    window.dispatchEvent(new Event("keydown"));
    expect(changes).toEqual(["idle", "active"]);
    expect(tracker.current()).toBe("active");
    tracker.stop();
  });

  it("keeps the user active while they interact", () => {
    const changes: string[] = [];
    const tracker = startActivityTracker({ onChange: (state) => changes.push(state), now: () => Date.now() });
    for (let minute = 0; minute < 12; minute += 1) {
      vi.advanceTimersByTime(60_000);
      window.dispatchEvent(new Event("pointerdown"));
    }
    expect(changes).toEqual([]);
    tracker.stop();
  });

  it("stops reporting after stop()", () => {
    const changes: string[] = [];
    startActivityTracker({ onChange: (state) => changes.push(state), now: () => Date.now() }).stop();
    vi.advanceTimersByTime(IDLE_AFTER_MS * 2);
    expect(changes).toEqual([]);
  });
});
