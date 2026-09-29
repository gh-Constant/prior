import { useCallback, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { AchievementToastStack, useAchievementToasts } from "../../components/game/fx/AchievementToast";
import { celebrateCompletion, celebrateQuadrantCleared } from "../../components/game/fx/celebrate";
import { ChestOpening, type ChestReward } from "../../components/game/fx/ChestOpening";
import { LevelUpOverlay } from "../../components/game/fx/LevelUpOverlay";
import { StreakFlame, type StreakFreezeState } from "../../components/game/fx/StreakFlame";
import { XpBar } from "../../components/game/fx/XpBar";
import { emit, viewportRect, type ParticlePreset } from "../../lib/fx/particles";
import { CONFETTI_THEMES, QUADRANT_COLOR, type ConfettiTheme } from "../../lib/fx/themes";
import { useEffectsIntensity } from "../../lib/gamification/effects";
import { RANKS, type ChestTier, type Rarity } from "../../lib/gamification/types";
import type { QuadrantKey } from "../../types";
import { LabButton, LabDemo, LabRange, LabSelect, type LabSectionProps } from "../LabKit";

// Lab-only numbers; the real curve lives in the gamification rules module.
const xpForLevel = (level: number) => Math.round(80 + level * 24);
const rankFor = (level: number) => RANKS[Math.min(RANKS.length - 1, Math.floor(level / 10))];
const QUADRANT_XP: Record<QuadrantKey, number> = { focus: 30, plan: 25, quick: 10, later: 5 };
const QUADRANTS = ["focus", "plan", "quick", "later"] as const;
const QUADRANT_NAMES: Record<QuadrantKey, string> = { focus: "Focus", plan: "Plan", quick: "Quick", later: "Later" };

type XpState = { level: number; xp: number };

function addXp(state: XpState, amount: number): XpState {
  let { level, xp } = state;
  xp += amount;
  while (xp >= xpForLevel(level)) {
    xp -= xpForLevel(level);
    level += 1;
  }
  return { level, xp };
}

export function FxSection({ surface }: LabSectionProps) {
  return (
    <div>
      <EngineDemo surface={surface} />
      <CompletionDemo surface={surface} />
      <XpBarDemo surface={surface} />
      <LevelUpDemo surface={surface} />
      <ChestDemo surface={surface} />
      <ToastDemo surface={surface} />
      <StreakDemo surface={surface} />
      <QuadrantDemo surface={surface} />
    </div>
  );
}

// ── Particle engine ─────────────────────────────────────────────────────────

const STAGE_PRESETS = ["burst", "sparkle", "wave", "cannon", "shower"] as const satisfies readonly ParticlePreset[];

function EngineDemo({ surface }: LabSectionProps) {
  const intensity = useEffectsIntensity();
  const [preset, setPreset] = useState<(typeof STAGE_PRESETS)[number]>("burst");
  const [theme, setTheme] = useState<ConfettiTheme>("classic");
  const padRef = useRef<HTMLDivElement>(null);

  const fire = (point?: { x: number; y: number }) => {
    const pad = padRef.current;
    if (!pad) return;
    const rect = pad.getBoundingClientRect();
    if (preset === "cannon" || preset === "shower") emit(preset, viewportRect(), { intensity, theme });
    else if (preset === "wave") emit("wave", rect, { intensity, theme });
    else emit(preset, point ?? { x: rect.left + rect.width / 2, y: rect.top + rect.height * 0.6 }, { intensity, theme });
  };

  return (
    <LabDemo
      title="Particle engine"
      description="One shared canvas, pooled particles (cap 450), paused when hidden. Click the pad to fire at a point."
      surface={surface}
      height={200}
      controls={
        <>
          <LabSelect label="Preset" value={preset} options={STAGE_PRESETS} onChange={setPreset} />
          <LabSelect label="Confetti theme" value={theme} options={CONFETTI_THEMES} onChange={setTheme} />
          <LabButton primary onClick={() => fire()}>Fire</LabButton>
        </>
      }
    >
      <div
        ref={padRef}
        onClick={(event) => fire({ x: event.clientX, y: event.clientY })}
        style={{ ...fill, display: "grid", placeItems: "center", cursor: "crosshair", color: "inherit", opacity: 0.55, fontSize: 13 }}
      >
        Click anywhere here
      </div>
    </LabDemo>
  );
}

// ── Task completion ─────────────────────────────────────────────────────────

const MOCK_TASKS: ReadonlyArray<{ id: string; title: string; quadrant: QuadrantKey }> = [
  { id: "t1", title: "Ship the onboarding flow", quadrant: "focus" },
  { id: "t2", title: "Plan next quarter's roadmap", quadrant: "plan" },
  { id: "t3", title: "Reply to the design review", quadrant: "quick" },
  { id: "t4", title: "Tidy the downloads folder", quadrant: "later" },
];

function CompletionDemo({ surface }: LabSectionProps) {
  const intensity = useEffectsIntensity();
  const [theme, setTheme] = useState<ConfettiTheme>("classic");
  const [target, setTarget] = useState<"xp bar" | "none">("xp bar");
  const [done, setDone] = useState<ReadonlySet<string>>(() => new Set());
  const [xp, setXp] = useState<XpState>({ level: 6, xp: 120 });
  const barRef = useRef<HTMLDivElement>(null);

  const complete = (task: (typeof MOCK_TASKS)[number], checkbox: HTMLElement) => {
    if (done.has(task.id)) {
      setDone((current) => {
        const next = new Set(current);
        next.delete(task.id);
        return next;
      });
      return;
    }
    setDone((current) => new Set(current).add(task.id));
    const amount = QUADRANT_XP[task.quadrant];
    void celebrateCompletion({
      quadrant: task.quadrant,
      from: checkbox,
      xp: amount,
      to: target === "xp bar" ? barRef.current : null,
      intensity,
      theme,
      onArrive: () => setXp((state) => addXp(state, amount)),
    });
  };

  return (
    <LabDemo
      title="Task completion"
      description="Later sparkles, Quick and Plan burst, Focus goes big. The +XP label flies into the bar, which pulses and fills."
      surface={surface}
      height={290}
      controls={
        <>
          <LabSelect label="Target" value={target} options={["xp bar", "none"] as const} onChange={setTarget} />
          <LabSelect label="Confetti theme" value={theme} options={CONFETTI_THEMES} onChange={setTheme} />
          <LabButton onClick={() => setDone(new Set())}>Reset tasks</LabButton>
        </>
      }
    >
      <div style={{ width: "100%", padding: "18px 20px", display: "grid", gap: 16 }}>
        <XpBar ref={barRef} level={xp.level} xpInLevel={xp.xp} xpForLevel={xpForLevel(xp.level)} rank={rankFor(xp.level)} compact={surface === "sidebar"} />
        <div style={{ display: "grid", gap: 2 }}>
          {MOCK_TASKS.map((task) => (
            <MockTaskRow key={task.id} title={task.title} quadrant={task.quadrant} done={done.has(task.id)} onToggle={(checkbox) => complete(task, checkbox)} />
          ))}
        </div>
      </div>
    </LabDemo>
  );
}

function MockTaskRow({ title, quadrant, done, onToggle }: { readonly title: string; readonly quadrant: QuadrantKey; readonly done: boolean; readonly onToggle: (checkbox: HTMLElement) => void }) {
  const tone = QUADRANT_COLOR[quadrant];
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, minHeight: 36, padding: "0 8px", borderRadius: 8, background: "color-mix(in oklab, currentColor 3%, transparent)" }}>
      <button
        type="button"
        aria-pressed={done}
        aria-label={`Complete ${title}`}
        onClick={(event) => onToggle(event.currentTarget)}
        style={{ display: "grid", placeItems: "center", width: 20, height: 20, padding: 0, borderRadius: "50%", border: `1.5px solid ${done ? tone : "color-mix(in oklab, currentColor 32%, transparent)"}`, background: done ? tone : "transparent", color: done ? "#fff" : "inherit", transition: "background 160ms, border-color 160ms" }}
      >
        {done && (
          <svg viewBox="0 0 12 12" width="11" height="11" aria-hidden="true">
            <path d="M2.5 6.3l2.3 2.2 4.7-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </button>
      <span style={{ flex: 1, fontSize: 13.5, opacity: done ? 0.45 : 1, textDecoration: done ? "line-through" : "none" }}>{title}</span>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11.5, opacity: 0.7 }}>
        <span style={{ width: 7, height: 7, borderRadius: "50%", background: tone }} />
        {QUADRANT_NAMES[quadrant]} · {QUADRANT_XP[quadrant]} XP
      </span>
    </div>
  );
}

