import { useState, type CSSProperties, type ReactNode } from "react";
import { Icon } from "../../components/Icon";
import {
  AchievementBadge,
  AVATAR_FRAMES,
  AVATAR_FRAME_RARITY,
  AvatarFrame,
  AvatarPlaceholder,
  IdentityToneProvider,
  InventoryView,
  LeagueBoard,
  LeagueEmblem,
  Nameplate,
  PetGlyph,
  ProfileCard,
  ProjectLeaderboard,
  TeamProgress,
  TitleChip,
  formatCountdown,
  isNameEffectUnlocked,
  nameEffectRarity,
  nextNameEffect,
  toggleItem,
  unlockedNameEffects,
  type AvatarFrameId,
  type IdentityTone,
  type InventoryItem,
  type InventoryLoadout,
  type LeaderboardPlayer,
  type NameplateSize,
  type PinnedBadge,
  type ProjectBoardPeriod,
} from "../../components/game/identity";
import { LEAGUE_TIERS, NAME_EFFECT_LEVELS, NAME_EFFECTS, type LeagueTier, type NameEffectId, type Rarity } from "../../lib/gamification/types";
import { LabButton, LabDemo, LabRange, LabSelect, type LabSectionProps } from "../LabKit";
import { useResolvedTheme } from "../../lib/theme";

// ── Lab-only mock data (English strings; i18n is wired when the components ship) ──

const EFFECT_NAMES: Record<NameEffectId, string> = {
  plain: "Plain",
  copper: "Copper",
  silver: "Silver",
  gold: "Gold",
  emerald: "Emerald",
  sapphire: "Sapphire",
  diamond: "Diamond",
  aurora: "Aurora",
  mythic: "Mythic",
};

const FRAME_NAMES: Record<AvatarFrameId, string> = {
  none: "No border",
  common: "Pewter ring",
  rare: "Twin sapphire",
  epic: "Amethyst halo",
  legendary: "Sun king",
  flame: "Eternal flame",
  laurel: "Planner's laurel",
  frost: "Frostbound",
  prism: "Prism",
};

const RARITY_NAMES: Record<Rarity, string> = { common: "Common", rare: "Rare", epic: "Epic", legendary: "Legendary" };

type SampleBadge = PinnedBadge & { readonly locked?: boolean; readonly progress?: number; readonly progressLabel?: string };

const SAMPLE_BADGES: readonly SampleBadge[] = [
  { id: "first-win", icon: "check-circle", rarity: "common", label: "First win" },
  { id: "early-bird", icon: "sun", rarity: "common", label: "Early bird" },
  { id: "planner", icon: "calendar-check", rarity: "rare", label: "The Planner" },
  { id: "deep-focus", icon: "target", rarity: "rare", label: "Deep focus" },
  { id: "streak-30", icon: "flame", rarity: "epic", label: "Unbreakable" },
  { id: "centurion", icon: "award", rarity: "legendary", label: "Centurion" },
  { id: "inbox-zero", icon: "inbox", rarity: "rare", label: "Inbox zero", locked: true, progress: 0.8, progressLabel: "4/5" },
  { id: "team-player", icon: "heart", rarity: "epic", label: "Team player", locked: true, progress: 0.6, progressLabel: "12/20" },
  { id: "night-owl", icon: "moon", rarity: "legendary", label: "Night owl", locked: true, progress: 0.25, progressLabel: "Secret" },
];

const PINNED: readonly PinnedBadge[] = SAMPLE_BADGES.filter((badge) => ["streak-30", "planner", "centurion"].includes(badge.id));

