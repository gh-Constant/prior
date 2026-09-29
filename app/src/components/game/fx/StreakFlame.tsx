// Streak flame: flickers and grows with the streak (stages at 1, 3, 7, 30 and 100 days), shifting from
// orange to hot blue to violet. A used freeze turns it to ice; held freezes show as a small crystal badge.
import { useEffect, useId, useRef, type CSSProperties } from "react";
import { emit } from "../../../lib/fx/particles";
import { streakStage, streakVisual } from "../../../lib/fx/streak";
import { useEffectsIntensity } from "../../../lib/gamification/effects";
import { play } from "./animate";
import "./StreakFlame.css";

export type StreakFreezeState = "none" | "held" | "used";

export type StreakFlameProps = {
  readonly days: number;
  /** "used": a freeze saved the streak (icy flame). "held": freezes in stock (crystal badge). */
  readonly freeze?: StreakFreezeState;
  /** Freezes held, shown on the badge when more than one. */
  readonly freezes?: number;
  /** Flame height in px. */
  readonly size?: number;
  readonly countPosition?: "beside" | "inside" | "none";
  /** Caption under the number when beside, for example "day streak". */
  readonly label?: string;
  readonly ariaLabel?: string;
  readonly className?: string;
};

const OUTER = "M32 4C35 14 44 20 48 30C52 40 53 48 51 56C48 67 41 74 32 74C23 74 15.5 67 13.5 57C11.5 47 15 38 20 31C21 38 24 42 27.5 43C25 33 27 17 32 4Z";
const MIDDLE = "M33 22C35 31 41 36 43.5 44.5C45.5 53 42.5 62 36 66C33 68 30 68 27.5 66.5C21.5 63 20 56 22.2 49.5C23.8 45 27 42 28 37C30 42.5 31.5 44.5 33 45C31.5 38 31.4 30 33 22Z";
const CORE = "M32.5 45C34.8 50.5 38.5 53.5 38.5 59C38.5 64 35.7 67.5 32 67.5C28.3 67.5 25.8 64.2 26.2 60C26.7 55.5 30.4 51.5 32.5 45Z";
const TONGUE_LEFT = "M15.5 39C17.5 45.5 19.6 50.5 17.6 57.5C13.2 55.4 10.8 51.2 11.3 46.8C11.7 43.4 13.5 41 15.5 39Z";
const TONGUE_RIGHT = "M48.5 39C46.5 45.5 44.4 50.5 46.4 57.5C50.8 55.4 53.2 51.2 52.7 46.8C52.3 43.4 50.5 41 48.5 39Z";
const CRYSTALS = [
  "M9 74L11.5 60L14.5 57L16 61L14 74Z",
  "M50 74L49 62L51.5 55.5L55 59.5L54.5 74Z",
  "M18.5 74L20 66.5L22 64.5L23.5 67L22.5 74Z",
  "M42 74L41.5 67L43.5 64L45.5 67.5L45 74Z",
];

