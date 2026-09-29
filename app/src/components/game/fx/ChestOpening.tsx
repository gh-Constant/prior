// Chest opening: shake with rising intensity → glow in the rarity color → the lid bursts open with
// light rays and particles → item cards flip in one by one. Duplicates dissolve into stardust that
// flies into the stardust counter.
import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { emit } from "../../../lib/fx/particles";
import { rarityPalette, type ConfettiTheme } from "../../../lib/fx/themes";
import { useEffectsIntensity } from "../../../lib/gamification/effects";
import type { ChestTier, Rarity } from "../../../lib/gamification/types";
import { ChestSvg } from "./ChestSvg";
import { play } from "./animate";
import "./rarity.css";
import "./ChestOpening.css";

export type ChestReward = {
  readonly id: string;
  readonly label: string;
  readonly rarity: Rarity;
  readonly icon: ReactNode;
  /** Already owned: the card dissolves into stardust. */
  readonly duplicate?: boolean;
  /** Stardust granted for a duplicate; defaults by rarity. */
  readonly stardust?: number;
  /** Small caption such as "Pet hat". */
  readonly kind?: string;
};

export const DUPLICATE_STARDUST: Readonly<Record<Rarity, number>> = { common: 5, rare: 15, epic: 40, legendary: 100 };

const DEFAULT_RARITY_LABELS: Readonly<Record<Rarity, string>> = { common: "Common", rare: "Rare", epic: "Epic", legendary: "Legendary" };

export type ChestOpeningProps = {
  readonly tier: ChestTier;
  readonly items: readonly ChestReward[];
  /** Stardust balance before opening. */
  readonly stardust?: number;
  readonly theme?: ConfettiTheme;
  /** Start shaking as soon as it mounts. */
  readonly autoOpen?: boolean;
  readonly openLabel?: string;
  /** Accessible name of the chest button. */
  readonly chestLabel?: string;
  readonly duplicateLabel?: string;
  readonly stardustLabel?: string;
  readonly collectLabel?: string;
  readonly rarityLabels?: Readonly<Record<Rarity, string>>;
  readonly onOpened?: () => void;
  readonly onStardust?: (total: number) => void;
  readonly onDone?: () => void;
  readonly className?: string;
};

type Phase = "idle" | "shaking" | "open" | "done";

const SHAKE_MS = 1350;
const FIRST_CARD_MS = 420;
const CARD_GAP_MS = 280;
const FLIP_MS = 640;
const DUST_HOLD_MS = 650;
const DUST_FLIGHT_MS = 1150;

/** Three bursts of shaking, each stronger, ending in a squash before the burst. */
function shakeKeyframes(amplitude: number): Keyframe[] {
  const r = (deg: number, y = 0, s = 1) => ({ transform: `translateY(${y}px) rotate(${deg * amplitude}deg) scale(${s})` });
  return [
    { offset: 0, ...r(0) },
    { offset: 0.05, ...r(-3) },
    { offset: 0.1, ...r(3) },
    { offset: 0.15, ...r(-2) },
    { offset: 0.2, ...r(0) },
    { offset: 0.34, ...r(0, 0, 1.01) },
    { offset: 0.38, ...r(-6, -3, 1.02) },
    { offset: 0.42, ...r(6, -3, 1.02) },
    { offset: 0.46, ...r(-5, -2, 1.02) },
    { offset: 0.5, ...r(4, -1, 1.02) },
    { offset: 0.55, ...r(0, 0, 1.02) },
    { offset: 0.64, ...r(0, 0, 1.03) },
    { offset: 0.67, ...r(-9, -6, 1.05) },
    { offset: 0.7, ...r(9, -6, 1.05) },
    { offset: 0.73, ...r(-9, -7, 1.06) },
    { offset: 0.76, ...r(8, -7, 1.06) },
    { offset: 0.79, ...r(-8, -6, 1.06) },
    { offset: 0.82, ...r(7, -5, 1.06) },
    { offset: 0.85, ...r(-5, -3, 1.05) },
    { offset: 0.9, transform: "translateY(2px) rotate(0deg) scale(1.1, 0.9)" },
    { offset: 1, transform: "translateY(3px) rotate(0deg) scale(1.14, 0.86)" },
  ];
}