const LEAGUE_PLAYERS: readonly LeaderboardPlayer[] = [
  { id: "p1", name: "mira_codes", nameEffect: "aurora", frame: "legendary", level: 78, xp: 2140, title: { text: "Unbreakable", rarity: "epic" } },
  { id: "p2", name: "tobias", nameEffect: "diamond", frame: "prism", level: 54, xp: 1985 },
  { id: "p3", name: "Anonymous Otter", level: 12, xp: 1760, frame: "common" },
  { id: "me", name: "constant", nameEffect: "gold", frame: "laurel", level: 27, xp: 1520, title: { text: "The Planner", rarity: "rare" } },
  { id: "p5", name: "lea_v", nameEffect: "sapphire", frame: "frost", level: 43, xp: 1410 },
  { id: "p6", name: "kenji", nameEffect: "emerald", frame: "epic", level: 36, xp: 1290 },
  { id: "p7", name: "noor", nameEffect: "silver", frame: "rare", level: 18, xp: 1105 },
  { id: "p8", name: "sam_in_flow", nameEffect: "mythic", frame: "flame", level: 104, xp: 980, title: { text: "Legend", rarity: "legendary" } },
  { id: "p9", name: "juniper", nameEffect: "copper", frame: "common", level: 8, xp: 870 },
  { id: "p10", name: "Anonymous Heron", level: 15, xp: 760 },
  { id: "p11", name: "ravi", nameEffect: "silver", frame: "rare", level: 22, xp: 640 },
  { id: "p12", name: "elodie", nameEffect: "copper", level: 9, xp: 510 },
  { id: "p13", name: "max_power", nameEffect: "gold", frame: "flame", level: 31, xp: 385 },
  { id: "p14", name: "Anonymous Lynx", level: 5, xp: 120 },
  { id: "p15", name: "quinn", level: 3, xp: 40, frame: "none" },
];

const PROJECT_MEMBERS: Record<ProjectBoardPeriod, readonly LeaderboardPlayer[]> = {
  week: [
    { id: "me", name: "constant", nameEffect: "gold", frame: "laurel", level: 27, xp: 420 },
    { id: "p2", name: "tobias", nameEffect: "diamond", frame: "prism", level: 54, xp: 515 },
    { id: "p5", name: "lea_v", nameEffect: "sapphire", frame: "frost", level: 43, xp: 310 },
    { id: "p9", name: "juniper", nameEffect: "copper", frame: "common", level: 8, xp: 95 },
    { id: "p12", name: "elodie", nameEffect: "copper", level: 9, xp: 60 },
  ],
  all: [
    { id: "me", name: "constant", nameEffect: "gold", frame: "laurel", level: 27, xp: 6240 },
    { id: "p2", name: "tobias", nameEffect: "diamond", frame: "prism", level: 54, xp: 5810 },
    { id: "p5", name: "lea_v", nameEffect: "sapphire", frame: "frost", level: 43, xp: 7020 },
    { id: "p9", name: "juniper", nameEffect: "copper", frame: "common", level: 8, xp: 830 },
    { id: "p12", name: "elodie", nameEffect: "copper", level: 9, xp: 1190 },
  ],
};

const TEAM: readonly LeaderboardPlayer[] = [
  { id: "me", name: "constant", nameEffect: "gold", frame: "laurel", level: 27, xp: 420 },
  { id: "p2", name: "tobias", nameEffect: "diamond", frame: "prism", level: 54, xp: 515 },
  { id: "p5", name: "lea_v", nameEffect: "sapphire", frame: "frost", level: 43, xp: 310 },
  { id: "p9", name: "juniper", nameEffect: "copper", frame: "common", level: 8, xp: 95 },
];

const PROFILE_LEVEL = 42;

function effectItem(effect: NameEffectId): InventoryItem {
  const level = NAME_EFFECT_LEVELS[effect];
  return {
    kind: "name-effect",
    id: `effect-${effect}`,
    label: EFFECT_NAMES[effect],
    rarity: nameEffectRarity(effect),
    effect,
    locked: !isNameEffectUnlocked(effect, PROFILE_LEVEL),
    unlockHint: `Level ${level}`,
  };
}