export function StreakFlame({ days, freeze = "none", freezes = 0, size = 56, countPosition = "beside", label, ariaLabel, className }: StreakFlameProps) {
  const intensity = useEffectsIntensity();
  const id = useId().replace(/:/g, "");
  const frozen = freeze === "used";
  const visual = streakVisual(days, frozen);
  const { palette } = visual;
  const flameRef = useRef<HTMLSpanElement>(null);
  const countRef = useRef<HTMLSpanElement>(null);
  const previous = useRef(days);
  const url = (name: string) => `url(#${id}-${name})`;
  const scale = visual.scale;
  const embers = intensity === "full" ? visual.embers : intensity === "subtle" ? Math.floor(visual.embers / 2) : 0;
  const flicker = visual.flicker * (intensity === "subtle" ? 1.6 : 1);

  // Flare up when the streak grows; a stage change gets a bigger flare.
  useEffect(() => {
    const before = previous.current;
    previous.current = days;
    if (days <= before || intensity === "off" || frozen) return;
    const promoted = streakStage(days) !== streakStage(before);
    play(
      flameRef.current,
      [{ transform: "scale(1)" }, { transform: `scale(${promoted ? 1.32 : 1.18}, ${promoted ? 1.42 : 1.26})`, offset: 0.3 }, { transform: "scale(0.94, 0.9)", offset: 0.62 }, { transform: "scale(1)" }],
      { duration: promoted ? 760 : 560, easing: "cubic-bezier(0.23, 1, 0.32, 1)" },
    );
    play(countRef.current, [{ transform: "scale(1)" }, { transform: "scale(1.3)", offset: 0.35 }, { transform: "scale(1)" }], { duration: 480, easing: "cubic-bezier(0.23, 1, 0.32, 1)" });
    if (flameRef.current) {
      emit("sparkle", flameRef.current, { intensity, colors: [palette.ember, palette.middle[0], palette.outer[1]], count: promoted ? 26 : 12, power: promoted ? 1.4 : 0.9 });
    }
  }, [days, intensity, frozen, palette]);

  const classes = ["fx-streak", `fx-streak-${visual.stage}`, frozen ? "is-frozen" : "", intensity === "off" ? "is-static" : "", `is-count-${countPosition}`, className ?? ""].filter(Boolean).join(" ");
  const style = { "--flame-size": `${size}px`, "--flicker": `${flicker}s`, "--ember": palette.ember } as CSSProperties;

  return (
    <span className={classes} style={style} role="img" aria-label={ariaLabel ?? `${days}-day streak`}>
      <span ref={flameRef} className="fx-streak-flame">
        <svg viewBox="0 0 64 80" aria-hidden="true">
          <defs>
            <radialGradient id={`${id}-glow`} cx="0.5" cy="0.62" r="0.5">
              <stop offset="0" stopColor={palette.glow} />
              <stop offset="1" stopColor={palette.glow} stopOpacity="0" />
            </radialGradient>
            <linearGradient id={`${id}-outer`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor={palette.outer[0]} />
              <stop offset="1" stopColor={palette.outer[1]} />
            </linearGradient>
            <linearGradient id={`${id}-middle`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor={palette.middle[0]} />
              <stop offset="1" stopColor={palette.middle[1]} />
            </linearGradient>
            <radialGradient id={`${id}-core`} cx="0.5" cy="0.7" r="0.6">
              <stop offset="0" stopColor="#ffffff" />
              <stop offset="1" stopColor={palette.core} />
            </radialGradient>
          </defs>
          <ellipse className="fx-streak-glow" cx="32" cy="52" rx="31" ry="30" fill={url("glow")} />
          <g transform={`translate(32 74) scale(${scale}) translate(-32 -74)`}>
            {visual.tongues > 0 && <path className="fx-streak-tongue fx-streak-tongue-left" d={TONGUE_LEFT} fill={url("outer")} />}
            {visual.tongues > 1 && <path className="fx-streak-tongue fx-streak-tongue-right" d={TONGUE_RIGHT} fill={url("outer")} />}
            <path className="fx-streak-outer" d={OUTER} fill={url("outer")} />
            <path className="fx-streak-middle" d={MIDDLE} fill={url("middle")} />
            <path className="fx-streak-core" d={CORE} fill={url("core")} />
            {visual.stage === "cold" && <path d={OUTER} fill="none" stroke="#9d9a93" strokeOpacity="0.5" strokeWidth="1.5" strokeDasharray="3 3" />}
          </g>
          {frozen && (
            <g className="fx-streak-ice">
              {CRYSTALS.map((d) => (
                <path key={d} d={d} fill="#eaf7ff" stroke="#7cc0f0" strokeWidth="1" strokeLinejoin="round" />
              ))}
              <path d="M22 30l2 -4 2 4 -2 4z M44 22l1.5 -3 1.5 3 -1.5 3z M40 46l1.2 -2.4 1.2 2.4 -1.2 2.4z" fill="#ffffff" />
            </g>
          )}
        </svg>
        {embers > 0 && (
          <span className="fx-streak-embers" aria-hidden="true">
            {Array.from({ length: embers }, (_, index) => (
              <span key={index} style={{ "--i": index, "--x": `${((index * 37) % 100) / 100}` } as CSSProperties} />
            ))}
          </span>
        )}
        {freeze === "held" && (
          <span className="fx-streak-freeze-badge" aria-hidden="true">
            <svg viewBox="0 0 16 16">
              <path d="M8 1v14M1.9 4.5l12.2 7M1.9 11.5l12.2-7M6 2.5L8 4l2-1.5M6 13.5L8 12l2 1.5" />
            </svg>
            {freezes > 1 && <b>{freezes}</b>}
          </span>
        )}
        {countPosition === "inside" && (
          <span ref={countRef} className="fx-streak-count-inside" aria-hidden="true">{days}</span>
        )}
      </span>
      {countPosition === "beside" && (
        <span className="fx-streak-side" aria-hidden="true">
          <span ref={countRef} className="fx-streak-count">{days}</span>
          {label && <span className="fx-streak-label">{label}</span>}
        </span>
      )}
    </span>
  );
}
