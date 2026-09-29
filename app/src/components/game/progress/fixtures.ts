// Fixture game data for the Game Lab and tests. Not imported by the app.
import { progressFor, rankFor } from "../../../lib/gamification/rules";
import type {
  ChestDrop,
  GameAchievement,
  GameBoard,
  GameLeague,
  GamePlayer,
  GameProfile,
  GameState,
  ProjectLeaderboard,
} from "../../../lib/gamification/state";
import { NAME_EFFECTS, NAME_EFFECT_LEVELS, type Rarity } from "../../../lib/gamification/types";

/** Wednesday 30 Sep 2026, 14:00 UTC: mid-week, daytime. */
export const FIXTURE_NOW = Date.UTC(2026, 8, 30, 14, 0, 0);
const WEEK_START = "2026-09-28T00:00:00Z";
const WEEK_END = "2026-10-05T00:00:00Z";

type AchievementRow = readonly [id: string, category: string, rarity: Rarity, target: number, extra?: { secret?: true; border?: string; title?: string }];

// The server catalog (server/internal/gamification/achievements.go), in order.
const ACHIEVEMENT_ROWS: readonly AchievementRow[] = [
  ["first-step", "start", "common", 1],
  ["warming-up", "start", "common", 10],
  ["centurion", "start", "rare", 100],
  ["veteran", "start", "epic", 500, { border: "border-epic-gems" }],
  ["legend", "start", "legendary", 2000, { border: "border-legendary-orbit", title: "title-legend" }],
  ["in-the-zone", "focus", "common", 25],
  ["firefighter", "focus", "epic", 250, { title: "title-firefighter" }],
  ["clean-slate", "focus", "rare", 0, { secret: true }],
  ["the-planner", "planning", "rare", 10, { border: "border-laurel", title: "title-planner" }],
  ["architect", "planning", "epic", 100, { title: "title-architect" }],
  ["punctual", "planning", "common", 25],
  ["clockwork", "planning", "epic", 200, { title: "title-clockwork" }],
  ["three-in-a-row", "consistency", "common", 3],
  ["week-warrior", "consistency", "rare", 7, { border: "border-flame" }],
  ["unbreakable", "consistency", "epic", 30, { title: "title-unbreakable" }],
  ["centennial", "consistency", "legendary", 100, { border: "border-frost" }],
  ["eternal-flame", "consistency", "legendary", 365, { title: "title-eternal-flame" }],
  ["habit-forming", "habits", "common", 10],
  ["second-nature", "habits", "rare", 100],
  ["creature-of-habit", "habits", "epic", 500, { title: "title-creature-of-habit" }],
  ["level-10", "growth", "common", 10],
  ["level-25", "growth", "rare", 25],
  ["level-50", "growth", "epic", 50, { border: "border-rare-double" }],
  ["level-100", "growth", "legendary", 100, { title: "title-centurion" }],
  ["team-player", "team", "common", 10, { title: "title-team-player" }],
  ["cheerleader", "team", "common", 10],
  ["crowd-favorite", "team", "rare", 25],
  ["rising", "leagues", "common", 0, { secret: true }],
  ["diamond-league", "leagues", "legendary", 0, { secret: true, border: "border-prism" }],
  ["early-bird", "secret", "common", 0, { secret: true, title: "title-early-bird" }],
  ["night-owl", "secret", "common", 0, { secret: true, title: "title-night-owl" }],
  ["welcome-back", "secret", "common", 0, { secret: true }],
];

/** Progress per achievement id; ids present with a date are unlocked. */
function buildAchievements(progress: Readonly<Record<string, number>>, unlocked: Readonly<Record<string, string>>): GameAchievement[] {
  return ACHIEVEMENT_ROWS.map(([id, category, rarity, target, extra]) => ({
    id,
    category,
    rarity,
    ...(extra?.secret ? { secret: true } : {}),
    ...(extra?.border ? { border: extra.border } : {}),
    ...(extra?.title ? { title: extra.title } : {}),
    ...(target ? { target } : {}),
    progress: unlocked[id] ? target : Math.min(progress[id] ?? 0, target),
    unlockedAt: unlocked[id] ?? null,
  }));
}

