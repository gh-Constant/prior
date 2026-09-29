// XP bar: level badge, liquid fill with a moving wave and shimmer, glowing leading edge near the
// next level, and a count-up of the numbers. The fill is painted from requestAnimationFrame through
// refs, so a tween never re-renders React.
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type Ref } from "react";
import { easeOutCubic } from "../../../lib/fx/bezier";
import { emit } from "../../../lib/fx/particles";
import { planXpSegments, segmentDuration, xpRatio } from "../../../lib/fx/xpBar";
import { useEffectsIntensity } from "../../../lib/gamification/effects";
import { XP_ARRIVE_EVENT } from "./celebrate";
import { LevelBadge } from "./LevelBadge";
import { play } from "./animate";
import "./XpBar.css";

export type XpBarProps = {
  readonly level: number;
  readonly xpInLevel: number;
  readonly xpForLevel: number;
  /** Rank name shown beside the numbers (for example "Ember"). */
  readonly rank?: string;
  /** Smaller variant for the dark sidebar. */
  readonly compact?: boolean;
  /** Unit after the numbers. */
  readonly unitLabel?: string;
  /** Accessible name of the progress bar. */
  readonly ariaLabel?: string;
  readonly className?: string;
  /** Root element; pass it as `to` to `celebrateCompletion` so labels fly into the bar. */
  readonly ref?: Ref<HTMLDivElement>;
};

type Shown = { level: number; xp: number; xpForLevel: number };

// Numbers follow the app language (set on <html lang> by the i18n provider).
const formats = new Map<string, Intl.NumberFormat>();
function formatNumber(value: number): string {
  if (typeof Intl === "undefined") return String(value);
  const locale = (typeof document !== "undefined" && document.documentElement.lang) || "en";
  let format = formats.get(locale);
  if (!format) {
    try {
      format = new Intl.NumberFormat(locale);
    } catch {
      format = new Intl.NumberFormat();
    }
    formats.set(locale, format);
  }
  return format.format(value);
}

