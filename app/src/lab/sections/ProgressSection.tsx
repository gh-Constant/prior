import { useState, type CSSProperties } from "react";
import { ChestDialog } from "../../components/game/progress/ChestDialog";
import { CHEST_DROPS, FIXTURE_NOW, boardFixture, leagueFixture, newcomerState, projectBoardFixture, veteranState } from "../../components/game/progress/fixtures";
import { ProgressPage, type LeagueData, type ProgressTab } from "../../components/game/progress/ProgressPage";
import { ProjectLeaderboardCard } from "../../components/game/progress/ProjectLeaderboardPanel";
import type { EquipSlot } from "../../components/game/progress/progressModel";
import { CRAFT_COST, catalogEntry } from "../../lib/gamification/catalog";
import type { GameChest, GameState, ProjectLeaderboard, ProjectLeaderboardMode } from "../../lib/gamification/state";
import { LabButton, LabDemo, LabSelect, type LabSectionProps } from "../LabKit";

const WIDE: CSSProperties = { gridColumn: "1 / -1", display: "grid", minWidth: 0 };
const PAD: CSSProperties = { width: "100%", boxSizing: "border-box", padding: "20px 20px 28px", alignSelf: "start" };

type Scenario = "veteran" | "newcomer" | "hidden" | "calm" | "loading" | "offline";
type LeagueScenario = "ready" | "not placed" | "loading" | "failed";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function initialState(scenario: Scenario): GameState | null {
  if (scenario === "loading" || scenario === "offline") return null;
  if (scenario === "newcomer") return newcomerState();
  const state = veteranState();
  if (scenario === "hidden") return { ...state, profile: { ...state.profile, visibility: "hidden" } };
  if (scenario === "calm") return { ...state, profile: { ...state.profile, enabled: false } };
  return state;
}

function leagueData(scenario: LeagueScenario): LeagueData {
  if (scenario === "loading") return { status: "loading", league: null, level: null, streak: null };
  if (scenario === "failed") return { status: "error", league: null, level: null, streak: null, offline: true };
  const league = scenario === "not placed" ? leagueFixture({ joined: false, members: [], promote: 0, demote: 0, lastResult: null }) : leagueFixture();
  return { status: "ready", league, level: boardFixture("level"), streak: boardFixture("streak") };
}

function ProgressPageDemo({ surface }: LabSectionProps) {
  const [scenario, setScenario] = useState<Scenario>("veteran");
  const [leagues, setLeagues] = useState<LeagueScenario>("ready");
  const [tab, setTab] = useState<ProgressTab>("overview");
  const [state, setState] = useState<GameState | null>(() => initialState("veteran"));
  const [chest, setChest] = useState<GameChest | null>(null);
  const [failSaves, setFailSaves] = useState<"saves work" | "saves fail">("saves work");
  const [log, setLog] = useState("Interact with the page: actions are applied to the fixture.");

  function pick(next: Scenario) {
    setScenario(next);
    setState(initialState(next));
  }

  const update = (fn: (current: GameState) => GameState) => setState((current) => (current ? fn(current) : current));

  async function save(label: string, apply: () => void) {
    setLog(label);
    await wait(250);
    if (failSaves === "saves fail") throw new Error("offline");
    apply();
  }

  return (
    <div style={WIDE}>
      <LabDemo
        title="Progress page"
        description="The whole page from fixtures: tabs, equip, pin, rename, craft and chests all mutate local state. Switch scenarios to see the egg, the hidden and calm explanations, loading and offline."
        surface={surface === "sidebar" ? "canvas" : surface}
        height={640}
        controls={
          <>
            <LabSelect label="Scenario" value={scenario} options={["veteran", "newcomer", "hidden", "calm", "loading", "offline"] as const} onChange={pick} />
            <LabSelect label="Leagues" value={leagues} options={["ready", "not placed", "loading", "failed"] as const} onChange={setLeagues} />
            <LabSelect label="Server" value={failSaves} options={["saves work", "saves fail"] as const} onChange={setFailSaves} />
            <LabButton onClick={() => pick(scenario)}>Reset</LabButton>
          </>
        }
      >
        <div style={PAD}>
          <ProgressPage
            state={state}
            enabled={Boolean(state?.profile.enabled)}
            loading={scenario === "loading"}
            tab={tab}
            onTabChange={setTab}
            leagues={leagueData(leagues)}
            now={FIXTURE_NOW}
            onRetry={() => setLog("onRetry()")}
            onRetryLeagues={() => setLeagues("ready")}
            onOpenGameSettings={() => setLog("onOpenGameSettings()")}
            onOpenChest={setChest}
            onEquip={(slot: EquipSlot, itemId: string) =>
              save(`equip(${slot}, "${itemId}")`, () =>
                update((current) => ({ ...current, profile: { ...current.profile, equipped: { ...current.profile.equipped, [slot]: itemId || undefined } } })),
              )
            }
            onPinAchievements={(ids) => save(`pinAchievements([${ids.join(", ")}])`, () => update((current) => ({ ...current, profile: { ...current.profile, pinnedAchievements: ids } })))}
            onRenamePet={(name) =>
              save(`setPetName("${name}")`, () => update((current) => ({ ...current, profile: { ...current.profile, pet: current.profile.pet && { ...current.profile.pet, name } } })))
            }
            onCraft={(itemId) =>
              save(`craft(${itemId})`, () =>
                update((current) => {
                  const entry = catalogEntry(itemId);
                  const cost = entry ? CRAFT_COST[entry.rarity] : 0;
                  return {
                    ...current,
                    profile: { ...current.profile, stardust: current.profile.stardust - cost },
                    inventory: [...current.inventory, { itemId, kind: entry?.kind ?? "", acquiredAt: new Date().toISOString() }],
                  };
                }),
              )
            }
          />
          <p style={{ margin: "18px 0 0", fontSize: 12, color: "var(--muted)", fontFamily: "ui-monospace, monospace" }}>{log}</p>
        </div>
      </LabDemo>
      {chest && (
        <ChestDialog
          key={chest.id}
          chest={chest}
          stardust={state?.profile.stardust ?? 0}
          openChest={async () => {
            await wait(700);
            if (failSaves === "saves fail") throw new Error("offline");
            const drops = [...CHEST_DROPS[chest.tier]];
            update((current) => ({
              ...current,
              chests: current.chests.filter((item) => item.id !== chest.id),
              profile: { ...current.profile, stardust: current.profile.stardust + drops.reduce((sum, drop) => sum + (drop.stardust ?? 0), 0) },
            }));
            return drops;
          }}
          onClose={() => setChest(null)}
        />
      )}
    </div>
  );
}