function profileAt(xp: number, patch: Partial<GameProfile> = {}): GameProfile {
  const progress = progressFor(xp);
  return {
    onboardingVersion: 1,
    currentOnboarding: 1,
    enabled: true,
    handle: "constant",
    anonymousKey: "otter",
    visibility: "public",
    effects: "full",
    sounds: false,
    timeZone: "Europe/Paris",
    xp,
    progress,
    rank: rankFor(progress.level).toLowerCase(),
    todayTaskXp: 185,
    dailyCapXp: 800,
    streak: { current: 12, best: 41, freezes: 1, lastDay: "2026-09-30" },
    stardust: 185,
    leagueTier: "sapphire",
    pet: { species: "nova", name: "Pixel", stage: progress.level >= 25 ? "adult" : progress.level >= 10 ? "young" : "baby", hatchedAt: "2026-06-02T08:12:00Z" },
    equipped: { nameEffect: "gold", border: "border-laurel", title: "title-planner", petHat: "hat-flower", petFace: "face-glasses", petRoom: "room-lamp", confetti: "confetti-gold" },
    pinnedAchievements: ["the-planner", "unbreakable", "centurion"],
    nameEffects: NAME_EFFECTS.filter((effect) => progress.level >= NAME_EFFECT_LEVELS[effect]),
    ...patch,
  };
}

const owned = (ids: readonly string[]) => ids.map((itemId, index) => ({ itemId, kind: "", acquiredAt: new Date(Date.UTC(2026, 5, 2 + index)).toISOString() }));

/** A player at level 27 with a pet, cosmetics, chests and most early achievements. */
export function veteranState(): GameState {
  return {
    profile: profileAt(15_200),
    inventory: owned([
      "border-common-ring", "confetti-classic", "border-laurel", "border-flame", "title-planner", "title-unbreakable", "title-dreamer",
      "hat-party", "hat-flower", "face-glasses", "neck-scarf", "room-lamp", "room-plant", "room-rug", "confetti-gold", "confetti-pastel",
    ]),
    achievements: buildAchievements(
      { centurion: 100, veteran: 312, legend: 312, firefighter: 64, architect: 37, clockwork: 88, centennial: 41, "eternal-flame": 41, "second-nature": 58, "creature-of-habit": 58, "level-50": 27, "level-100": 27, "team-player": 6, cheerleader: 3, "crowd-favorite": 9 },
      {
        "first-step": "2026-06-02T09:00:00Z",
        "warming-up": "2026-06-05T17:40:00Z",
        centurion: "2026-08-11T10:00:00Z",
        "in-the-zone": "2026-07-01T12:00:00Z",
        "the-planner": "2026-06-20T08:30:00Z",
        punctual: "2026-07-14T16:00:00Z",
        "three-in-a-row": "2026-06-05T20:00:00Z",
        "week-warrior": "2026-06-09T20:00:00Z",
        unbreakable: "2026-07-02T19:00:00Z",
        "habit-forming": "2026-06-12T07:30:00Z",
        "level-10": "2026-06-18T11:00:00Z",
        "level-25": "2026-09-12T15:00:00Z",
        "early-bird": "2026-06-07T06:40:00Z",
      },
    ),
    chests: [
      { id: "chest-rare", tier: "rare", source: "level", sourceRef: "25", grantedAt: "2026-09-12T15:00:00Z" },
      { id: "chest-epic", tier: "epic", source: "achievement", sourceRef: "unbreakable", grantedAt: "2026-07-02T19:00:00Z" },
      { id: "chest-common", tier: "common", source: "level", sourceRef: "27", grantedAt: "2026-09-29T18:00:00Z" },
    ],
    events: [],
  };
}

/** Just switched on: an egg, the starter items, nothing else yet. */
export function newcomerState(): GameState {
  return {
    profile: profileAt(40, {
      handle: null,
      visibility: "hidden",
      streak: { current: 0, best: 0, freezes: 0 },
      stardust: 0,
      leagueTier: "pebble",
      todayTaskXp: 0,
      pet: { species: null, name: "", stage: "egg", hatchedAt: null },
      equipped: { border: "border-common-ring", confetti: "confetti-classic" },
      pinnedAchievements: [],
    }),
    inventory: owned(["border-common-ring", "confetti-classic"]),
    achievements: buildAchievements({}, {}),
    chests: [],
    events: [],
  };
}

