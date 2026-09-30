import { GameSidebarPanel } from "../../components/game/GameSidebarWidget";
import { newcomerState, veteranState } from "../../components/game/progress/fixtures";
import { progressFor, rankFor, xpToReach } from "../../lib/gamification/rules";
import type { GameProfile } from "../../lib/gamification/state";
import { LabDemo, type LabSectionProps } from "../LabKit";
import "./SidebarWidgetSection.css";

function atLevel(profile: GameProfile, level: number, streak: number, freezes = 0): GameProfile {
  const xp = Math.round(xpToReach(level) + (xpToReach(level + 1) - xpToReach(level)) * 0.45);
  return { ...profile, xp, progress: progressFor(xp), rank: rankFor(level).toLowerCase(), streak: { ...profile.streak, current: streak, freezes } };
}

const veteran = veteranState().profile;
const newcomer = newcomerState().profile;

const STATES: readonly { readonly label: string; readonly profile: GameProfile }[] = [
  { label: "Egg · streak 0 · level 1", profile: atLevel(newcomer, 1, 0) },
  { label: "Egg · streak 4 · level 3", profile: atLevel(newcomer, 3, 4) },
  { label: "Baby · streak 0 · level 6", profile: atLevel({ ...veteran, pet: { species: "mochi", name: "Mochi", stage: "baby", hatchedAt: "2026-09-01T00:00:00Z" }, equipped: {} }, 6, 0) },
  { label: "Adult · streak 12 · freeze · level 27", profile: atLevel(veteran, 27, 12, 1) },
  { label: "Level 88 · streak 365 · 2 freezes", profile: atLevel({ ...veteran, pet: { species: "ember", name: "Cinders", stage: "adult", hatchedAt: "2026-01-01T00:00:00Z" } }, 88, 365, 2) },
  { label: "Level 142 · streak 1024", profile: atLevel({ ...veteran, pet: { species: "fern", name: "A very long pet name", stage: "young", hatchedAt: "2026-01-01T00:00:00Z" } }, 142, 1024) },
];

const WIDTHS = [
  { label: "Expanded (232px)", width: 232, collapsed: false },
  { label: "Narrow window (190px)", width: 190, collapsed: false },
  { label: "Collapsed (60px)", width: 60, collapsed: true },
] as const;

export function SidebarWidgetSection({ surface }: LabSectionProps) {
  return (
    <div>
      <LabDemo
        title="Sidebar widget"
        description="GameSidebarWidget from fixture profiles, in the real sidebar widths. The sidebar is dark in both themes."
        surface={surface === "canvas" ? "sidebar" : surface}
        height={200}
      >
        <div className="lab-widget-grid">
          {WIDTHS.map((column) => (
            <div key={column.label} className="lab-widget-column">
              <span className="lab-widget-caption">{column.label}</span>
              {STATES.map((state) => (
                <div key={state.label} className="lab-widget-rail" style={{ width: column.width }} title={state.label} data-state={state.label}>
                  <GameSidebarPanel profile={state.profile} collapsed={column.collapsed} onOpenProgress={() => undefined} />
                  {!column.collapsed && <span className="lab-widget-caption">{state.label}</span>}
                </div>
              ))}
            </div>
          ))}
        </div>
      </LabDemo>
    </div>
  );
}
