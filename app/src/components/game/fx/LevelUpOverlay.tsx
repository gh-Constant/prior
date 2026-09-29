// Full-screen level-up moment (~2.5 s): dim, light burst and god rays, the level counting up with a
// punch, confetti cannons, the rank reveal, then an optional chest teaser. Skippable; accessible.
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { emit, viewportRect } from "../../../lib/fx/particles";
import { rarityPalette, type ConfettiTheme } from "../../../lib/fx/themes";
import { useEffectsIntensity } from "../../../lib/gamification/effects";
import type { ChestTier } from "../../../lib/gamification/types";
import { ChestSvg } from "./ChestSvg";
import { LevelBadge } from "./LevelBadge";
import "./LevelUpOverlay.css";

export type LevelUpOverlayProps = {
  readonly open: boolean;
  /** The level just reached. */
  readonly level: number;
  /** The level before; defaults to `level - 1`. Several levels count up. */
  readonly fromLevel?: number;
  readonly rank?: string;
  /** The rank changed with this level (every tenth level). */
  readonly rankIsNew?: boolean;
  /** A chest earned with this level: shows the teaser and waits for the user. */
  readonly chest?: ChestTier | null;
  readonly theme?: ConfettiTheme;
  readonly title?: string;
  readonly newRankLabel?: string;
  readonly rankLabel?: string;
  readonly chestTitle?: string;
  /** Chest description, for example "Rare chest". */
  readonly chestLabel?: string;
  readonly openChestLabel?: string;
  readonly laterLabel?: string;
  readonly skipHint?: string;
  /** Screen-reader announcement; defaults to "Level N reached. Rank." */
  readonly announcement?: string;
  readonly onClose: () => void;
  readonly onOpenChest?: () => void;
};

/** Phase start times in ms (full intensity). */
const TIMELINE = { count: 320, punch: 600, rank: 980, chest: 1520, done: 1900 } as const;
const AUTO_CLOSE_MS = 2500;
const LEAVE_MS = 240;

type Phase = 0 | 1 | 2 | 3 | 4 | 5;
const PHASE_INTRO: Phase = 0;
const PHASE_COUNT: Phase = 1;
const PHASE_PUNCH: Phase = 2;
const PHASE_RANK: Phase = 3;
const PHASE_CHEST: Phase = 4;
const PHASE_DONE: Phase = 5;

export function LevelUpOverlay(props: LevelUpOverlayProps) {
  if (!props.open || typeof document === "undefined") return null;
  return createPortal(<LevelUpMoment {...props} />, document.body);
}