export const CHEST_DROPS: Readonly<Record<Rarity, readonly ChestDrop[]>> = {
  common: [{ itemId: "hat-beanie", kind: "pet-hat", rarity: "common" }],
  rare: [
    { itemId: "room-shelf", kind: "pet-room", rarity: "rare" },
    { itemId: "hat-party", kind: "pet-hat", rarity: "common", duplicate: true, stardust: 5 },
  ],
  epic: [
    { itemId: "face-shades", kind: "pet-face", rarity: "epic" },
    { itemId: "confetti-neon", kind: "confetti", rarity: "rare" },
    { rarity: "rare", freeze: true },
  ],
  legendary: [
    { itemId: "hat-crown", kind: "pet-hat", rarity: "legendary" },
    { itemId: "title-starlit", kind: "title", rarity: "epic" },
    { itemId: "confetti-gold", kind: "confetti", rarity: "rare", duplicate: true, stardust: 20 },
  ],
};

type PlayerSeed = readonly [handle: string | null, level: number, xp: number, extra?: Partial<GamePlayer>];

function player(position: number, [handle, level, xp, extra]: PlayerSeed): GamePlayer {
  return {
    position,
    handle,
    level,
    rank: rankFor(level).toLowerCase(),
    xp,
    streak: 0,
    leagueTier: "sapphire",
    equipped: {},
    pet: null,
    isMe: false,
    ...extra,
  };
}

const ME_EXTRA: Partial<GamePlayer> = {
  isMe: true,
  equipped: { nameEffect: "gold", border: "border-laurel", title: "title-planner", petHat: "hat-flower" },
  pet: { species: "nova", stage: "adult" },
};

const LEAGUE_SEEDS: readonly (readonly [handle: string | null, level: number, weekly: number, extra?: Partial<GamePlayer>])[] = [
  ["mira_codes", 48, 1840, { equipped: { nameEffect: "sapphire", border: "border-epic-gems", title: "title-unbreakable" }, pet: { species: "mochi", stage: "adult" } }],
  ["tobias", 33, 1515, { equipped: { nameEffect: "emerald", border: "border-flame" }, pet: { species: "ember", stage: "adult" } }],
  ["constant", 27, 1320, ME_EXTRA],
  [null, 22, 1180, { anonymous: "heron" }],
  ["lea_v", 30, 1015, { equipped: { nameEffect: "emerald", border: "border-laurel", title: "title-dreamer" }, pet: { species: "fern", stage: "adult" } }],
  ["kenji", 25, 910, { equipped: { nameEffect: "gold", border: "border-rare-double" } }],
  ["noor", 19, 820, { equipped: { nameEffect: "silver" }, pet: { species: "nova", stage: "young" } }],
  ["juniper", 12, 640, { equipped: { nameEffect: "silver", border: "border-common-ring" }, pet: { species: "fern", stage: "young" } }],
  [null, 15, 505, { anonymous: "lynx" }],
  ["ravi", 21, 420, { equipped: { nameEffect: "gold" } }],
  ["elodie", 9, 310, { equipped: { nameEffect: "copper" }, pet: { species: "mochi", stage: "baby" } }],
  ["max_power", 31, 190, { equipped: { nameEffect: "emerald", border: "border-flame" } }],
  [null, 6, 95, { anonymous: "otter" }],
  ["quinn", 4, 40],
];

export function leagueFixture(patch: Partial<GameLeague> = {}): GameLeague {
  const members = LEAGUE_SEEDS.map(([handle, level, weekly, extra], index) => ({ ...player(index + 1, [handle, level, weekly * 9, extra]), weeklyXp: weekly }));
  return {
    tier: "sapphire",
    tierIndex: 4,
    weekStart: WEEK_START,
    endsAt: WEEK_END,
    joined: true,
    promote: 3,
    demote: 2,
    members,
    lastResult: { outcome: "promoted", rank: 3, tier: "sapphire" },
    ...patch,
  };
}

