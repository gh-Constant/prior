// Rounded hexagon level badge shared by the XP bar and the level-up overlay.
import { useId, type Ref } from "react";
import { hexagonPoints, roundedPolygonPath } from "../../../lib/fx/shapes";
import "./LevelBadge.css";

const OUTER = roundedPolygonPath(hexagonPoints(40, 44, 1), 6);
const INNER = roundedPolygonPath(hexagonPoints(40, 44, 4.5), 4.5);

type LevelBadgeProps = {
  readonly level: number;
  /** Rendered width in px; height follows the hexagon's proportions. */
  readonly size: number;
  readonly className?: string;
  readonly ref?: Ref<HTMLSpanElement>;
};

export function LevelBadge({ level, size, className, ref }: LevelBadgeProps) {
  const id = useId().replace(/:/g, "");
  const digits = String(level).length;
  return (
    <span ref={ref} className={`fx-level-badge${className ? ` ${className}` : ""}`} style={{ width: size, height: size * 1.1, fontSize: size * (digits > 2 ? 0.32 : digits > 1 ? 0.4 : 0.46) }} aria-hidden="true">
      <svg viewBox="0 0 40 44" className="fx-level-badge-shape">
        <defs>
          <linearGradient id={`${id}-o`} x1="0.2" y1="0" x2="0.8" y2="1">
            <stop offset="0" stopColor="#ffb08f" />
            <stop offset="0.45" stopColor="#f35f43" />
            <stop offset="1" stopColor="#b8341c" />
          </linearGradient>
          <linearGradient id={`${id}-i`} x1="0.3" y1="0" x2="0.7" y2="1">
            <stop offset="0" stopColor="#ff8a66" />
            <stop offset="1" stopColor="#dc4428" />
          </linearGradient>
        </defs>
        <path d={OUTER} fill={`url(#${id}-o)`} />
        <path d={INNER} fill={`url(#${id}-i)`} stroke="rgb(255 255 255 / 0.28)" strokeWidth="0.8" />
        <path d="M9 13 Q20 6 31 13 L31 17 Q20 11 9 17 Z" fill="rgb(255 255 255 / 0.18)" />
      </svg>
      <span className="fx-level-badge-number">{level}</span>
    </span>
  );
}