const INVENTORY: readonly InventoryItem[] = [
  ...NAME_EFFECTS.map(effectItem),
  { kind: "border", id: "border-common", label: FRAME_NAMES.common, rarity: "common", frame: "common" },
  { kind: "border", id: "border-rare", label: FRAME_NAMES.rare, rarity: "rare", frame: "rare" },
  { kind: "border", id: "border-laurel", label: FRAME_NAMES.laurel, rarity: "rare", frame: "laurel" },
  { kind: "border", id: "border-epic", label: FRAME_NAMES.epic, rarity: "epic", frame: "epic" },
  { kind: "border", id: "border-legendary", label: FRAME_NAMES.legendary, rarity: "legendary", frame: "legendary" },
  { kind: "border", id: "border-flame", label: FRAME_NAMES.flame, rarity: "epic", frame: "flame", locked: true, unlockHint: "100-day streak" },
  { kind: "border", id: "border-frost", label: FRAME_NAMES.frost, rarity: "rare", frame: "frost", locked: true, unlockHint: "Use 5 freezes" },
  { kind: "border", id: "border-prism", label: FRAME_NAMES.prism, rarity: "legendary", frame: "prism", locked: true, unlockHint: "Diamond league" },
  { kind: "title", id: "title-early", label: "Early Bird", rarity: "common", title: "Early Bird" },
  { kind: "title", id: "title-planner", label: "The Planner", rarity: "rare", title: "The Planner" },
  { kind: "title", id: "title-deep", label: "Deep Worker", rarity: "rare", title: "Deep Worker" },
  { kind: "title", id: "title-unbreakable", label: "Unbreakable", rarity: "epic", title: "Unbreakable" },
  { kind: "title", id: "title-zen", label: "Zen Master", rarity: "epic", title: "Zen Master", locked: true, unlockHint: "500 Plan tasks" },
  { kind: "title", id: "title-legend", label: "Legend", rarity: "legendary", title: "Legend", locked: true, unlockHint: "Level 100" },
  { kind: "pet-hat", id: "hat-party", label: "Party hat", rarity: "common", preview: <PetGlyph glyph="party-hat" /> },
  { kind: "pet-hat", id: "hat-beanie", label: "Beanie", rarity: "common", preview: <PetGlyph glyph="beanie" /> },
  { kind: "pet-hat", id: "hat-top", label: "Top hat", rarity: "rare", preview: <PetGlyph glyph="top-hat" /> },
  { kind: "pet-hat", id: "hat-crown", label: "Tiny crown", rarity: "legendary", preview: <PetGlyph glyph="crown" />, locked: true, unlockHint: "Legendary chest" },
  { kind: "pet-face", id: "face-glasses", label: "Shades", rarity: "rare", preview: <PetGlyph glyph="glasses" /> },
  { kind: "pet-neck", id: "neck-bowtie", label: "Bow tie", rarity: "common", preview: <PetGlyph glyph="bowtie" /> },
  { kind: "pet-neck", id: "neck-scarf", label: "Cozy scarf", rarity: "epic", preview: <PetGlyph glyph="scarf" /> },
  { kind: "pet-room", id: "room-plant", label: "Desk plant", rarity: "common", preview: <PetGlyph glyph="plant" /> },
  { kind: "pet-room", id: "room-lamp", label: "Reading lamp", rarity: "rare", preview: <PetGlyph glyph="lamp" />, locked: true, unlockHint: "30-day streak" },
  { kind: "confetti", id: "confetti-classic", label: "Classic", rarity: "common", colors: ["#f35f43", "#4b86f0", "#f6c445", "#3fae6a"] },
  { kind: "confetti", id: "confetti-candy", label: "Candy", rarity: "rare", colors: ["#ff7ab6", "#ffc2dd", "#a78bfa", "#fde68a"] },
  { kind: "confetti", id: "confetti-galaxy", label: "Galaxy", rarity: "epic", colors: ["#6d28d9", "#a78bfa", "#38bdf8", "#f0abfc"] },
  { kind: "confetti", id: "confetti-gold", label: "Golden hour", rarity: "legendary", colors: ["#f6c445", "#fff1b8", "#e08a0b", "#ffd76a"] },
  { kind: "confetti", id: "confetti-aurora", label: "Aurora", rarity: "legendary", colors: ["#5eead4", "#818cf8", "#e879f9", "#4ade80"], locked: true, unlockHint: "Level 75" },
  ...SAMPLE_BADGES.map(
    (badge): InventoryItem => ({
      kind: "badge",
      id: badge.id,
      label: badge.label,
      rarity: badge.rarity,
      icon: badge.icon,
      locked: badge.locked,
      unlockHint: badge.progressLabel,
      progress: badge.progress,
    }),
  ),
];

const DEFAULT_LOADOUT: InventoryLoadout = {
  equipped: { "name-effect": "effect-gold", border: "border-laurel", title: "title-planner", "pet-hat": "hat-top", confetti: "confetti-classic" },
  pinnedBadges: ["streak-30", "planner", "centurion"],
};