export function XpBar({ level, xpInLevel, xpForLevel, rank, compact = false, unitLabel = "XP", ariaLabel, className, ref }: XpBarProps) {
  const intensity = useEffectsIntensity();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const fillRef = useRef<HTMLDivElement>(null);
  const railRef = useRef<HTMLDivElement>(null);
  const xpRef = useRef<HTMLElement>(null);
  const needRef = useRef<HTMLSpanElement>(null);
  const flashRef = useRef<HTMLSpanElement>(null);
  const pulseRef = useRef<HTMLSpanElement>(null);
  const badgeRef = useRef<HTMLSpanElement>(null);
  const ringRef = useRef<HTMLSpanElement>(null);
  const shown = useRef<Shown>({ level, xp: xpInLevel, xpForLevel });
  const hot = useRef<boolean | null>(null);
  const [shownLevel, setShownLevel] = useState(level);

  const setRoot = useCallback(
    (node: HTMLDivElement | null) => {
      rootRef.current = node;
      if (typeof ref === "function") ref(node);
      else if (ref) ref.current = node;
    },
    [ref],
  );

  const paint = useCallback((xp: number, need: number) => {
    const ratio = xpRatio(xp, need);
    if (fillRef.current) fillRef.current.style.transform = `translateX(${((ratio - 1) * 100).toFixed(3)}%)`;
    if (railRef.current) railRef.current.style.transform = `translateX(${(ratio * 100).toFixed(3)}%)`;
    const isHot = ratio > 0.85;
    if (isHot !== hot.current && rootRef.current) {
      hot.current = isHot;
      rootRef.current.toggleAttribute("data-hot", isHot);
    }
    if (xpRef.current) xpRef.current.textContent = formatNumber(Math.round(xp));
    if (needRef.current) needRef.current.textContent = formatNumber(need);
  }, []);

  useLayoutEffect(() => {
    paint(shown.current.xp, shown.current.xpForLevel);
  }, [paint]);

  // Tween between states, including the fill → flash → reset of a level-up.
  useEffect(() => {
    const from = shown.current;
    const target = { level, xp: xpInLevel, xpForLevel };
    if (intensity === "off") {
      shown.current = target;
      setShownLevel(level);
      paint(xpInLevel, xpForLevel);
      return;
    }
    const segments = planXpSegments({ level: from.level, xpInLevel: from.xp, xpForLevel: from.xpForLevel }, { level, xpInLevel, xpForLevel });
    let frame = 0;
    let timeout = 0;
    let cancelled = false;

    const run = (index: number) => {
      if (cancelled || index >= segments.length) return;
      const segment = segments[index];
      const duration = segmentDuration(segment, intensity === "subtle" ? 650 : 950);
      if (duration === 0) {
        shown.current = { level: segment.level, xp: segment.toXp, xpForLevel: segment.xpForLevel };
        setShownLevel(segment.level);
        paint(segment.toXp, segment.xpForLevel);
        run(index + 1);
        return;
      }
      const started = performance.now();
      const tick = (now: number) => {
        if (cancelled) return;
        const t = Math.min(1, Math.max(0, (now - started) / duration));
        const xp = segment.fromXp + (segment.toXp - segment.fromXp) * easeOutCubic(t);
        shown.current = { level: segment.level, xp, xpForLevel: segment.xpForLevel };
        paint(xp, segment.xpForLevel);
        if (t < 1) {
          frame = requestAnimationFrame(tick);
          return;
        }
        if (!segment.levelUp) {
          run(index + 1);
          return;
        }
        // Full: flash, then reset under the flash and punch the badge to the new level.
        play(flashRef.current, [{ opacity: 0 }, { opacity: 1, offset: 0.28 }, { opacity: 0 }], { duration: 620, easing: "ease-out" });
        timeout = window.setTimeout(() => {
          const next = segments[index + 1];
          if (next) {
            shown.current = { level: next.level, xp: 0, xpForLevel: next.xpForLevel };
            setShownLevel(next.level);
            paint(0, next.xpForLevel);
          }
          play(
            badgeRef.current,
            [{ transform: "scale(1)" }, { transform: "scale(1.42)", offset: 0.32 }, { transform: "scale(0.94)", offset: 0.68 }, { transform: "scale(1)" }],
            { duration: 560, easing: "cubic-bezier(0.23, 1, 0.32, 1)" },
          );
          play(ringRef.current, [{ transform: "scale(0.7)", opacity: 0.9 }, { transform: "scale(2.1)", opacity: 0 }], { duration: 620, easing: "cubic-bezier(0.23, 1, 0.32, 1)" });
          if (badgeRef.current) emit("sparkle", badgeRef.current, { intensity, count: 14, power: 1.2 });
          timeout = window.setTimeout(() => run(index + 1), 240);
        }, 170);
      };
      frame = requestAnimationFrame(tick);
    };
    run(0);
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      window.clearTimeout(timeout);
    };
  }, [level, xpInLevel, xpForLevel, intensity, paint]);

  // Pulse when a flying "+XP" label lands on the bar.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const onArrive = (event: Event) => {
      event.preventDefault();
      if (intensity === "off") return;
      play(pulseRef.current, [{ opacity: 0, transform: "scale(1)" }, { opacity: 1, transform: "scale(1)", offset: 0.2 }, { opacity: 0, transform: "scale(1.06, 1.5)" }], { duration: 650, easing: "ease-out" });
      play(badgeRef.current, [{ transform: "scale(1)" }, { transform: "scale(1.14)", offset: 0.35 }, { transform: "scale(1)" }], { duration: 380, easing: "cubic-bezier(0.23, 1, 0.32, 1)" });
    };
    root.addEventListener(XP_ARRIVE_EVENT, onArrive);
    return () => root.removeEventListener(XP_ARRIVE_EVENT, onArrive);
  }, [intensity]);

  const classes = ["fx-xpbar", compact ? "fx-xpbar-compact" : "fx-xpbar-regular", intensity !== "full" ? `fx-xpbar-${intensity}` : "", className ?? ""].filter(Boolean).join(" ");

  return (
    <div
      ref={setRoot}
      className={classes}
      role="progressbar"
      aria-label={ariaLabel ?? `Level ${level}`}
      aria-valuemin={0}
      aria-valuemax={xpForLevel}
      aria-valuenow={Math.min(xpInLevel, xpForLevel)}
      aria-valuetext={`${formatNumber(xpInLevel)} / ${formatNumber(xpForLevel)} ${unitLabel}`}
    >
      <span className="fx-xpbar-badge">
        <LevelBadge ref={badgeRef} level={shownLevel} size={compact ? 24 : 34} />
        <span ref={ringRef} className="fx-xpbar-badge-ring" />
      </span>
      <div className="fx-xpbar-body">
        <div className="fx-xpbar-meta" aria-hidden="true">
          {rank ? <span className="fx-xpbar-rank">{rank}</span> : <span />}
          <span className="fx-xpbar-count">
            <b ref={xpRef} />
            <span className="fx-xpbar-count-muted">
              {" / "}
              <span ref={needRef} />
              {unitLabel ? ` ${unitLabel}` : ""}
            </span>
          </span>
        </div>
        <div className="fx-xpbar-track">
          <span ref={pulseRef} className="fx-xpbar-pulse" />
          <div className="fx-xpbar-clip">
            <div ref={fillRef} className="fx-xpbar-fill">
              <span className="fx-xpbar-wave" />
              <span className="fx-xpbar-shimmer" />
            </div>
          </div>
          <div ref={railRef} className="fx-xpbar-rail">
            <span className="fx-xpbar-edge" data-fx-xp-anchor="" />
          </div>
          <span ref={flashRef} className="fx-xpbar-flash" />
        </div>
      </div>
    </div>
  );
}