// ── XP bar ──────────────────────────────────────────────────────────────────

function XpBarDemo({ surface }: LabSectionProps) {
  const [xp, setXp] = useState<XpState>({ level: 9, xp: 250 });
  const need = xpForLevel(xp.level);
  const add = (amount: number) => setXp((state) => addXp(state, amount));

  return (
    <LabDemo
      title="XP bar"
      description="Liquid fill with a drifting wave and shimmer, count-up numbers, glowing edge past 85%, flash and reset on level-up."
      surface={surface}
      height={200}
      controls={
        <>
          <LabButton onClick={() => add(10)}>+10</LabButton>
          <LabButton onClick={() => add(30)}>+30</LabButton>
          <LabButton primary onClick={() => add(need - xp.xp + 40)}>Level up</LabButton>
          <LabRange label="Level" value={xp.level} min={1} max={120} onChange={(level) => setXp({ level, xp: Math.min(xp.xp, xpForLevel(level) - 1) })} />
          <LabButton onClick={() => setXp((state) => ({ ...state, xp: Math.round(xpForLevel(state.level) * 0.9) }))}>90%</LabButton>
        </>
      }
    >
      <div style={{ width: "100%", padding: "20px 22px", display: "grid", gap: 26 }}>
        <XpBar level={xp.level} xpInLevel={xp.xp} xpForLevel={need} rank={rankFor(xp.level)} />
        <div style={{ width: 212, justifySelf: surface === "sidebar" ? "start" : "center", padding: 10, borderRadius: 10, background: surface === "sidebar" ? "var(--sidebar-2)" : "color-mix(in oklab, currentColor 4%, transparent)" }}>
          <XpBar level={xp.level} xpInLevel={xp.xp} xpForLevel={need} rank={rankFor(xp.level)} compact />
        </div>
      </div>
    </LabDemo>
  );
}