// ── Layout helpers (lab only) ──

const WIDE: CSSProperties = { gridColumn: "1 / -1", display: "grid", minWidth: 0 };
const PAD: CSSProperties = { width: "100%", boxSizing: "border-box", padding: 16 };
const EYEBROW: CSSProperties = { fontSize: 10.5, fontWeight: 700, letterSpacing: "0.07em", textTransform: "uppercase", color: "var(--gi-faint)" };

function Stage({ tone, children, style }: { readonly tone: IdentityTone; readonly children: ReactNode; readonly style?: CSSProperties }) {
  return (
    <div className={`gi-${tone}`} style={{ ...PAD, ...style }}>
      {children}
    </div>
  );
}

// ── Demos ──

function NameLadderDemo({ surface, tone }: LabSectionProps & { readonly tone: IdentityTone }) {
  const [level, setLevel] = useState(100);
  const [size, setSize] = useState<NameplateSize>("md");
  const [name, setName] = useState("Constant");
  const unlocked = unlockedNameEffects(level);
  const next = nextNameEffect(level);
  return (
    <div style={WIDE}>
      <LabDemo
        title="Name effect ladder"
        description="All nine effects side by side. Drag the level to see what a player has unlocked; each step should read as clearly more prestigious than the last."
        surface={surface}
        controls={
          <>
            <LabRange label="Player level" value={level} min={1} max={120} onChange={setLevel} />
            <LabSelect label="Size" value={size} options={["sm", "md", "lg"] as const} onChange={setSize} />
            <LabSelect label="Name" value={name} options={["Constant", "mira_codes", "Anonymous Otter", "Jo"] as const} onChange={setName} />
          </>
        }
      >
        <Stage tone={tone}>
          <p style={{ margin: "0 0 12px", fontSize: 12.5, color: "var(--gi-muted)" }}>
            {unlocked.length} of {NAME_EFFECTS.length} unlocked
            {next ? ` · next: ${EFFECT_NAMES[next.effect]} at level ${next.level}` : " · everything unlocked"}
          </p>
          <div style={{ display: "grid", gridTemplateColumns: `repeat(auto-fill, minmax(${size === "lg" ? 250 : 190}px, 1fr))`, gap: 10 }}>
            {NAME_EFFECTS.map((effect) => {
              const open = isNameEffectUnlocked(effect, level);
              return (
                <div
                  key={effect}
                  style={{
                    display: "grid",
                    gap: 10,
                    alignContent: "start",
                    minWidth: 0,
                    padding: "12px 14px 14px",
                    borderRadius: 12,
                    border: "1px solid var(--gi-line)",
                    background: open ? "var(--gi-panel)" : "transparent",
                  }}
                >
                  <span style={{ display: "flex", justifyContent: "space-between", gap: 8, ...EYEBROW }}>
                    <span>{EFFECT_NAMES[effect]}</span>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, color: open ? "var(--gi-up)" : "var(--gi-faint)" }}>
                      {open ? <Icon name="check" width={11} height={11} strokeWidth={2.6} /> : <Icon name="lock" width={11} height={11} strokeWidth={2.4} />}
                      Lv {NAME_EFFECT_LEVELS[effect]}
                    </span>
                  </span>
                  <span style={{ display: "flex", minWidth: 0, minHeight: size === "lg" ? 40 : 26, alignItems: "center", opacity: open ? 1 : 0.4, filter: open ? undefined : "grayscale(1)" }}>
                    <Nameplate name={name} effect={effect} size={size} />
                  </span>
                </div>
              );
            })}
          </div>
        </Stage>
      </LabDemo>
    </div>
  );
}

