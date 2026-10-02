import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AvatarStack } from "../ProjectVisuals";
import { PersonAvatar } from "./PersonAvatar";
import { PresenceDot, relativeSince } from "./PresenceDot";

afterEach(cleanup);

describe("PresenceDot", () => {
  it("renders one labelled dot per state", () => {
    render(<><PresenceDot presence="online" /><PresenceDot presence="away" /><PresenceDot presence="offline" /></>);
    const dots = screen.getAllByRole("img");
    expect(dots.map((dot) => dot.getAttribute("data-presence"))).toEqual(["online", "away", "offline"]);
    expect(dots.map((dot) => dot.className)).toEqual([
      expect.stringContaining("is-online"), expect.stringContaining("is-away"), expect.stringContaining("is-offline"),
    ]);
    expect(dots[0]).toHaveAccessibleName("Online");
    expect(dots[1]).toHaveAccessibleName("Away");
    expect(dots[2]).toHaveAccessibleName("Offline");
  });

  it("adds the last-seen time to an offline label only", () => {
    const seen = new Date(Date.now() - 5 * 60_000).toISOString();
    render(<><PresenceDot presence="offline" lastSeenAt={seen} /><PresenceDot presence="online" lastSeenAt={seen} /></>);
    const [offline, online] = screen.getAllByRole("img");
    expect(offline.getAttribute("aria-label")).toMatch(/^Offline, last seen .*5/);
    expect(online).toHaveAccessibleName("Online");
  });

  it("formats elapsed time", () => {
    const now = Date.parse("2026-01-01T12:00:00Z");
    expect(relativeSince("2026-01-01T11:55:00Z", "en", now)).toBe("5 minutes ago");
    expect(relativeSince("2025-12-30T12:00:00Z", "en", now)).toBe("2 days ago");
    expect(relativeSince("garbage", "en", now)).toBe("");
  });
});

describe("avatars with presence", () => {
  it("shows the dot on an avatar that has a state and none otherwise", () => {
    const { container } = render(<><PersonAvatar person={{ id: "a", name: "Ada", presence: "away" }} /><PersonAvatar person={{ id: "b", name: "Bob" }} /></>);
    expect(container.querySelectorAll(".presence-dot")).toHaveLength(1);
    expect(screen.getByLabelText("Ada (Away)")).toBeInTheDocument();
  });

  it("can hide the dot", () => {
    const { container } = render(<PersonAvatar person={{ id: "a", name: "Ada", presence: "online" }} showPresence={false} />);
    expect(container.querySelector(".presence-dot")).toBeNull();
  });

  it("shows presence in the header avatar stack only when asked", () => {
    const people = [{ id: "a", name: "Ada", presence: "online" as const }, { id: "b", name: "Bob", presence: "offline" as const }];
    const { container, rerender } = render(<AvatarStack people={people} label="People" />);
    expect(container.querySelectorAll(".presence-dot")).toHaveLength(0);
    rerender(<AvatarStack people={people} label="People" showPresence />);
    expect(container.querySelectorAll(".presence-dot")).toHaveLength(2);
  });
});