// ── Level-up ────────────────────────────────────────────────────────────────

function LevelUpDemo({ surface }: LabSectionProps) {
  const [level, setLevel] = useState(10);
  const [jump, setJump] = useState(1);
  const [chest, setChest] = useState<ChestTier | "none">("rare");
  const [theme, setTheme] = useState<ConfettiTheme>("classic");
  const [open, setOpen] = useState(false);
  const [log, setLog] = useState("");
  const rankIsNew = Math.floor(level / 10) !== Math.floor((level - jump) / 10);
  const close = useCallback(() => setOpen(false), []);

  return (
    <LabDemo
      title="Level-up"
      description="Dim, god rays, number punch, cannons, rank reveal and chest teaser. Click, Space or Escape to skip."
      surface={surface}
      height={170}
      controls={
        <>
          <LabRange label="New level" value={level} min={2} max={100} onChange={setLevel} />
          <LabRange label="Levels gained" value={jump} min={1} max={6} onChange={setJump} />
          <LabSelect label="Chest" value={chest} options={["none", "common", "rare", "epic", "legendary"] as const} onChange={setChest} />
          <LabSelect label="Confetti theme" value={theme} options={CONFETTI_THEMES} onChange={setTheme} />
          <LabButton primary onClick={() => { setLog(""); setOpen(true); }}>Play</LabButton>
        </>
      }
    >
      <div style={{ display: "grid", gap: 10, justifyItems: "center", textAlign: "center", fontSize: 13 }}>
        <span style={{ opacity: 0.65 }}>
          Level {Math.max(1, level - jump)} → {level} · {rankFor(level)}{rankIsNew ? " (new rank)" : ""}
        </span>
        {log && <span style={{ opacity: 0.8 }}>{log}</span>}
      </div>
      <LevelUpOverlay
        open={open}
        level={level}
        fromLevel={Math.max(1, level - jump)}
        rank={rankFor(level)}
        rankIsNew={rankIsNew}
        chest={chest === "none" ? null : chest}
        chestLabel={chest === "none" ? undefined : `${chest[0].toUpperCase()}${chest.slice(1)} chest`}
        theme={theme}
        onClose={close}
        onOpenChest={() => setLog("onOpenChest() called")}
      />
    </LabDemo>
  );
}