function InContextDemo({ surface, tone }: LabSectionProps & { readonly tone: IdentityTone }) {
  const rows: readonly [string, NameEffectId, AvatarFrameId, number][] = [
    ["juniper", "copper", "common", 8],
    ["noor", "silver", "rare", 18],
    ["constant", "gold", "laurel", 27],
    ["kenji", "emerald", "epic", 36],
    ["lea_v", "sapphire", "frost", 43],
    ["tobias", "diamond", "prism", 54],
    ["mira_codes", "aurora", "legendary", 78],
    ["sam_in_flow", "mythic", "flame", 104],
  ];
  return (
    <LabDemo title="Inline (sm) in a list" description="Assignee chips at list density: 32px frames and small nameplates." surface={surface} height={300}>
      <Stage tone={tone}>
        <ul style={{ display: "grid", gap: 4, margin: 0, padding: 0, listStyle: "none" }}>
          {rows.map(([name, effect, frame, level]) => (
            <li key={name} style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0, padding: "4px 6px", borderRadius: 8 }}>
              <AvatarFrame frame={frame} size={32}>
                <AvatarPlaceholder name={name} />
              </AvatarFrame>
              <span style={{ display: "flex", flex: 1, minWidth: 0 }}>
                <Nameplate name={name} effect={effect} size="sm" />
              </span>
              <span style={{ fontSize: 11.5, color: "var(--gi-muted)", fontVariantNumeric: "tabular-nums" }}>Lv {level}</span>
            </li>
          ))}
        </ul>
      </Stage>
    </LabDemo>
  );
}

function FramesDemo({ surface, tone }: LabSectionProps & { readonly tone: IdentityTone }) {
  const [size, setSize] = useState(72);
  const [badge, setBadge] = useState<"on" | "off">("on");
  return (
    <div style={WIDE}>
      <LabDemo
        title="Avatar frames"
        description="Eight frames tied to rarity and achievements. Ornaments drop away below 48px, and only the ring remains below 30px."
        surface={surface}
        controls={
          <>
            <LabRange label="Size" value={size} min={24} max={96} onChange={setSize} />
            <LabSelect label="Level badge" value={badge} options={["on", "off"] as const} onChange={setBadge} />
          </>
        }
      >
        <Stage tone={tone}>
          <div style={{ display: "grid", gridTemplateColumns: `repeat(auto-fill, minmax(${Math.max(110, size + 44)}px, 1fr))`, gap: "22px 12px", paddingTop: 8 }}>
            {(["none", ...AVATAR_FRAMES] as const).map((frame, index) => (
              <div key={frame} style={{ display: "grid", justifyItems: "center", gap: 10, textAlign: "center" }}>
                <AvatarFrame frame={frame} size={size} level={badge === "on" ? [3, 7, 18, 34, 61, 27, 42, 19, 88][index] : undefined} levelLabel="Level">
                  <AvatarPlaceholder name={["quinn", "juniper", "noor", "kenji", "mira", "sam", "constant", "lea", "tobias"][index]} />
                </AvatarFrame>
                <span style={{ display: "grid", gap: 2 }}>
                  <span style={{ fontSize: 12.5, fontWeight: 650 }}>{FRAME_NAMES[frame]}</span>
                  <span style={{ ...EYEBROW, color: `var(--gi-${AVATAR_FRAME_RARITY[frame]})` }}>{frame === "none" ? "Default" : RARITY_NAMES[AVATAR_FRAME_RARITY[frame]]}</span>
                </span>
              </div>
            ))}
          </div>
        </Stage>
      </LabDemo>
    </div>
  );
}

function FrameSizesDemo({ surface, tone }: LabSectionProps & { readonly tone: IdentityTone }) {
  const [frame, setFrame] = useState<AvatarFrameId>("legendary");
  return (
    <LabDemo
      title="One frame, every size"
      description="24 · 32 · 40 · 56 · 72 · 96 px"
      surface={surface}
      controls={<LabSelect label="Frame" value={frame} options={["none", ...AVATAR_FRAMES] as const} onChange={setFrame} />}
    >
      <Stage tone={tone} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "center", gap: 18 }}>
        {[24, 32, 40, 56, 72, 96].map((px) => (
          <AvatarFrame key={px} frame={frame} size={px} level={px >= 40 ? 42 : undefined}>
            <AvatarPlaceholder name="constant" />
          </AvatarFrame>
        ))}
      </Stage>
    </LabDemo>
  );
}

