// Vector chest in four tiers. The lid, light column and interior are separate parts so CSS can open it.
import { useId, type Ref } from "react";
import type { ChestTier } from "../../../lib/gamification/types";
import "./ChestSvg.css";

type ChestTone = {
  /** Body highlight, base and shadow. */
  readonly wood: readonly [string, string, string];
  /** Metal trim highlight and shadow. */
  readonly trim: readonly [string, string];
  readonly light: string;
  readonly gem?: string;
};

export const CHEST_TONES: Readonly<Record<ChestTier, ChestTone>> = {
  common: { wood: ["#c3c8cf", "#959ca6", "#646b76"], trim: ["#f4f5f7", "#a7adb6"], light: "#eef1f5" },
  rare: { wood: ["#79a9ff", "#3d7cf0", "#1f47a0"], trim: ["#f1f6ff", "#9fb5dd"], light: "#cfe0ff" },
  epic: { wood: ["#c29bff", "#9058ea", "#55289f"], trim: ["#fff2c0", "#dba42a"], light: "#ecdcff", gem: "#ff7ad9" },
  legendary: { wood: ["#ffc860", "#f59e1b", "#b85c09"], trim: ["#fffbe6", "#f0bd3e"], light: "#fff2c4", gem: "#ff3d6e" },
};

type ChestSvgProps = {
  readonly tier: ChestTier;
  readonly open?: boolean;
  readonly className?: string;
  readonly title?: string;
  readonly ref?: Ref<SVGSVGElement>;
};

export function ChestSvg({ tier, open = false, className, title, ref }: ChestSvgProps) {
  const id = useId().replace(/:/g, "");
  const tone = CHEST_TONES[tier];
  const url = (name: string) => `url(#${id}-${name})`;
  const lidPath = "M18 71 L18 50 C18 27 44 16 80 16 C116 16 142 27 142 50 L142 71 Z";

  return (
    <svg
      ref={ref}
      viewBox="0 0 160 150"
      className={`fx-chest fx-chest-${tier}${className ? ` ${className}` : ""}`}
      data-open={open ? "" : undefined}
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
    >
      <defs>
        <linearGradient id={`${id}-wood`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={tone.wood[0]} />
          <stop offset="0.45" stopColor={tone.wood[1]} />
          <stop offset="1" stopColor={tone.wood[2]} />
        </linearGradient>
        <linearGradient id={`${id}-lid`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={tone.wood[0]} />
          <stop offset="0.7" stopColor={tone.wood[1]} />
          <stop offset="1" stopColor={tone.wood[2]} />
        </linearGradient>
        <linearGradient id={`${id}-trim`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={tone.trim[0]} />
          <stop offset="1" stopColor={tone.trim[1]} />
        </linearGradient>
        <linearGradient id={`${id}-trimv`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor={tone.trim[1]} />
          <stop offset="0.45" stopColor={tone.trim[0]} />
          <stop offset="1" stopColor={tone.trim[1]} />
        </linearGradient>
        <linearGradient id={`${id}-beam`} x1="0" y1="1" x2="0" y2="0">
          <stop offset="0" stopColor={tone.light} stopOpacity="0.95" />
          <stop offset="0.5" stopColor={tone.light} stopOpacity="0.35" />
          <stop offset="1" stopColor={tone.light} stopOpacity="0" />
        </linearGradient>
        <radialGradient id={`${id}-inside`} cx="0.5" cy="0.2" r="0.8">
          <stop offset="0" stopColor={tone.light} />
          <stop offset="0.6" stopColor={tone.wood[2]} />
          <stop offset="1" stopColor="#1b1410" />
        </radialGradient>
        <clipPath id={`${id}-lidclip`}>
          <path d={lidPath} />
        </clipPath>
      </defs>

      <ellipse className="fx-chest-shadow" cx="80" cy="139" rx="58" ry="7" fill="rgb(0 0 0 / 0.2)" />

      {/* Interior and light column, hidden behind the lid until it opens. */}
      <path className="fx-chest-beam" d="M28 70 L132 70 L158 -60 L2 -60 Z" fill={url("beam")} />
      <rect className="fx-chest-inside" x="22" y="58" width="116" height="18" rx="6" fill={url("inside")} />

      <g className="fx-chest-body">
        <rect x="20" y="70" width="120" height="62" rx="8" fill={url("wood")} />
        <path d="M22 92 H138 M22 112 H138" stroke={tone.wood[2]} strokeOpacity="0.45" strokeWidth="1.6" />
        <path d="M22 93.4 H138 M22 113.4 H138" stroke="#fff" strokeOpacity="0.14" strokeWidth="1" />
        <rect x="33" y="70" width="13" height="62" fill={url("trimv")} />
        <rect x="114" y="70" width="13" height="62" fill={url("trimv")} />
        <rect x="17" y="68" width="126" height="10" rx="3" fill={url("trim")} />
        <rect x="17" y="124" width="126" height="11" rx="4" fill={url("trim")} />
        <g fill={tone.trim[1]}>
          <circle cx="39.5" cy="85" r="1.8" />
          <circle cx="39.5" cy="117" r="1.8" />
          <circle cx="120.5" cy="85" r="1.8" />
          <circle cx="120.5" cy="117" r="1.8" />
        </g>
        <rect x="66" y="66" width="28" height="30" rx="7" fill={url("trim")} stroke={tone.trim[1]} strokeWidth="1" />
        {tone.gem ? (
          <path d="M80 72 L87 80 L80 90 L73 80 Z" fill={tone.gem} stroke="#fff" strokeOpacity="0.7" strokeWidth="1" />
        ) : (
          <path d="M80 75.5 a4 4 0 0 1 2.2 7.3 L83.4 89 H76.6 L77.8 82.8 A4 4 0 0 1 80 75.5 Z" fill="#2a2420" fillOpacity="0.78" />
        )}
        {tone.gem && <path d="M80 72 L83 76 L80 78 L77 76 Z" fill="#fff" fillOpacity="0.55" />}
      </g>

      <g className="fx-chest-lid">
        <path d={lidPath} fill={url("lid")} />
        <g clipPath={url("lidclip")}>
          <rect x="33" y="10" width="13" height="64" fill={url("trimv")} />
          <rect x="114" y="10" width="13" height="64" fill={url("trimv")} />
          <path d="M30 34 C44 24 60 21 80 21 C100 21 116 24 130 34" stroke="#fff" strokeOpacity="0.32" strokeWidth="3" fill="none" strokeLinecap="round" />
          <path d="M18 50 C40 44 60 42 80 42 C100 42 120 44 142 50" stroke={tone.wood[2]} strokeOpacity="0.35" strokeWidth="1.5" fill="none" />
        </g>
        <rect x="16" y="61" width="128" height="10" rx="3" fill={url("trim")} />
        <rect x="71" y="56" width="18" height="16" rx="4" fill={url("trim")} stroke={tone.trim[1]} strokeWidth="1" />
        {tone.gem && (
          <g fill={tone.gem} stroke="#fff" strokeOpacity="0.6" strokeWidth="0.8">
            <circle cx="39.5" cy="40" r="3.2" />
            <circle cx="120.5" cy="40" r="3.2" />
          </g>
        )}
      </g>
    </svg>
  );
}