// ── Chest opening ───────────────────────────────────────────────────────────

const CHEST_LOOT: Record<ChestTier, readonly ChestReward[]> = {
  common: [
    { id: "c1", label: "Paper crown", kind: "Pet hat", rarity: "common", icon: <IconCrown /> },
    { id: "c2", label: "Streak freeze", kind: "Consumable", rarity: "rare", icon: <IconSnow /> },
    { id: "c3", label: "Pastel confetti", kind: "Confetti", rarity: "common", icon: <IconConfetti />, duplicate: true },
  ],
  rare: [
    { id: "r1", label: "Wizard hat", kind: "Pet hat", rarity: "rare", icon: <IconCrown /> },
    { id: "r2", label: "Ocean confetti", kind: "Confetti", rarity: "rare", icon: <IconConfetti /> },
    { id: "r3", label: "Night owl", kind: "Title", rarity: "common", icon: <IconScroll />, duplicate: true },
    { id: "r4", label: "Streak freeze", kind: "Consumable", rarity: "rare", icon: <IconSnow /> },
  ],
  epic: [
    { id: "e1", label: "Nebula frame", kind: "Border", rarity: "epic", icon: <IconFrame /> },
    { id: "e2", label: "Neon confetti", kind: "Confetti", rarity: "epic", icon: <IconConfetti /> },
    { id: "e3", label: "Wizard hat", kind: "Pet hat", rarity: "rare", icon: <IconCrown />, duplicate: true },
    { id: "e4", label: "The Planner", kind: "Title", rarity: "epic", icon: <IconScroll /> },
  ],
  legendary: [
    { id: "l1", label: "Golden crown", kind: "Pet hat", rarity: "legendary", icon: <IconCrown /> },
    { id: "l2", label: "Sakura confetti", kind: "Confetti", rarity: "epic", icon: <IconConfetti /> },
    { id: "l3", label: "Aurora frame", kind: "Border", rarity: "legendary", icon: <IconFrame /> },
    { id: "l4", label: "Nebula frame", kind: "Border", rarity: "epic", icon: <IconFrame />, duplicate: true },
  ],
};

function ChestDemo({ surface }: LabSectionProps) {
  const [tier, setTier] = useState<ChestTier>("epic");
  const [theme, setTheme] = useState<ConfettiTheme>("classic");
  const [duplicates, setDuplicates] = useState<"with duplicate" | "all new">("with duplicate");
  const [run, setRun] = useState(0);
  const items = CHEST_LOOT[tier].map((item) => (duplicates === "all new" ? { ...item, duplicate: false } : item));

  return (
    <LabDemo
      title="Chest opening"
      description="Shake with rising intensity, glow in the rarity color, burst open, cards flip in. Duplicates dissolve into stardust."
      surface={surface}
      height={430}
      controls={
        <>
          <LabSelect label="Tier" value={tier} options={["common", "rare", "epic", "legendary"] as const} onChange={(value) => { setTier(value); setRun((count) => count + 1); }} />
          <LabSelect label="Items" value={duplicates} options={["with duplicate", "all new"] as const} onChange={(value) => { setDuplicates(value); setRun((count) => count + 1); }} />
          <LabSelect label="Confetti theme" value={theme} options={CONFETTI_THEMES} onChange={setTheme} />
          <LabButton primary onClick={() => setRun((count) => count + 1)}>Replay</LabButton>
        </>
      }
    >
      <div style={{ width: "100%", padding: "10px 14px 6px", display: "grid", justifyItems: "center" }}>
        <ChestOpening key={`${tier}-${run}-${duplicates}`} tier={tier} items={items} stardust={120} theme={theme} onDone={() => setRun((count) => count + 1)} collectLabel="Collect" />
      </div>
    </LabDemo>
  );
}

