import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EffectsProvider } from "../../../lib/gamification/effects";
import type { EffectsIntensity } from "../../../lib/gamification/types";
import { AchievementToastStack } from "./AchievementToast";
import { XP_ARRIVE_EVENT } from "./celebrate";
import { ChestOpening } from "./ChestOpening";
import { LevelUpOverlay } from "./LevelUpOverlay";
import { StreakFlame } from "./StreakFlame";
import { XpBar } from "./XpBar";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const withIntensity = (intensity: EffectsIntensity, node: React.ReactNode) => <EffectsProvider intensity={intensity}>{node}</EffectsProvider>;

describe("XpBar", () => {
  it("exposes progress to assistive technology and paints the fill", () => {
    render(withIntensity("off", <XpBar level={7} xpInLevel={120} xpForLevel={300} rank="Spark" ariaLabel="Level 7" />));
    const bar = screen.getByRole("progressbar", { name: "Level 7" });
    expect(bar).toHaveAttribute("aria-valuenow", "120");
    expect(bar).toHaveAttribute("aria-valuemax", "300");
    expect(bar.querySelector(".fx-xpbar-fill")).toHaveStyle({ transform: "translateX(-60.000%)" });
    expect(screen.getByText("Spark")).toBeInTheDocument();
  });

  it("claims the flying label's arrival so it can pulse itself", () => {
    render(withIntensity("off", <XpBar level={2} xpInLevel={10} xpForLevel={100} />));
    const event = new CustomEvent(XP_ARRIVE_EVENT, { cancelable: true, bubbles: true, detail: { xp: 10 } });
    screen.getByRole("progressbar").dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  it("jumps straight to a new level when effects are off", () => {
    const { rerender } = render(withIntensity("off", <XpBar level={2} xpInLevel={90} xpForLevel={100} />));
    rerender(withIntensity("off", <XpBar level={3} xpInLevel={5} xpForLevel={120} />));
    const bar = screen.getByRole("progressbar");
    expect(bar.querySelector(".fx-level-badge-number")).toHaveTextContent("3");
    expect(bar.querySelector(".fx-xpbar-count b")).toHaveTextContent("5");
  });
});

function LevelUpHarness({ intensity, chest }: { readonly intensity: EffectsIntensity; readonly chest?: "rare" }) {
  const [open, setOpen] = useState(false);
  return withIntensity(
    intensity,
    <>
      <button type="button" onClick={() => setOpen(true)}>Open</button>
      <LevelUpOverlay open={open} level={10} rank="Ember" rankIsNew chest={chest} chestLabel="Rare chest" onClose={() => setOpen(false)} />
    </>,
  );
}

describe("LevelUpOverlay", () => {
  it("is a modal dialog that takes focus, announces the level and gives it back on Escape", () => {
    vi.useFakeTimers();
    render(<LevelUpHarness intensity="off" />);
    const opener = screen.getByRole("button", { name: "Open" });
    opener.focus();
    fireEvent.click(opener);
    const dialog = screen.getByRole("dialog", { name: "Level up!" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(document.activeElement).toBe(dialog);
    act(() => vi.advanceTimersByTime(100));
    expect(screen.getByText("Level 10 reached. Ember.")).toBeInTheDocument();
    expect(screen.getByText("Ember")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(document.activeElement).toBe(opener);
  });

  it("closes by itself after the moment when there is no chest", () => {
    vi.useFakeTimers();
    render(<LevelUpHarness intensity="full" />);
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(2600));
    expect(screen.getByRole("dialog")).toHaveClass("is-leaving");
    act(() => vi.advanceTimersByTime(300));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("waits on the chest teaser, and a click skips straight to it", () => {
    vi.useFakeTimers();
    render(<LevelUpHarness intensity="full" chest="rare" />);
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(dialog);
    expect(dialog.className).toContain("fx-lvl-p5");
    act(() => vi.advanceTimersByTime(10_000));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open chest" })).toHaveFocus();
  });
});

describe("ChestOpening", () => {
  it("reveals every item and converts duplicates to stardust at once when effects are off", () => {
    const onStardust = vi.fn();
    render(
      withIntensity(
        "off",
        <ChestOpening
          tier="epic"
          stardust={100}
          onStardust={onStardust}
          items={[
            { id: "a", label: "Wizard hat", rarity: "rare", icon: <svg /> },
            { id: "b", label: "Night owl", rarity: "common", icon: <svg />, duplicate: true },
          ]}
        />,
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "Open chest" }));
    expect(onStardust).toHaveBeenCalledWith(105);
    expect(screen.getByLabelText("Stardust: 105")).toBeInTheDocument();
    expect(document.querySelectorAll(".fx-card.is-revealed")).toHaveLength(2);
    expect(document.querySelector(".fx-card.is-dust")).not.toBeNull();
  });
});

describe("AchievementToastStack", () => {
  it("shows toasts as polite status messages and dismisses them after their duration", () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    render(withIntensity("off", <AchievementToastStack toasts={[{ id: "x", title: "The Planner", rarity: "rare", icon: <svg /> }]} onDismiss={onDismiss} duration={3000} />));
    expect(screen.getByRole("status")).toHaveTextContent("The Planner");
    act(() => vi.advanceTimersByTime(2900));
    expect(onDismiss).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(200));
    expect(onDismiss).toHaveBeenCalledWith("x");
  });
});

describe("StreakFlame", () => {
  it("labels the streak and marks the stage", () => {
    render(<StreakFlame days={42} freeze="used" />);
    const flame = screen.getByRole("img", { name: "42-day streak" });
    expect(flame).toHaveClass("fx-streak-inferno", "is-frozen");
  });
});