function LevelUpMoment({
  level,
  fromLevel,
  rank,
  rankIsNew = false,
  chest = null,
  theme,
  title = "Level up!",
  newRankLabel = "New rank",
  rankLabel = "Rank",
  chestTitle = "Chest earned",
  chestLabel,
  openChestLabel = "Open chest",
  laterLabel = "Later",
  skipHint = "Click or press Space to skip",
  announcement,
  onClose,
  onOpenChest,
}: LevelUpOverlayProps) {
  const intensity = useEffectsIntensity();
  const animated = intensity !== "off";
  const start = Math.max(1, Math.min(level - 1, fromLevel ?? level - 1));
  const [phase, setPhase] = useState<Phase>(animated ? PHASE_INTRO : PHASE_DONE);
  const [shownLevel, setShownLevel] = useState(animated ? start : level);
  const [leaving, setLeaving] = useState(false);
  const [announce, setAnnounce] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const chestButtonRef = useRef<HTMLButtonElement>(null);
  const firedRef = useRef(false);
  const titleId = useId();
  const liveId = useId();

  const close = useCallback(() => {
    if (leaving) return;
    if (!animated) {
      onClose();
      return;
    }
    setLeaving(true);
  }, [animated, leaving, onClose]);

  useEffect(() => {
    if (!leaving) return;
    const timeout = window.setTimeout(onClose, LEAVE_MS);
    return () => window.clearTimeout(timeout);
  }, [leaving, onClose]);

  const celebrate = useCallback(() => {
    if (firedRef.current) return;
    firedRef.current = true;
    const screen = viewportRect();
    emit("cannon", screen, { intensity, theme });
    const emblem = rootRef.current?.querySelector(".fx-lvl-emblem");
    if (emblem) {
      emit("burst", emblem, { intensity, theme, count: 46, power: 1.25 });
      emit("sparkle", emblem, { intensity, theme, count: 18, power: 1.6 });
    }
  }, [intensity, theme]);

  // Timeline.
  useEffect(() => {
    if (!animated) return;
    const timers: number[] = [];
    const at = (ms: number, fn: () => void) => timers.push(window.setTimeout(fn, ms));
    at(TIMELINE.count, () => setPhase(PHASE_COUNT));
    const steps = level - start;
    if (steps > 1) {
      const span = TIMELINE.punch - TIMELINE.count - 40;
      const count = Math.min(steps - 1, 12);
      for (let index = 1; index <= count; index += 1) {
        const value = start + Math.round((index / (count + 1)) * steps);
        at(TIMELINE.count + (span * index) / (count + 1), () => setShownLevel(value));
      }
    }
    at(TIMELINE.punch, () => {
      setShownLevel(level);
      setPhase(PHASE_PUNCH);
      celebrate();
    });
    if (rank) at(TIMELINE.rank, () => setPhase(PHASE_RANK));
    if (chest) at(TIMELINE.chest, () => setPhase(PHASE_CHEST));
    at(chest ? TIMELINE.done + 300 : TIMELINE.done, () => setPhase(PHASE_DONE));
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [animated, level, start, rank, chest, celebrate]);

  // Auto-close when there is nothing left to act on.
  useEffect(() => {
    if (chest) return;
    const timeout = window.setTimeout(close, animated ? AUTO_CLOSE_MS : 4000);
    return () => window.clearTimeout(timeout);
  }, [chest, animated, close]);

  // Announce after mount so screen readers pick up the change.
  useEffect(() => {
    const text = announcement ?? `Level ${level} reached${rank ? `. ${rank}` : ""}.`;
    const timeout = window.setTimeout(() => setAnnounce(text), 60);
    return () => window.clearTimeout(timeout);
  }, [announcement, level, rank]);

  // Focus in on open, back out on close.
  useLayoutEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    rootRef.current?.focus({ preventScroll: true });
    return () => {
      if (previous && previous.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);

  useEffect(() => {
    if (chest && phase >= PHASE_CHEST) chestButtonRef.current?.focus({ preventScroll: true });
  }, [chest, phase]);

  const skip = useCallback(() => {
    if (!chest || phase >= PHASE_CHEST) {
      close();
      return;
    }
    setShownLevel(level);
    setPhase(PHASE_DONE);
    celebrate();
  }, [chest, phase, close, level, celebrate]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        return;
      }
      const onButton = event.target instanceof HTMLElement && event.target.closest("button");
      if ((event.key === " " || event.key === "Enter") && !onButton) {
        event.preventDefault();
        skip();
        return;
      }
      if (event.key === "Tab" && rootRef.current) {
        const focusable = Array.from(rootRef.current.querySelectorAll<HTMLElement>("button:not([disabled])"));
        if (focusable.length === 0) {
          event.preventDefault();
          return;
        }
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && (document.activeElement === first || document.activeElement === rootRef.current)) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [close, skip]);

  const phaseClasses = Array.from({ length: phase }, (_, index) => `fx-lvl-p${index + 1}`);
  const classes = ["fx-lvl", `fx-lvl-${intensity}`, ...phaseClasses, leaving ? "is-leaving" : "", rankIsNew ? "has-new-rank" : ""].filter(Boolean).join(" ");
  const badgeSize = intensity === "full" ? 132 : 84;

  return (
    <div
      ref={rootRef}
      className={classes}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={liveId}
      tabIndex={-1}
      onClick={(event) => {
        if (!(event.target instanceof HTMLElement && event.target.closest("button"))) skip();
      }}
    >
      <div className="fx-lvl-backdrop" />
      <div className="fx-lvl-stage">
        <div className="fx-lvl-card">
          <p className="fx-lvl-title" id={titleId}>{title}</p>
          <div className="fx-lvl-emblem">
            {intensity === "full" && <span className="fx-lvl-rays" />}
            <span className="fx-lvl-glow" />
            <span className="fx-lvl-flash" />
            <span className="fx-lvl-shock" />
            <span key={shownLevel} className={`fx-lvl-number${shownLevel === level ? " is-final" : ""}`}>
              <LevelBadge level={shownLevel} size={badgeSize} />
            </span>
          </div>
          {rank && (
            <div className="fx-lvl-rank">
              <span className="fx-lvl-rank-eyebrow">{rankIsNew ? newRankLabel : rankLabel}</span>
              <strong className="fx-lvl-rank-name">{rank}</strong>
            </div>
          )}
          {chest && (
            <div className={`fx-lvl-chest fx-lvl-chest-${chest}`}>
              <span className="fx-lvl-chest-art">
                <ChestSvg tier={chest} />
              </span>
              <span className="fx-lvl-chest-text">
                <strong>{chestTitle}</strong>
                {chestLabel && <span>{chestLabel}</span>}
              </span>
              <span className="fx-lvl-chest-actions">
                <button type="button" className="fx-lvl-button fx-lvl-button-ghost" onClick={close}>{laterLabel}</button>
                <button
                  ref={chestButtonRef}
                  type="button"
                  className="fx-lvl-button"
                  onClick={() => {
                    if (animated) emit("sparkle", chestButtonRef.current ?? viewportRect(), { intensity, colors: rarityPalette(chest), count: 14 });
                    onOpenChest?.();
                    close();
                  }}
                >
                  {openChestLabel}
                </button>
              </span>
            </div>
          )}
          {animated && <p className="fx-lvl-hint">{skipHint}</p>}
        </div>
      </div>
      <p id={liveId} className="fx-sr-only" aria-live="assertive">{announce}</p>
    </div>
  );
}