// ── Achievement toast ───────────────────────────────────────────────────────

const ACHIEVEMENTS: ReadonlyArray<{ title: string; description: string; rarity: Rarity; icon: ReactNode; reward: string }> = [
  { title: "First steps", description: "Complete your first task.", rarity: "common", icon: <IconCheck />, reward: "+10 XP" },
  { title: "The Planner", description: "Finish 25 Plan tasks before they became urgent.", rarity: "rare", icon: <IconScroll />, reward: "+50 XP" },
  { title: "Unbreakable", description: "Keep a 30-day streak alive.", rarity: "epic", icon: <IconFlame />, reward: "+150 XP" },
  { title: "Inbox zero, matrix zero", description: "Clear all four quadrants in one day.", rarity: "legendary", icon: <IconCrown />, reward: "+400 XP" },
];

function ToastDemo({ surface }: LabSectionProps) {
  const [rarity, setRarity] = useState<Rarity>("rare");
  const { toasts, push, dismiss, clear } = useAchievementToasts();
  const counter = useRef(0);

  const unlock = (which: Rarity) => {
    const achievement = ACHIEVEMENTS.find((item) => item.rarity === which) ?? ACHIEVEMENTS[0];
    counter.current += 1;
    push({
      id: `ach-${counter.current}`,
      title: achievement.title,
      description: achievement.description,
      rarity: which,
      icon: achievement.icon,
      reward: achievement.reward,
      eyebrow: `${which[0].toUpperCase()}${which.slice(1)} achievement`,
    });
  };

  return (
    <LabDemo
      title="Achievement toast"
      description="Slides in from the top-right (top on phones), the medallion flips in like a coin. Hover the stack to expand and pause it."
      surface={surface}
      height={150}
      controls={
        <>
          <LabSelect label="Rarity" value={rarity} options={["common", "rare", "epic", "legendary"] as const} onChange={setRarity} />
          <LabButton primary onClick={() => unlock(rarity)}>Unlock</LabButton>
          <LabButton onClick={() => (["common", "rare", "epic"] as const).forEach((which, index) => window.setTimeout(() => unlock(which), index * 450))}>Unlock three</LabButton>
          <LabButton onClick={clear}>Clear</LabButton>
        </>
      }
    >
      <span style={{ fontSize: 13, opacity: 0.6 }}>{toasts.length ? `${toasts.length} on screen` : "Toasts appear at the top-right of the window."}</span>
      <AchievementToastStack toasts={toasts} onDismiss={dismiss} dismissLabel="Dismiss" regionLabel="Achievements" />
    </LabDemo>
  );
}

// ── Streak flame ────────────────────────────────────────────────────────────