type Role = "owner" | "member";
type Choice = "undecided" | "joined" | "declined";

function ProjectBoardDemo({ surface }: LabSectionProps) {
  const [role, setRole] = useState<Role>("owner");
  const [mode, setMode] = useState<ProjectLeaderboardMode>("competitive");
  const [choice, setChoice] = useState<Choice>("joined");
  const [viewer, setViewer] = useState<"gamified" | "calm">("gamified");
  const [goal, setGoal] = useState(1500);
  const [busy, setBusy] = useState(false);
  const board: ProjectLeaderboard = projectBoardFixture({
    mode,
    teamGoalXp: goal,
    isOwner: role === "owner",
    myChoice: choice === "undecided" ? null : choice === "joined",
  });
  const hidden = viewer === "calm" && role !== "owner";

  async function act(fn: () => void) {
    setBusy(true);
    await wait(350);
    fn();
    setBusy(false);
  }

  return (
    <div style={WIDE}>
      <LabDemo
        title="Project leaderboard"
        description="Owner controls (Off, Competitive, Team with a weekly goal), the one-time opt-in for members, and the board or team goal. Calm members see nothing."
        surface={surface === "sidebar" ? "canvas" : surface}
        height={420}
        controls={
          <>
            <LabSelect label="Viewer" value={role} options={["owner", "member"] as const} onChange={setRole} />
            <LabSelect label="Mode" value={mode} options={["off", "competitive", "team"] as const} onChange={setMode} />
            <LabSelect label="Choice" value={choice} options={["undecided", "joined", "declined"] as const} onChange={setChoice} />
            <LabSelect label="Experience" value={viewer} options={["gamified", "calm"] as const} onChange={setViewer} />
          </>
        }
      >
        <div style={{ ...PAD, maxWidth: 560 }}>
          {hidden ? (
            <p style={{ margin: 0, color: "var(--muted)", fontSize: 13 }}>Hidden: calm members never see project leaderboards.</p>
          ) : board.mode === "off" && role !== "owner" ? (
            <p style={{ margin: 0, color: "var(--muted)", fontSize: 13 }}>Hidden: the owner keeps it off.</p>
          ) : (
            <ProjectLeaderboardCard
              board={board}
              viewerEnabled={viewer === "gamified"}
              busy={busy}
              now={FIXTURE_NOW}
              onModeChange={(next, nextGoal) =>
                act(() => {
                  setMode(next);
                  setGoal(nextGoal);
                })
              }
              onChoice={(joined) => act(() => setChoice(joined ? "joined" : "declined"))}
            />
          )}
        </div>
      </LabDemo>
    </div>
  );
}

export function ProgressSection(props: LabSectionProps) {
  return (
    <div>
      <ProgressPageDemo {...props} />
      <ProjectBoardDemo {...props} />
    </div>
  );
}
