import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { EffectsProvider } from "../../../lib/gamification/effects";
import type { EffectsIntensity } from "../../../lib/gamification/types";
import { AvatarFrame } from "./AvatarFrame";
import { InventoryView } from "./InventoryView";
import { EMPTY_LOADOUT, type InventoryItem } from "./inventory";
import { LeagueBoard, TeamProgress, type LeaderboardPlayer } from "./Leaderboard";
import { Nameplate } from "./Nameplate";

afterEach(cleanup);

function withIntensity(intensity: EffectsIntensity, ui: ReactElement) {
  return render(<EffectsProvider intensity={intensity}>{ui}</EffectsProvider>);
}

describe("Nameplate", () => {
  it("keeps the name as real text and hides decorative copies from assistive tech", () => {
    const { container } = withIntensity("full", <Nameplate name="Constant" effect="mythic" />);
    const text = container.querySelector(".gi-np-text");
    expect(text?.textContent).toBe("Constant");
    expect(text?.getAttribute("aria-hidden")).toBeNull();
    expect(container.querySelector(".gi-np-glow")?.getAttribute("aria-hidden")).toBe("true");
    expect(container.querySelector(".gi-np-fx")?.getAttribute("aria-hidden")).toBe("true");
    expect(screen.getAllByText("Constant").filter((node) => !node.closest("[aria-hidden='true']"))).toHaveLength(1);
  });

  it("renders particles only at full intensity", () => {
    const full = withIntensity("full", <Nameplate name="Constant" effect="gold" />);
    expect(full.container.querySelectorAll(".gi-np-ember").length).toBeGreaterThan(0);
    full.unmount();
    for (const intensity of ["subtle", "off"] as const) {
      const view = withIntensity(intensity, <Nameplate name="Constant" effect="gold" />);
      expect(view.container.querySelector(".gi-np-fx")).toBeNull();
      expect(view.container.firstElementChild?.className).toContain(`gi-fx-${intensity}`);
      view.unmount();
    }
  });

  it("lays decorations out deterministically for a given name", () => {
    const first = withIntensity("full", <Nameplate name="mira_codes" effect="diamond" size="lg" />);
    const html = first.container.querySelector(".gi-np-fx")?.innerHTML;
    first.unmount();
    const second = withIntensity("full", <Nameplate name="mira_codes" effect="diamond" size="lg" />);
    expect(second.container.querySelector(".gi-np-fx")?.innerHTML).toBe(html);
  });

  it("scales decoration count with size", () => {
    const small = withIntensity("full", <Nameplate name="Constant" effect="sapphire" size="sm" />);
    const smallCount = small.container.querySelectorAll(".gi-np-speck").length;
    small.unmount();
    const large = withIntensity("full", <Nameplate name="Constant" effect="sapphire" size="lg" />);
    expect(large.container.querySelectorAll(".gi-np-speck").length).toBeGreaterThan(smallCount);
  });
});

describe("AvatarFrame", () => {
  it("drops ornaments and the level badge on tiny avatars", () => {
    const large = withIntensity("full", <AvatarFrame frame="legendary" size={72} level={12} levelLabel="Level 12" />);
    expect(large.container.querySelector(".gi-af-back")).not.toBeNull();
    expect(large.container.querySelector(".gi-af-level")?.textContent).toBe("12");
    large.unmount();
    const tiny = withIntensity("full", <AvatarFrame frame="legendary" size={24} level={12} />);
    expect(tiny.container.querySelector(".gi-af-back")).toBeNull();
    expect(tiny.container.querySelector(".gi-af-front")).toBeNull();
    expect(tiny.container.querySelector(".gi-af-level")).toBeNull();
  });
});

const PLAYERS: LeaderboardPlayer[] = Array.from({ length: 15 }, (_, index) => ({
  id: `p${index + 1}`,
  name: `player_${index + 1}`,
  level: 10 + index,
  xp: 2000 - index * 100,
}));

describe("LeagueBoard", () => {
  it("marks promotion and demotion zones with dividers and highlights the current user", () => {
    const { container } = withIntensity(
      "off",
      <LeagueBoard tier="sapphire" players={[...PLAYERS].reverse()} currentUserId="p4" endsAt={1_000_000_000} now={1_000_000_000 - (2 * 24 + 14) * 3_600_000} />,
    );
    const items = [...container.querySelectorAll(".gi-lb-list > li")];
    const dividers = items.map((item, index) => (item.classList.contains("gi-lb-divider") ? index : -1)).filter((index) => index >= 0);
    // 7 promoted rows, divider, 3 safe rows, divider, 5 demoted rows.
    expect(dividers).toEqual([7, 11]);
    expect(container.querySelectorAll(".gi-lb-row--promotion")).toHaveLength(7);
    expect(container.querySelectorAll(".gi-lb-row--demotion")).toHaveLength(5);
    const me = container.querySelector("[aria-current='true']");
    expect(me?.textContent).toContain("player_4");
    expect(container.querySelector(".gi-lb-countdown")?.textContent).toBe("Ends in 2d 14h");
    expect(container.querySelectorAll(".gi-medal")).toHaveLength(3);
  });
});

describe("TeamProgress", () => {
  it("lists contributions alphabetically without ranks and reports progress", () => {
    const members: LeaderboardPlayer[] = [
      { id: "z", name: "zoe", level: 3, xp: 500 },
      { id: "a", name: "adam", level: 5, xp: 100 },
    ];
    const { container } = withIntensity("off", <TeamProgress goal={1000} members={members} />);
    const names = [...container.querySelectorAll(".gi-lb-row .gi-np-text")].map((node) => node.textContent);
    expect(names).toEqual(["adam", "zoe"]);
    expect(container.querySelector(".gi-lb-pos")).toBeNull();
    const bar = container.querySelector("[role='progressbar']");
    expect(bar?.getAttribute("aria-valuenow")).toBe("600");
    expect(bar?.getAttribute("aria-valuetext")).toBe("600 / 1,000 XP");
  });
});

describe("InventoryView", () => {
  it("equips from a tile, shows unlock conditions for locked items and switches tabs", () => {
    const items: InventoryItem[] = [
      { kind: "name-effect", id: "gold", label: "Gold", rarity: "rare", effect: "gold" },
      { kind: "name-effect", id: "mythic", label: "Mythic", rarity: "legendary", effect: "mythic", locked: true, unlockHint: "Level 100" },
      { kind: "title", id: "planner", label: "The Planner", rarity: "rare", title: "The Planner" },
    ];
    const toggled: string[] = [];
    withIntensity(
      "off",
      <InventoryView
        items={items}
        loadout={{ ...EMPTY_LOADOUT, equipped: { "name-effect": "gold" } }}
        onToggle={(item) => toggled.push(item.id)}
        profile={{ name: "Constant", level: 42 }}
        stardust={1240}
      />,
    );
    expect(screen.getByRole("button", { name: "Equipped" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText("Level 100")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Equipped" }));
    expect(toggled).toEqual(["gold"]);
    fireEvent.click(screen.getByRole("tab", { name: /Titles/ }));
    expect(screen.getByRole("tab", { name: /Titles/ }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("button", { name: "Equip" })).toBeTruthy();
  });
});