function StreakDemo({ surface }: LabSectionProps) {
  const [days, setDays] = useState(12);
  const [freeze, setFreeze] = useState<StreakFreezeState>("none");
  const [freezes, setFreezes] = useState(2);

  return (
    <LabDemo
      title="Streak flame"
      description="Grows at 1, 3, 7, 30 and 100 days; orange → hot blue → violet. A used freeze turns it to ice."
      surface={surface}
      height={250}
      controls={
        <>
          <LabRange label="Days" value={days} min={0} max={400} onChange={setDays} />
          <LabButton primary onClick={() => setDays((value) => value + 1)}>+1 day</LabButton>
          <LabSelect label="Freeze" value={freeze} options={["none", "held", "used"] as const} onChange={setFreeze} />
          <LabRange label="Freezes held" value={freezes} min={1} max={2} onChange={setFreezes} />
        </>
      }
    >
      <div style={{ display: "grid", gap: 22, justifyItems: "center", padding: "16px 12px" }}>
        <StreakFlame days={days} freeze={freeze} freezes={freezes} size={76} label={days === 1 ? "day streak" : "day streak"} />
        <div style={{ display: "flex", gap: 18, alignItems: "flex-end", flexWrap: "wrap", justifyContent: "center" }}>
          {[0, 1, 3, 7, 30, 100].map((value) => (
            <div key={value} style={{ display: "grid", justifyItems: "center", gap: 4 }}>
              <StreakFlame days={value} size={40} countPosition="inside" />
              <span style={{ fontSize: 10.5, opacity: 0.55 }}>{value}d</span>
            </div>
          ))}
          <div style={{ display: "grid", justifyItems: "center", gap: 4 }}>
            <StreakFlame days={45} size={40} countPosition="inside" freeze="used" />
            <span style={{ fontSize: 10.5, opacity: 0.55 }}>frozen</span>
          </div>
        </div>
      </div>
    </LabDemo>
  );
}

// ── Quadrant cleared ────────────────────────────────────────────────────────

const MATRIX_TASKS: Record<QuadrantKey, readonly string[]> = {
  focus: ["Fix the sync bug", "Send the invoice"],
  plan: ["Draft Q3 goals", "Book the dentist"],
  quick: ["Reply to Sam", "Approve PR"],
  later: ["Sort old photos", "Read the backlog"],
};