function TitlesDemo({ surface, tone }: LabSectionProps & { readonly tone: IdentityTone }) {
  const titles: readonly [string, Rarity][] = [
    ["Early Bird", "common"],
    ["The Planner", "rare"],
    ["Unbreakable", "epic"],
    ["Legend", "legendary"],
  ];
  return (
    <LabDemo title="Titles" description="Rarity decides the plaque: flat, tinted, gradient rim, gold leaf with a sheen." surface={surface}>
      <Stage tone={tone} style={{ display: "grid", gap: 14, justifyItems: "center" }}>
        {(["md", "sm"] as const).map((size) => (
          <div key={size} style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center" }}>
            {titles.map(([title, rarity]) => (
              <TitleChip key={title} title={title} rarity={rarity} size={size} />
            ))}
          </div>
        ))}
      </Stage>
    </LabDemo>
  );
}

function BadgesDemo({ surface, tone }: LabSectionProps & { readonly tone: IdentityTone }) {
  return (
    <div style={WIDE}>
      <LabDemo title="Achievement badges" description="Round → scalloped → octagonal with gems → gold starburst. Locked badges are grey with a progress ring." surface={surface}>
        <Stage tone={tone}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(96px, 1fr))", gap: "18px 8px", justifyItems: "center" }}>
            {SAMPLE_BADGES.map((badge) => (
              <AchievementBadge
                key={badge.id}
                icon={badge.icon}
                rarity={badge.rarity}
                label={badge.label}
                locked={badge.locked}
                progress={badge.progress}
                progressLabel={badge.progressLabel}
                caption={badge.label}
                size={64}
              />
            ))}
          </div>
        </Stage>
      </LabDemo>
    </div>
  );
}

function EmblemsDemo({ surface, tone }: LabSectionProps & { readonly tone: IdentityTone }) {
  const [size, setSize] = useState(64);
  return (
    <div style={WIDE}>
      <LabDemo
        title="League emblems"
        description="Pebble to Diamond: stone, metal shields, enamel and gems, then wings, a crown and a radiant diamond."
        surface={surface}
        controls={<LabRange label="Size" value={size} min={24} max={96} onChange={setSize} />}
      >
        <Stage tone={tone}>
          <div style={{ display: "grid", gridTemplateColumns: `repeat(auto-fill, minmax(${Math.max(84, size + 30)}px, 1fr))`, gap: "22px 8px", paddingTop: 10 }}>
            {LEAGUE_TIERS.map((tier) => (
              <div key={tier} style={{ display: "grid", justifyItems: "center", gap: 10 }}>
                <LeagueEmblem tier={tier} size={size} />
                <span style={{ ...EYEBROW, color: "var(--gi-muted)" }}>{tier}</span>
              </div>
            ))}
          </div>
        </Stage>
      </LabDemo>
    </div>
  );
}

function ProfileDemo({ surface, tone }: LabSectionProps & { readonly tone: IdentityTone }) {
  const [effect, setEffect] = useState<NameEffectId>("diamond");
  const [frame, setFrame] = useState<AvatarFrameId>("prism");
  const [league, setLeague] = useState<LeagueTier>("sapphire");
  return (
    <LabDemo
      title="Profile card"
      description="How a player appears on leaderboards and their profile."
      surface={surface}
      height={260}
      controls={
        <>
          <LabSelect label="Effect" value={effect} options={NAME_EFFECTS} onChange={setEffect} />
          <LabSelect label="Frame" value={frame} options={["none", ...AVATAR_FRAMES] as const} onChange={setFrame} />
          <LabSelect label="League" value={league} options={LEAGUE_TIERS} onChange={setLeague} />
        </>
      }
    >
      <Stage tone={tone} style={{ display: "grid", justifyItems: "center" }}>
        <ProfileCard
          name="Constant"
          handle="constant"
          nameEffect={effect}
          frame={frame}
          level={NAME_EFFECT_LEVELS[effect] + 4}
          levelProgress={0.62}
          title={{ text: "The Planner", rarity: "rare" }}
          badges={PINNED}
          league={league}
        />
      </Stage>
    </LabDemo>
  );
}

const WEEK_END = Date.UTC(2026, 9, 5, 0, 0);
const LAB_NOW = WEEK_END - ((2 * 24 + 14) * 60 + 7) * 60_000;