export function boardFixture(board: "level" | "streak"): GameBoard {
  const top: readonly PlayerSeed[] =
    board === "level"
      ? [
          ["sam_in_flow", 104, 412_000, { equipped: { nameEffect: "mythic", border: "border-prism", title: "title-legend" }, pet: { species: "ember", stage: "radiant" }, streak: 290 }],
          ["aurelie", 81, 231_500, { equipped: { nameEffect: "aurora", border: "border-legendary-orbit" }, pet: { species: "nova", stage: "radiant" }, streak: 120 }],
          ["mira_codes", 48, 64_800, { equipped: { nameEffect: "sapphire", border: "border-epic-gems" }, pet: { species: "mochi", stage: "adult" }, streak: 66 }],
          [null, 44, 55_200, { anonymous: "puffin", streak: 12 }],
          ["tobias", 33, 29_900, { equipped: { nameEffect: "emerald", border: "border-flame" }, pet: { species: "ember", stage: "adult" }, streak: 21 }],
          ["max_power", 31, 26_400, { equipped: { nameEffect: "emerald" }, streak: 3 }],
          ["lea_v", 30, 24_700, { equipped: { nameEffect: "emerald", border: "border-laurel" }, pet: { species: "fern", stage: "adult" }, streak: 8 }],
          ["kenji", 25, 17_100, { equipped: { nameEffect: "gold", border: "border-rare-double" }, streak: 30 }],
        ]
      : [
          ["sam_in_flow", 104, 412_000, { equipped: { nameEffect: "mythic", border: "border-prism" }, pet: { species: "ember", stage: "radiant" }, streak: 290 }],
          ["aurelie", 81, 231_500, { equipped: { nameEffect: "aurora", border: "border-legendary-orbit" }, pet: { species: "nova", stage: "radiant" }, streak: 120 }],
          ["mira_codes", 48, 64_800, { equipped: { nameEffect: "sapphire" }, pet: { species: "mochi", stage: "adult" }, streak: 66 }],
          ["kenji", 25, 17_100, { equipped: { nameEffect: "gold" }, streak: 30 }],
          ["tobias", 33, 29_900, { equipped: { nameEffect: "emerald" }, streak: 21 }],
          ["constant", 27, 15_200, { ...ME_EXTRA, streak: 12 }],
          [null, 44, 55_200, { anonymous: "puffin", streak: 12 }],
        ];
  const players = top.map((seed, index) => player(index + 1, seed));
  const me = players.find((entry) => entry.isMe) ?? player(14, ["constant", 27, 15_200, { ...ME_EXTRA, streak: 12 }]);
  return { board, players, me };
}

export function projectBoardFixture(patch: Partial<ProjectLeaderboard> = {}): ProjectLeaderboard {
  const member = (userId: string, displayName: string, level: number, weeklyXp: number, totalXp: number, extra: Partial<ProjectLeaderboard["members"][number]> = {}) => ({
    userId,
    displayName,
    avatarUrl: "",
    level,
    equipped: {},
    pet: null,
    weeklyXp,
    totalXp,
    isMe: false,
    ...extra,
  });
  return {
    mode: "competitive",
    teamGoalXp: 1500,
    isOwner: true,
    myChoice: true,
    weekStart: WEEK_START,
    teamWeeklyXp: 1320,
    members: [
      member("u-me", "Constant Suchet", 27, 420, 6240, { isMe: true, equipped: { nameEffect: "gold", border: "border-laurel", petHat: "hat-flower" }, pet: { species: "nova", stage: "adult" } }),
      member("u-tobias", "Tobias Keller", 33, 515, 5810, { equipped: { nameEffect: "emerald", border: "border-flame" }, pet: { species: "ember", stage: "adult" } }),
      member("u-lea", "Léa Vasseur", 30, 290, 7020, { equipped: { nameEffect: "emerald", border: "border-laurel" }, pet: { species: "fern", stage: "adult" } }),
      member("u-juniper", "Juniper Hale", 12, 95, 830, { equipped: { nameEffect: "silver" } }),
    ],
    ...patch,
  };
}
