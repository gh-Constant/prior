// Achievement medallion: rarity decides the rim (round → scalloped → octagonal
// with gems → gold starburst). Locked badges turn grey with a progress ring.
import { useId, type CSSProperties, type ReactNode } from "react";
import type { EffectsIntensity, Rarity } from "../../../lib/gamification/types";
import { Icon, type IconName } from "../../Icon";
import { polar } from "./frames";
import { Stops } from "./svg";
import { cx, identityClass, useIdentityFx, useIdentityTone, type IdentityTone } from "./tone";
import "./AchievementBadge.css";

export type AchievementBadgeProps = {
  readonly icon: IconName;
  readonly rarity?: Rarity;
  /** Accessible name, e.g. "Unbreakable — 30-day streak". */
  readonly label: string;
  readonly locked?: boolean;
  /** 0–1 progress toward unlocking, drawn as a ring on locked badges. */
  readonly progress?: number;
  /** Short progress text under a locked badge, e.g. "12/30". */
  readonly progressLabel?: string;
  /** px, default 64. */
  readonly size?: number;
  /** Optional caption rendered under the medallion. */
  readonly caption?: ReactNode;
  readonly tone?: IdentityTone;
  readonly intensity?: EffectsIntensity;
  readonly className?: string;
};

type Palette = { readonly rim: readonly string[]; readonly disc: readonly string[]; readonly edge: string };

const PALETTES: Readonly<Record<Rarity, Palette>> = {
  common: { rim: ["#f1efea", "#a8a49b", "#dedbd4", "#8e8a81"], disc: ["#a3aeb9", "#6b7885", "#434e5a"], edge: "#5d5a54" },
  rare: { rim: ["#d6e6ff", "#5b95f5", "#1f4fbf", "#9cc4ff"], disc: ["#6aa8ff", "#2459d8", "#132f7c"], edge: "#123174" },
  epic: { rim: ["#f5e1ff", "#b36ef5", "#6b21c8", "#dcb2ff"], disc: ["#d69bff", "#8b2fd9", "#3c1070"], edge: "#3b0f6e" },
  legendary: { rim: ["#fff4c7", "#f6c445", "#b77a05", "#ffe08a"], disc: ["#ffd76a", "#f08a0b", "#8a3c00"], edge: "#6e3a00" },
};

const CENTER = 32;

function starPoints(points: number, outer: number, inner: number, offset = 0): string {
  const coordinates: string[] = [];
  for (let index = 0; index < points * 2; index += 1) {
    const radius = index % 2 === 0 ? outer : inner;
    const [x, y] = polar(radius, offset + (index * 180) / points);
    coordinates.push(`${(x - 50 + CENTER).toFixed(2)},${(y - 50 + CENTER).toFixed(2)}`);
  }
  return coordinates.join(" ");
}

function at(radius: number, degrees: number): readonly [number, number] {
  const [x, y] = polar(radius, degrees);
  return [x - 50 + CENTER, y - 50 + CENTER];
}