function LeagueBoardDemo({ surface, tone }: LabSectionProps & { readonly tone: IdentityTone }) {
  const [tier, setTier] = useState<LeagueTier>("sapphire");
  return (
    <div style={WIDE}>
      <LabDemo
        title="Weekly league"
        description={`15 players. Top 7 promote, bottom 5 demote (none from Pebble, no promotion from Diamond). Countdown: ${formatCountdown(WEEK_END - LAB_NOW)}.`}
        surface={surface}
        controls={<LabSelect label="Tier" value={tier} options={LEAGUE_TIERS} onChange={setTier} />}
      >
        <Stage tone={tone} style={{ display: "grid", justifyItems: "center" }}>
          <div style={{ width: "100%", maxWidth: 560 }}>
            <LeagueBoard tier={tier} players={LEAGUE_PLAYERS} currentUserId="me" endsAt={WEEK_END} now={LAB_NOW} />
          </div>
        </Stage>
      </LabDemo>
    </div>
  );
}

function ProjectBoardDemo({ surface, tone }: LabSectionProps & { readonly tone: IdentityTone }) {
  const [period, setPeriod] = useState<ProjectBoardPeriod>("week");
  return (
    <LabDemo title="Project leaderboard (Competitive)" description="Members ranked by XP on this project's tasks." surface={surface} height={300}>
      <Stage tone={tone}>
        <ProjectLeaderboard title="Website Redesign" members={PROJECT_MEMBERS[period]} currentUserId="me" period={period} onPeriodChange={setPeriod} />
      </Stage>
    </LabDemo>
  );
}

function TeamDemo({ surface, tone }: LabSectionProps & { readonly tone: IdentityTone }) {
  const [goal, setGoal] = useState(2000);
  return (
    <LabDemo
      title="Project leaderboard (Team)"
      description="One shared bar toward the weekly goal; contributions listed alphabetically, never ranked."
      surface={surface}
      height={300}
      controls={<LabRange label="Goal" value={goal} min={600} max={3000} step={100} onChange={setGoal} />}
    >
      <Stage tone={tone}>
        <TeamProgress
          goal={goal}
          members={TEAM}
          currentUserId="me"
          aside={
            <span className="gi-lb-countdown">
              <Icon name="clock" width={13} height={13} strokeWidth={2} />
              {formatCountdown(WEEK_END - LAB_NOW)}
            </span>
          }
        />
      </Stage>
    </LabDemo>
  );
}

function InventoryDemo({ surface, tone }: LabSectionProps & { readonly tone: IdentityTone }) {
  const [loadout, setLoadout] = useState<InventoryLoadout>(DEFAULT_LOADOUT);
  const [stardust, setStardust] = useState(1240);
  return (
    <div style={WIDE}>
      <LabDemo
        title="Inventory"
        description="Equip anything unlocked; the leaderboard preview updates live. Pinning a fourth badge replaces the oldest pin."
        surface={surface}
        controls={<LabButton onClick={() => setLoadout(DEFAULT_LOADOUT)}>Reset loadout</LabButton>}
      >
        <Stage tone={tone} style={{ maxWidth: 760 }}>
          <InventoryView
            items={INVENTORY}
            loadout={loadout}
            onToggle={(item) => setLoadout((current) => toggleItem(current, item))}
            profile={{ name: "Constant", handle: "constant", level: PROFILE_LEVEL, levelProgress: 0.62, league: "sapphire" }}
            stardust={stardust}
            onCraft={() => setStardust((amount) => Math.max(0, amount - 250))}
          />
        </Stage>
      </LabDemo>
    </div>
  );
}

export function NameplateSection({ surface }: LabSectionProps) {
  // The sidebar is dark in both themes; the canvas follows the app theme.
  const theme = useResolvedTheme();
  const tone: IdentityTone = surface === "sidebar" ? "dark" : theme;
  const props = { surface, tone };
  return (
    <IdentityToneProvider tone={tone}>
      <div>
        <NameLadderDemo {...props} />
        <InContextDemo {...props} />
        <ProfileDemo {...props} />
        <TitlesDemo {...props} />
        <FramesDemo {...props} />
        <FrameSizesDemo {...props} />
        <BadgesDemo {...props} />
        <EmblemsDemo {...props} />
        <LeagueBoardDemo {...props} />
        <ProjectBoardDemo {...props} />
        <TeamDemo {...props} />
        <InventoryDemo {...props} />
      </div>
    </IdentityToneProvider>
  );
}