function QuadrantDemo({ surface }: LabSectionProps) {
  const intensity = useEffectsIntensity();
  const [theme, setTheme] = useState<ConfettiTheme>("classic");
  const [quadrant, setQuadrant] = useState<QuadrantKey>("focus");
  const [done, setDone] = useState<ReadonlySet<string>>(() => new Set());
  const panels = useRef(new Map<QuadrantKey, HTMLDivElement>());

  const clearedAfter = (next: ReadonlySet<string>, key: QuadrantKey) => MATRIX_TASKS[key].every((task) => next.has(`${key}:${task}`));

  const toggle = (key: QuadrantKey, task: string, checkbox: HTMLElement) => {
    const id = `${key}:${task}`;
    if (done.has(id)) {
      const next = new Set(done);
      next.delete(id);
      setDone(next);
      return;
    }
    const next = new Set(done).add(id);
    setDone(next);
    void celebrateCompletion({ quadrant: key, from: checkbox, xp: QUADRANT_XP[key], intensity, theme });
    const panel = panels.current.get(key);
    if (panel && clearedAfter(next, key)) window.setTimeout(() => celebrateQuadrantCleared({ element: panel, quadrant: key, intensity, theme }), 280);
  };

  const clearQuadrant = (key: QuadrantKey) => {
    const next = new Set(done);
    MATRIX_TASKS[key].forEach((task) => next.add(`${key}:${task}`));
    setDone(next);
    const panel = panels.current.get(key);
    if (panel) celebrateQuadrantCleared({ element: panel, quadrant: key, intensity, theme });
  };

  return (
    <LabDemo
      title="Quadrant cleared"
      description="Complete the last task of a quadrant, or clear it at once: a wave sweeps across it."
      surface={surface}
      height={320}
      controls={
        <>
          <LabSelect label="Quadrant" value={quadrant} options={QUADRANTS} onChange={setQuadrant} />
          <LabButton primary onClick={() => clearQuadrant(quadrant)}>Clear quadrant</LabButton>
          <LabSelect label="Confetti theme" value={theme} options={CONFETTI_THEMES} onChange={setTheme} />
          <LabButton onClick={() => setDone(new Set())}>Reset</LabButton>
        </>
      }
    >
      <div style={{ width: "100%", padding: 14, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        {QUADRANTS.map((key) => {
          const remaining = MATRIX_TASKS[key].filter((task) => !done.has(`${key}:${task}`));
          return (
            <div
              key={key}
              ref={(node) => {
                if (node) panels.current.set(key, node);
                else panels.current.delete(key);
              }}
              style={{ ...panel, boxShadow: `inset 0 2px 0 ${QUADRANT_COLOR[key]}` }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px 6px", fontSize: 13, fontWeight: 600 }}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: QUADRANT_COLOR[key] }} />
                {QUADRANT_NAMES[key]}
                <span style={{ marginLeft: "auto", fontSize: 11, opacity: 0.55, fontWeight: 500 }}>{remaining.length}</span>
              </div>
              <div style={{ display: "grid", gap: 2, padding: "0 6px 8px", minHeight: 76, alignContent: "start" }}>
                {remaining.length === 0 ? (
                  <span style={{ padding: "18px 8px", fontSize: 12, opacity: 0.5, textAlign: "center" }}>All clear</span>
                ) : (
                  MATRIX_TASKS[key].map((task) => {
                    const id = `${key}:${task}`;
                    if (done.has(id)) return null;
                    return (
                      <div key={task} style={{ display: "flex", alignItems: "center", gap: 8, minHeight: 32, padding: "0 6px" }}>
                        <button
                          type="button"
                          aria-label={`Complete ${task}`}
                          onClick={(event) => toggle(key, task, event.currentTarget)}
                          style={{ width: 18, height: 18, padding: 0, flex: "none", borderRadius: "50%", border: "1.5px solid color-mix(in oklab, currentColor 32%, transparent)", background: "transparent" }}
                        />
                        <span style={{ fontSize: 12.5 }}>{task}</span>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          );
        })}
      </div>
    </LabDemo>
  );
}

// ── Shared lab bits ─────────────────────────────────────────────────────────

const fill: CSSProperties = { position: "absolute", inset: 0 };
const panel: CSSProperties = {
  overflow: "hidden",
  borderRadius: 10,
  border: "1px solid color-mix(in oklab, currentColor 10%, transparent)",
  background: "color-mix(in oklab, currentColor 3%, transparent)",
};

function Glyph({ children }: { readonly children: ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}
function IconCrown() {
  return <Glyph><path d="M3.5 8l4 4 4.5-6 4.5 6 4-4-1.8 10H5.3z" /><path d="M5.5 20h13" /></Glyph>;
}
function IconSnow() {
  return <Glyph><path d="M12 2.5v19M3.8 7.2l16.4 9.6M3.8 16.8l16.4-9.6M9.5 4.5L12 6.5l2.5-2M9.5 19.5L12 17.5l2.5 2" /></Glyph>;
}
function IconConfetti() {
  return <Glyph><path d="M4 20l5-13 7 7z" /><path d="M14 4v2M19 9h2M17.5 5.5l-1.3 1.3M20 14l-1.5-.5M12 3l.5 1.5" /></Glyph>;
}
function IconScroll() {
  return <Glyph><path d="M7 4h11a2 2 0 012 2v1h-4M7 4a2 2 0 00-2 2v12a2 2 0 002 2h9a2 2 0 002-2V7M7 4a2 2 0 012 2v12a2 2 0 01-2 2" /><path d="M11 10h4M11 14h4" /></Glyph>;
}
function IconFrame() {
  return <Glyph><rect x="4" y="4" width="16" height="16" rx="4" /><circle cx="12" cy="10.5" r="2.5" /><path d="M8 17c1-2 2.5-3 4-3s3 1 4 3" /></Glyph>;
}
function IconCheck() {
  return <Glyph><path d="M5 12.5l4.5 4.5L19 7" /></Glyph>;
}
function IconFlame() {
  return <Glyph><path d="M12 3c1 4 5 6 5 11a5 5 0 01-10 0c0-2.5 1.5-4 2.5-5 .3 1.8 1.2 2.8 2 3-.8-3 .2-6.5.5-9z" /></Glyph>;
}