export function ChestOpening({
  tier,
  items,
  stardust = 0,
  theme,
  autoOpen = false,
  openLabel = "Tap to open",
  chestLabel = "Open chest",
  duplicateLabel = "Duplicate",
  stardustLabel = "Stardust",
  collectLabel = "Collect",
  rarityLabels = DEFAULT_RARITY_LABELS,
  onOpened,
  onStardust,
  onDone,
  className,
}: ChestOpeningProps) {
  const intensity = useEffectsIntensity();
  const animated = intensity !== "off";
  const [phase, setPhase] = useState<Phase>("idle");
  const [revealed, setRevealed] = useState(0);
  const [dissolved, setDissolved] = useState<ReadonlySet<string>>(() => new Set());
  const [dustTotal, setDustTotal] = useState(stardust);
  const chestRef = useRef<HTMLButtonElement>(null);
  const counterRef = useRef<HTMLSpanElement>(null);
  const counterNumberRef = useRef<HTMLElement>(null);
  const cardRefs = useRef(new Map<string, HTMLLIElement>());
  const timers = useRef<number[]>([]);
  const frames = useRef<number[]>([]);
  const shownDust = useRef(stardust);
  const shakeRef = useRef<Animation | null>(null);

  const later = useCallback((ms: number, fn: () => void) => {
    timers.current.push(window.setTimeout(fn, ms));
  }, []);

  useEffect(
    () => () => {
      timers.current.forEach((timer) => window.clearTimeout(timer));
      frames.current.forEach((frame) => cancelAnimationFrame(frame));
      timers.current = [];
      frames.current = [];
    },
    [],
  );

  // Count the stardust display up to its new total.
  const countDustTo = useCallback(
    (total: number) => {
      const from = shownDust.current;
      shownDust.current = total;
      const node = counterNumberRef.current;
      if (!node) return;
      if (!animated) {
        node.textContent = String(total);
        return;
      }
      const started = performance.now();
      const tick = (now: number) => {
        const t = Math.min(1, Math.max(0, (now - started) / 600));
        node.textContent = String(Math.round(from + (total - from) * (1 - (1 - t) ** 3)));
        if (t < 1) frames.current.push(requestAnimationFrame(tick));
      };
      frames.current.push(requestAnimationFrame(tick));
      play(counterRef.current, [{ transform: "scale(1)" }, { transform: "scale(1.16)", offset: 0.3 }, { transform: "scale(1)" }], { duration: 480, easing: "cubic-bezier(0.23, 1, 0.32, 1)" });
    },
    [animated],
  );

  useEffect(() => {
    if (counterNumberRef.current) counterNumberRef.current.textContent = String(shownDust.current);
  }, []);

  const burst = useCallback(() => {
    const chest = chestRef.current;
    if (!chest) return;
    shakeRef.current?.cancel();
    shakeRef.current = null;
    const colors = rarityPalette(tier);
    const big = tier === "legendary" ? 1.3 : tier === "epic" ? 1.15 : 1;
    emit("burst", chest, { intensity, theme, colors: theme && theme !== "classic" ? undefined : colors, count: Math.round(70 * big), power: 1.1 * big });
    emit("sparkle", chest, { intensity, colors, count: tier === "common" ? 12 : 24, power: 1.8 });
    play(
      chest,
      [{ transform: "translateY(3px) scale(1.14, 0.86)" }, { transform: "translateY(-6px) scale(0.94, 1.08)", offset: 0.35 }, { transform: "translateY(0) scale(1.02, 0.98)", offset: 0.7 }, { transform: "none" }],
      { duration: 520, easing: "cubic-bezier(0.23, 1, 0.32, 1)" },
    );
  }, [intensity, theme, tier]);

  const scheduleReveal = useCallback(
    (startMs: number) => {
      let dustDelay = 0;
      let dust = shownDust.current;
      items.forEach((item, index) => {
        const at = startMs + index * CARD_GAP_MS;
        later(at, () => {
          setRevealed((count) => Math.max(count, index + 1));
          const card = cardRefs.current.get(item.id);
          if (card && animated) {
            later(FLIP_MS * 0.55, () => emit("sparkle", card, { intensity, colors: rarityPalette(item.rarity), count: item.rarity === "legendary" ? 20 : item.rarity === "epic" ? 14 : 8, power: 1.1 }));
          }
        });
        if (!item.duplicate) return;
        const amount = item.stardust ?? DUPLICATE_STARDUST[item.rarity];
        dust += amount;
        const total = dust;
        const dissolveAt = Math.max(at + FLIP_MS + DUST_HOLD_MS, dustDelay);
        dustDelay = dissolveAt + 260;
        later(dissolveAt, () => {
          setDissolved((current) => new Set(current).add(item.id));
          const card = cardRefs.current.get(item.id);
          if (card && counterRef.current) emit("stardust", card, { intensity, target: counterRef.current, count: 22 });
          later(DUST_FLIGHT_MS * 0.8, () => {
            setDustTotal(total);
            countDustTo(total);
            onStardust?.(total);
          });
        });
      });
      const last = startMs + Math.max(0, items.length - 1) * CARD_GAP_MS + FLIP_MS;
      later(Math.max(last, dustDelay + DUST_FLIGHT_MS * 0.8) + 200, () => setPhase("done"));
    },
    [animated, countDustTo, intensity, items, later, onStardust],
  );

  const open = useCallback(() => {
    if (phase !== "idle") return;
    if (!animated) {
      setPhase("open");
      onOpened?.();
      setRevealed(items.length);
      const duplicates = items.filter((item) => item.duplicate);
      const total = duplicates.reduce((sum, item) => sum + (item.stardust ?? DUPLICATE_STARDUST[item.rarity]), shownDust.current);
      setDissolved(new Set(duplicates.map((item) => item.id)));
      setDustTotal(total);
      countDustTo(total);
      if (duplicates.length > 0) onStardust?.(total);
      setPhase("done");
      return;
    }
    setPhase("shaking");
    const chest = chestRef.current;
    const amplitude = intensity === "subtle" ? 0.55 : 1;
    const duration = intensity === "subtle" ? SHAKE_MS * 0.75 : SHAKE_MS;
    shakeRef.current = play(chest, shakeKeyframes(amplitude), { duration, easing: "linear", fill: "forwards" });
    const glints = rarityPalette(tier);
    [0.02, 0.36, 0.66].forEach((offset, index) => {
      later(duration * offset, () => {
        if (chest) emit("sparkle", chest, { intensity, colors: glints, count: 5 + index * 4, power: 0.7 + index * 0.35 });
      });
    });
    later(duration, () => {
      setPhase("open");
      burst();
      onOpened?.();
      scheduleReveal(FIRST_CARD_MS);
    });
  }, [animated, burst, countDustTo, intensity, items, later, onOpened, onStardust, phase, scheduleReveal, tier]);

  useEffect(() => {
    if (!autoOpen) return;
    const timeout = window.setTimeout(open, 350);
    return () => window.clearTimeout(timeout);
    // Only on mount: `open` changes identity as the phase moves on.
  }, []);

  const classes = ["fx-chestopen", `fx-rarity-${tier}`, `is-${phase}`, `fx-chestopen-${intensity}`, className ?? ""].filter(Boolean).join(" ");

  return (
    <div className={classes}>
      <div className="fx-chestopen-bar">
        <span ref={counterRef} className="fx-stardust" aria-live="polite" aria-label={`${stardustLabel}: ${dustTotal}`}>
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M8 0.5C8.6 5 11 7.4 15.5 8C11 8.6 8.6 11 8 15.5C7.4 11 5 8.6 0.5 8C5 7.4 7.4 5 8 0.5Z" />
          </svg>
          <b ref={counterNumberRef} aria-hidden="true" />
          <span aria-hidden="true">{stardustLabel}</span>
        </span>
      </div>
      <div className="fx-chestopen-stage">
        <span className="fx-chestopen-rays" aria-hidden="true" />
        <span className="fx-chestopen-glow" aria-hidden="true" />
        <button ref={chestRef} type="button" className="fx-chestopen-chest" onClick={open} disabled={phase !== "idle"} aria-label={chestLabel}>
          <ChestSvg tier={tier} open={phase === "open" || phase === "done"} />
        </button>
        <span className="fx-chestopen-hint" aria-hidden={phase !== "idle"}>{openLabel}</span>
      </div>
      <ul className="fx-chestopen-cards" aria-live="polite">
        {items.map((item, index) => {
          const isRevealed = index < revealed;
          const isDust = dissolved.has(item.id);
          const amount = item.stardust ?? DUPLICATE_STARDUST[item.rarity];
          return (
            <li
              key={item.id}
              ref={(node) => {
                if (node) cardRefs.current.set(item.id, node);
                else cardRefs.current.delete(item.id);
              }}
              className={`fx-card fx-rarity-${item.rarity}${isRevealed ? " is-revealed" : ""}${item.duplicate ? " is-duplicate" : ""}${isDust ? " is-dust" : ""}`}
              style={{ "--fx-card-index": index } as CSSProperties}
              aria-hidden={!isRevealed}
            >
              <div className="fx-card-inner">
                <div className="fx-card-face fx-card-back" />
                <div className="fx-card-face fx-card-front">
                  <span className="fx-card-icon">{item.icon}</span>
                  <span className="fx-card-label">{item.label}</span>
                  {item.kind && <span className="fx-card-kind">{item.kind}</span>}
                  <span className="fx-card-rarity">{rarityLabels[item.rarity]}</span>
                  {item.duplicate && <span className="fx-card-dup">{duplicateLabel}</span>}
                </div>
              </div>
              {item.duplicate && (
                <span className="fx-card-dust">
                  <svg viewBox="0 0 16 16" aria-hidden="true">
                    <path d="M8 0.5C8.6 5 11 7.4 15.5 8C11 8.6 8.6 11 8 15.5C7.4 11 5 8.6 0.5 8C5 7.4 7.4 5 8 0.5Z" />
                  </svg>
                  +{amount}
                </span>
              )}
            </li>
          );
        })}
      </ul>
      <div className="fx-chestopen-footer">
        {phase === "done" && onDone && (
          <button type="button" className="fx-chestopen-collect" onClick={onDone}>{collectLabel}</button>
        )}
      </div>
    </div>
  );
}