export function AchievementBadge({
  icon,
  rarity = "common",
  label,
  locked = false,
  progress,
  progressLabel,
  size = 64,
  caption,
  tone,
  intensity,
  className,
}: AchievementBadgeProps) {
  const resolvedTone = useIdentityTone(tone);
  const fx = useIdentityFx(intensity);
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const id = (name: string) => `${uid}-${name}`;
  const url = (name: string) => `url(#${id(name)})`;
  const palette = PALETTES[rarity];
  const circumference = 2 * Math.PI * 34;
  const clamped = Math.min(1, Math.max(0, progress ?? 0));
  const discRadius = rarity === "legendary" ? 21.5 : rarity === "epic" ? 22 : 23;

  return (
    <span
      className={cx("gi-ab", `gi-ab--${rarity}`, locked && "gi-ab--locked", identityClass(resolvedTone, fx), className)}
      data-rarity={rarity}
      style={{ "--ab-size": `${size}px` } as CSSProperties}
    >
      <span className="gi-ab-medal" role="img" aria-label={label}>
        <svg viewBox="-6 -6 76 76" aria-hidden="true" focusable="false">
          <defs>
            <linearGradient id={id("rim")} x1="0" y1="0" x2="1" y2="1">
              <Stops colors={palette.rim} />
            </linearGradient>
            <radialGradient id={id("disc")} cx="0.38" cy="0.3" r="0.85">
              <Stops colors={palette.disc} />
            </radialGradient>
            <linearGradient id={id("gem")} x1="0" y1="0" x2="1" y2="1">
              <Stops colors={["#ffe4f2", "#ff4fa3", "#8a0b4c"]} />
            </linearGradient>
            <clipPath id={id("clip")}>
              <circle cx={CENTER} cy={CENTER} r={discRadius} />
            </clipPath>
          </defs>

          <g className="gi-ab-art">
            {rarity === "legendary" && (
              <polygon points={starPoints(16, 32.5, 27.2, 11.25)} fill={url("rim")} stroke={palette.edge} strokeWidth="0.7" strokeLinejoin="round" />
            )}
            {rarity === "epic" ? (
              <polygon points={octagon(30.2)} fill={url("rim")} stroke={palette.edge} strokeWidth="0.8" strokeLinejoin="round" />
            ) : rarity === "rare" ? (
              <g fill={url("rim")} stroke={palette.edge} strokeWidth="0.7">
                {Array.from({ length: 16 }, (_, index) => {
                  const [x, y] = at(26.8, index * 22.5);
                  return <circle key={index} cx={x} cy={y} r="3.4" />;
                })}
                <circle cx={CENTER} cy={CENTER} r="27" stroke="none" />
              </g>
            ) : (
              <circle cx={CENTER} cy={CENTER} r={rarity === "legendary" ? 27.4 : 29} fill={url("rim")} stroke={palette.edge} strokeWidth="0.8" />
            )}
            <circle cx={CENTER} cy={CENTER} r={discRadius + 1.6} fill="none" stroke="rgb(255 255 255 / 0.55)" strokeWidth="0.9" />
            <circle cx={CENTER} cy={CENTER} r={discRadius} fill={url("disc")} stroke="rgb(0 0 0 / 0.3)" strokeWidth="0.8" />
            <g clipPath={`url(#${id("clip")})`}>
              <ellipse cx={CENTER - 4} cy={CENTER - 13} rx="17" ry="9" fill="rgb(255 255 255 / 0.16)" />
              {rarity === "legendary" && !locked && <rect className="gi-ab-shine" x={CENTER - 30} y="0" width="9" height="64" fill="rgb(255 255 255 / 0.4)" transform={`rotate(20 ${CENTER} ${CENTER})`} />}
            </g>
            {rarity === "epic" &&
              [0, 90, 180, 270].map((degrees) => {
                const [x, y] = at(30.2, degrees);
                return (
                  <g key={degrees} transform={`translate(${x} ${y}) rotate(${degrees})`}>
                    <path d="M0 -4.2 L3 0 L0 4.2 L-3 0 Z" fill={url("gem")} stroke="#fde7f3" strokeWidth="0.55" />
                    <path d="M0 -4.2 L3 0 L0 0 Z" fill="rgb(255 255 255 / 0.5)" />
                  </g>
                );
              })}
            {rarity === "legendary" && (
              <g>
                <path d={`M${CENTER} -3.4 L${CENTER + 3.4} 1.6 L${CENTER} 6.6 L${CENTER - 3.4} 1.6 Z`} fill={url("gem")} stroke="#fff3c4" strokeWidth="0.7" />
                <path d={`M${CENTER} -3.4 L${CENTER + 3.4} 1.6 L${CENTER} 1.6 Z`} fill="rgb(255 255 255 / 0.55)" />
              </g>
            )}
            <Icon name={icon} x={CENTER - 11} y={CENTER - 10} width={22} height={22} stroke="rgb(0 0 0 / 0.32)" strokeWidth={2.4} />
            <Icon name={icon} x={CENTER - 11} y={CENTER - 11} width={22} height={22} stroke="#fff" strokeWidth={2.2} />
          </g>

          {locked && progress !== undefined && (
            <g className="gi-ab-progress">
              <circle cx={CENTER} cy={CENTER} r="34" fill="none" className="gi-ab-track" strokeWidth="2.6" />
              <circle
                cx={CENTER}
                cy={CENTER}
                r="34"
                fill="none"
                className="gi-ab-arc"
                strokeWidth="2.6"
                strokeLinecap="round"
                strokeDasharray={`${circumference * clamped} ${circumference}`}
                transform={`rotate(-90 ${CENTER} ${CENTER})`}
              />
            </g>
          )}
          {locked && (
            <g className="gi-ab-lock">
              <circle cx={CENTER + 20} cy={CENTER + 20} r="9" />
              <Icon name="lock" x={CENTER + 14} y={CENTER + 14} width={12} height={12} strokeWidth={2.4} />
            </g>
          )}
        </svg>
      </span>
      {(caption || (locked && progressLabel)) && (
        <span className="gi-ab-caption">
          {caption}
          {locked && progressLabel && <span className="gi-ab-progress-label">{progressLabel}</span>}
        </span>
      )}
    </span>
  );
}

function octagon(radius: number): string {
  const coordinates: string[] = [];
  for (let index = 0; index < 8; index += 1) {
    const [x, y] = at(radius, 22.5 + index * 45);
    coordinates.push(`${x.toFixed(2)},${y.toFixed(2)}`);
  }
  return coordinates.join(" ");
}
