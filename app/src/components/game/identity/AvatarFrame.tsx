// A decorative ring around any avatar (pet headshot, photo, initial). Rings are
// SVG or masked conic gradients; motion is rotation/opacity on HTML layers so it
// stays on the compositor. Ornaments scale down with size (see frameDetailForSize).
import { useId, type CSSProperties, type ReactNode } from "react";
import type { EffectsIntensity } from "../../../lib/gamification/types";
import { frameDetailForSize, laurelLeaves, polar, type AvatarFrameId, type FrameDetail } from "./frames";
import { hueForSeed } from "./rules";
import { Stops, featherPath } from "./svg";
import { cx, identityClass, useIdentityFx, useIdentityTone, type IdentityTone } from "./tone";
import "./AvatarFrame.css";

export type AvatarFrameProps = {
  readonly frame?: AvatarFrameId;
  /** Outer box in px (24–96). Ornaments such as wings may extend slightly beyond it. */
  readonly size?: number;
  /** The avatar itself; a neutral placeholder is shown when omitted. */
  readonly children?: ReactNode;
  /** Optional level badge at the bottom right (hidden below 30px). */
  readonly level?: number;
  /** Accessible text for the level badge, e.g. "Level 12". */
  readonly levelLabel?: string;
  /** When set, the frame is exposed as an image with this label. */
  readonly label?: string;
  readonly tone?: IdentityTone;
  readonly intensity?: EffectsIntensity;
  readonly className?: string;
};

type Layers = {
  glow?: boolean;
  back?: ReactNode;
  conic?: boolean;
  ring?: ReactNode;
  sheen?: boolean;
  spin?: ReactNode;
  front?: ReactNode;
  sparks?: readonly (readonly [number, number])[];
  embers?: boolean;
};

function Svg({ children }: { readonly children: ReactNode }) {
  return (
    <svg viewBox="0 0 100 100" aria-hidden="true" focusable="false">
      {children}
    </svg>
  );
}

function tongue(height: number): string {
  const h = height;
  return `M-5 0 C-5.6 ${-h * 0.45} -1.6 ${-h * 0.6} 0 ${-h} C1 ${-h * 0.56} 5.6 ${-h * 0.4} 5 0 Z`;
}

const LEAVES = laurelLeaves();

const RARE_DOTS: Readonly<Record<FrameDetail, readonly number[]>> = {
  full: Array.from({ length: 12 }, (_, index) => index * 30),
  reduced: Array.from({ length: 8 }, (_, index) => index * 45),
  minimal: [],
};

function frameLayers(frame: AvatarFrameId, detail: FrameDetail, uid: string, dark: boolean, full: boolean): Layers {
  const id = (name: string) => `${uid}-${name}`;
  const url = (name: string) => `url(#${id(name)})`;
  const ornate = detail !== "minimal";

  switch (frame) {
    case "none":
      return {
        ring: (
          <Svg>
            <circle cx="50" cy="50" r="41" fill="none" stroke={dark ? "rgb(255 255 255 / 0.12)" : "rgb(0 0 0 / 0.08)"} strokeWidth="1" />
          </Svg>
        ),
      };

    case "common":
      return {
        ring: (
          <Svg>
            <defs>
              <linearGradient id={id("c")} x1="0" y1="0" x2="1" y2="1">
                <Stops colors={dark ? ["#b3b0a8", "#6a6863", "#9c9991"] : ["#dedbd4", "#a19d94", "#d2cfc8"]} />
              </linearGradient>
            </defs>
            <circle cx="50" cy="50" r="44.2" fill="none" stroke={url("c")} strokeWidth="4.8" />
            <circle cx="50" cy="50" r="41.8" fill="none" stroke={dark ? "rgb(0 0 0 / 0.5)" : "rgb(0 0 0 / 0.12)"} strokeWidth="0.8" />
            <circle cx="50" cy="50" r="46.6" fill="none" stroke={dark ? "rgb(255 255 255 / 0.18)" : "rgb(0 0 0 / 0.08)"} strokeWidth="0.6" />
          </Svg>
        ),
      };

    case "rare":
      return {
        sheen: ornate,
        ring: (
          <Svg>
            <defs>
              <linearGradient id={id("b")} x1="0" y1="0" x2="1" y2="1">
                <Stops colors={["#a7ccff", "#3a78ec", "#1b3a8f", "#6aa6ff"]} />
              </linearGradient>
            </defs>
            <circle cx="50" cy="50" r="44.5" fill="none" stroke={dark ? "#132a61" : "#dde8fb"} strokeWidth="5.4" />
            <circle cx="50" cy="50" r="47.2" fill="none" stroke={url("b")} strokeWidth="2.1" />
            <circle cx="50" cy="50" r="41.8" fill="none" stroke={url("b")} strokeWidth="2.1" />
          </Svg>
        ),
        spin: ornate ? (
          <Svg>
            {RARE_DOTS[detail].map((degrees) => {
              const [x, y] = polar(44.5, degrees);
              return <circle key={degrees} cx={x} cy={y} r="1.25" fill="#fff" stroke="#2f6ae0" strokeWidth="0.55" />;
            })}
          </Svg>
        ) : undefined,
      };

    case "epic":
      return {
        glow: ornate,
        conic: true,
        ring: (
          <Svg>
            <circle cx="50" cy="50" r="46.9" fill="none" stroke="rgb(255 255 255 / 0.45)" strokeWidth="0.6" />
            <circle cx="50" cy="50" r="40.6" fill="none" stroke="rgb(45 0 80 / 0.5)" strokeWidth="0.7" />
          </Svg>
        ),
        front: ornate ? (
          <Svg>
            <defs>
              <linearGradient id={id("g")} x1="0" y1="0" x2="1" y2="1">
                <Stops colors={["#ffffff", "#ffb3dd", "#f0287f", "#7d0a45"]} />
              </linearGradient>
            </defs>
            {[45, 135, 225, 315].map((degrees) => {
              const [x, y] = polar(43.8, degrees);
              return (
                <g key={degrees} transform={`translate(${x} ${y}) rotate(${degrees})`}>
                  <path d="M0 -6.6 L4.4 0 L0 6.6 L-4.4 0 Z" fill={url("g")} stroke="#fff4fb" strokeWidth="0.8" strokeLinejoin="round" />
                  <path d="M0 -6.6 L4.4 0 L0 0 Z" fill="rgb(255 255 255 / 0.55)" />
                  <path d="M0 6.6 L-4.4 0 L0 0 Z" fill="rgb(80 0 40 / 0.35)" />
                </g>
              );
            })}
          </Svg>
        ) : undefined,
        sparks: full && detail === "full" ? [polar(52, 20), polar(53, 200)] : undefined,
      };

    case "legendary":
      return {
        glow: ornate,
        conic: true,
        back:
          detail === "full" ? (
            <Svg>
              <defs>
                <linearGradient id={id("w")} x1="1" y1="0" x2="0" y2="0">
                  <Stops colors={["#8a5a00", "#e9ad24", "#fff1b8"]} />
                </linearGradient>
              </defs>
              {[0, 1].map((side) => (
                <g key={side} transform={side ? "translate(100 0) scale(-1 1)" : undefined}>
                  {[
                    [46, 30],
                    [28, 29],
                    [11, 26],
                    [-5, 21],
                    [-19, 15],
                  ].map(([angle, length]) => (
                    <path
                      key={angle}
                      d={featherPath(length, 4.6)}
                      transform={`translate(9 52) rotate(${angle})`}
                      fill={url("w")}
                      stroke={dark ? "#2e1c00" : "#8a5700"}
                      strokeWidth="0.6"
                    />
                  ))}
                </g>
              ))}
            </Svg>
          ) : undefined,
        ring: (
          <Svg>
            <circle cx="50" cy="50" r="47.8" fill="none" stroke="rgb(90 50 0 / 0.55)" strokeWidth="0.7" />
            <circle cx="50" cy="50" r="46.6" fill="none" stroke="rgb(255 250 220 / 0.6)" strokeWidth="0.5" />
            <circle cx="50" cy="50" r="40" fill="none" stroke="rgb(90 50 0 / 0.55)" strokeWidth="0.8" />
          </Svg>
        ),
        front: ornate ? (
          <Svg>
            <defs>
              <linearGradient id={id("k")} x1="0" y1="0" x2="0" y2="1">
                <Stops colors={["#fff4c7", "#f6c445", "#b77a05"]} />
              </linearGradient>
              <radialGradient id={id("r")} cx="0.35" cy="0.3" r="0.8">
                <Stops colors={["#ffe2d6", "#ff5a3c", "#9f1206"]} />
              </radialGradient>
            </defs>
            <path d="M36.5 11.5 L34.6 0.6 L42.6 5.6 L50 -4.2 L57.4 5.6 L65.4 0.6 L63.5 11.5 Z" fill={url("k")} stroke="#7a4a00" strokeWidth="0.7" strokeLinejoin="round" />
            <path d="M36.5 11.5 L63.5 11.5 L63.9 9 L36.1 9 Z" fill="#a86d05" opacity="0.8" />
            {[
              [34.6, 0.6],
              [50, -4.2],
              [65.4, 0.6],
            ].map(([x, y]) => (
              <circle key={x} cx={x} cy={y} r="1.7" fill="#fff6d6" stroke="#8a5700" strokeWidth="0.5" />
            ))}
            <ellipse cx="50" cy="6.2" rx="2.5" ry="2.9" fill={url("r")} stroke="#7a1a05" strokeWidth="0.5" />
            {[90, 270].map((degrees) => {
              const [x, y] = polar(44, degrees);
              return <circle key={degrees} cx={x} cy={y} r="3.5" fill={url("r")} stroke="#ffe39a" strokeWidth="0.9" />;
            })}
          </Svg>
        ) : undefined,
        spin:
          full && detail === "full" ? (
            <Svg>
              <defs>
                <radialGradient id={id("s")}>
                  <Stops colors={["#ffffff", "#ffe08a", "rgb(255 190 60 / 0)"]} />
                </radialGradient>
              </defs>
              {[0, 120, 240].map((degrees) => {
                const [x, y] = polar(48.6, degrees);
                const [x1, y1] = polar(48.6, degrees - 7);
                const [x2, y2] = polar(48.6, degrees - 13);
                return (
                  <g key={degrees}>
                    <circle cx={x2} cy={y2} r="1" fill="#ffd36b" opacity="0.35" />
                    <circle cx={x1} cy={y1} r="1.5" fill="#ffd36b" opacity="0.6" />
                    <circle cx={x} cy={y} r="4.2" fill={url("s")} />
                    <circle cx={x} cy={y} r="1.3" fill="#fff" />
                  </g>
                );
              })}
            </Svg>
          ) : undefined,
        sparks: full && detail === "full" ? [polar(56, 330), polar(55, 32)] : undefined,
      };

    case "flame": {
      const angles = detail === "full" ? [-100, -75, -50, -25, 0, 25, 50, 75, 100] : [-60, -30, 0, 30, 60];
      return {
        glow: ornate,
        back: ornate ? (
          <Svg>
            <defs>
              <linearGradient id={id("t")} x1="0" y1="1" x2="0" y2="0">
                <Stops colors={["#c81e0a", "#ff6a00", "#ffc43a"]} />
              </linearGradient>
              <linearGradient id={id("u")} x1="0" y1="1" x2="0" y2="0">
                <Stops colors={["#ff9a1f", "#ffe68a", "#fffbe6"]} />
              </linearGradient>
            </defs>
            {angles.map((angle, index) => {
              const height = 8 + 11 * (1 - Math.abs(angle) / 110);
              const style = { "--d": `${0.9 + (index % 3) * 0.23}s`, "--delay": `${-index * 0.37}s` } as CSSProperties;
              return (
                <g key={angle} transform={`rotate(${angle} 50 50) translate(50 8.5)`}>
                  <path className="gi-af-tongue" style={style} d={tongue(height)} fill={url("t")} />
                  <path className="gi-af-tongue gi-af-tongue--inner" style={style} d={tongue(height * 0.62)} transform="scale(0.6 1)" fill={url("u")} />
                </g>
              );
            })}
          </Svg>
        ) : undefined,
        ring: (
          <Svg>
            <defs>
              <linearGradient id={id("f")} x1="0" y1="1" x2="0" y2="0">
                <Stops colors={["#8f1a0c", "#e2410c", "#ff9a1f", "#ffe36b"]} />
              </linearGradient>
            </defs>
            <circle cx="50" cy="50" r="44" fill="none" stroke={url("f")} strokeWidth="5.2" />
            <circle cx="50" cy="50" r="41.5" fill="none" stroke="rgb(90 10 0 / 0.5)" strokeWidth="0.7" />
            <circle cx="50" cy="50" r="46.4" fill="none" stroke="rgb(255 230 150 / 0.55)" strokeWidth="0.5" />
          </Svg>
        ),
        embers: full && detail === "full",
      };
    }

    case "laurel":
      return {
        sheen: true,
        ring: (
          <Svg>
            <defs>
              <linearGradient id={id("a")} x1="0" y1="0" x2="1" y2="1">
                <Stops colors={["#fbe7a1", "#c9951c", "#8d6106", "#e8c15a"]} />
              </linearGradient>
            </defs>
            <circle cx="50" cy="50" r="43.8" fill="none" stroke={url("a")} strokeWidth="3" />
            <circle cx="50" cy="50" r="41.8" fill="none" stroke="rgb(80 50 0 / 0.35)" strokeWidth="0.6" />
          </Svg>
        ),
        front: ornate ? (
          <Svg>
            <defs>
              <linearGradient id={id("l")} x1="0" y1="0" x2="1" y2="0">
                <Stops colors={dark ? ["#5f8f1c", "#9fd045", "#d9f28a"] : ["#3f6a0e", "#6fa322", "#a8d556"]} />
              </linearGradient>
              <linearGradient id={id("o")} x1="0" y1="0" x2="0" y2="1">
                <Stops colors={["#ffe7a0", "#d69e1e", "#8d6106"]} />
              </linearGradient>
            </defs>
            {[0, 1].map((side) => (
              <g key={side} transform={side ? "translate(100 0) scale(-1 1)" : undefined}>
                <path
                  d={`M${polar(46.5, 192).join(" ")} A46.5 46.5 0 0 1 ${polar(46.5, 305).join(" ")}`}
                  fill="none"
                  stroke={dark ? "#6e9a2a" : "#3f6a0e"}
                  strokeWidth="1"
                  strokeLinecap="round"
                />
                {LEAVES.map((leaf, index) => (
                  <path
                    key={index}
                    d="M0 0 C2.6 -2.5 6.8 -2.7 9.4 0 C6.8 2.3 2.6 2.3 0 0 Z"
                    transform={`translate(${leaf.x} ${leaf.y}) rotate(${leaf.rotate}) scale(${leaf.scale})`}
                    fill={url("l")}
                    stroke={dark ? "#1f3306" : "#2d4d08"}
                    strokeWidth="0.45"
                  />
                ))}
              </g>
            ))}
            <path d="M50 92 L43.5 99.5 L46.8 100.2 L50 96.4 L53.2 100.2 L56.5 99.5 Z" fill={url("o")} stroke="#7a4f00" strokeWidth="0.5" />
            <circle cx="50" cy="92.4" r="2.4" fill={url("o")} stroke="#7a4f00" strokeWidth="0.5" />
          </Svg>
        ) : undefined,
      };

    case "frost":
      return {
        glow: ornate,
        sheen: true,
        ring: (
          <Svg>
            <defs>
              <linearGradient id={id("i")} x1="0" y1="0" x2="1" y2="1">
                <Stops colors={["#f4fbff", "#8fdcff", "#1b9ee0", "#d8f3ff", "#5cc3f5"]} />
              </linearGradient>
            </defs>
            <circle cx="50" cy="50" r="44.1" fill="none" stroke={url("i")} strokeWidth="4.6" />
            <circle cx="50" cy="50" r="41.6" fill="none" stroke="rgb(255 255 255 / 0.85)" strokeWidth="0.7" strokeDasharray="2.2 2.8" />
            <circle cx="50" cy="50" r="46.6" fill="none" stroke={dark ? "rgb(186 230 253 / 0.4)" : "rgb(3 105 161 / 0.45)"} strokeWidth="0.6" />
          </Svg>
        ),
        front: ornate ? (
          <Svg>
            {[0, 60, 120, 180, 240, 300].map((angle) => (
              <g key={angle} transform={`rotate(${angle} 50 50) translate(50 7.6)`}>
                <path d="M0 -14.5 L2.3 -5 L0 0 L-2.3 -5 Z" fill={dark ? "#e8f7ff" : "#f2fbff"} stroke={dark ? "#7dd3fc" : "#0b84c6"} strokeWidth="0.7" strokeLinejoin="round" />
                {detail === "full" && <path d="M0 -8.4 L3.2 -11.6 M0 -8.4 L-3.2 -11.6" stroke={dark ? "#bfe9ff" : "#0b84c6"} strokeWidth="0.8" strokeLinecap="round" />}
              </g>
            ))}
            {detail === "full" &&
              [30, 90, 150, 210, 270, 330].map((angle) => (
                <g key={angle} transform={`rotate(${angle} 50 50) translate(50 6.8)`}>
                  <path d="M0 -6.5 L1.5 -2.6 L0 0 L-1.5 -2.6 Z" fill={dark ? "#d6f1ff" : "#e6f6ff"} stroke={dark ? "#7dd3fc" : "#0b84c6"} strokeWidth="0.55" strokeLinejoin="round" />
                </g>
              ))}
          </Svg>
        ) : undefined,
        sparks: full && detail === "full" ? [polar(58, 0), polar(57, 120), polar(57, 240)] : undefined,
      };

    case "prism":
      return {
        glow: ornate,
        conic: true,
        sheen: true,
        ring: (
          <Svg>
            <circle cx="50" cy="50" r="46.9" fill="none" stroke="rgb(255 255 255 / 0.7)" strokeWidth="0.6" />
            <circle cx="50" cy="50" r="40.6" fill="none" stroke={dark ? "rgb(255 255 255 / 0.35)" : "rgb(60 40 120 / 0.35)"} strokeWidth="0.7" />
          </Svg>
        ),
        front: ornate ? (
          <Svg>
            <defs>
              <linearGradient id={id("d")} x1="0" y1="0" x2="1" y2="1">
                <Stops colors={["#ffffff", "#c9f1ff", "#ddd0ff", "#ffd6ec", "#ffffff"]} />
              </linearGradient>
            </defs>
            <g stroke={dark ? "#ffffff" : "#5b54d6"} strokeWidth="0.6" strokeLinejoin="round">
              <path d="M41.5 3.2 L45.2 -2 L54.8 -2 L58.5 3.2 L50 14 Z" fill={url("d")} />
              <path d="M41.5 3.2 H58.5 M45.2 -2 L47.6 3.2 L50 14 M54.8 -2 L52.4 3.2 L50 14 M47.6 3.2 L50 -2 L52.4 3.2" fill="none" opacity="0.7" />
            </g>
            <path d="M45.6 -1 L48 -1 L46.6 2.4 Z" fill="#fff" opacity="0.9" />
          </Svg>
        ) : undefined,
        sparks: full && detail === "full" ? [polar(54, 62), polar(53, 148), polar(55, 236), polar(52, 312)] : undefined,
      };
  }
}

export function AvatarPlaceholder({ name = "", className }: { readonly name?: string; readonly className?: string }) {
  const initial = name.trim().slice(0, 1).toUpperCase();
  return (
    <span className={cx("gi-avatar-ph", className)} style={{ "--ph-h": hueForSeed(name) } as CSSProperties} aria-hidden="true">
      {initial || (
        <svg viewBox="0 0 24 24" width="55%" height="55%" fill="currentColor">
          <circle cx="12" cy="9" r="4" />
          <path d="M4.5 20c.9-3.6 3.8-5.4 7.5-5.4s6.6 1.8 7.5 5.4Z" />
        </svg>
      )}
    </span>
  );
}

export function AvatarFrame({ frame = "common", size = 48, children, level, levelLabel, label, tone, intensity, className }: AvatarFrameProps) {
  const resolvedTone = useIdentityTone(tone);
  const fx = useIdentityFx(intensity);
  const detail = frameDetailForSize(size);
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const layers = frameLayers(frame, detail, uid, resolvedTone === "dark", fx === "full");
  const showLevel = level !== undefined && detail !== "minimal";

  return (
    <span
      className={cx("gi-af", `gi-af--${frame}`, `gi-af--${detail}`, identityClass(resolvedTone, fx), className)}
      style={{ "--af-size": `${size}px` } as CSSProperties}
      role={label ? "img" : undefined}
      aria-label={label}
    >
      {layers.glow && <span className="gi-af-glow" aria-hidden="true" />}
      {layers.back && <span className="gi-af-layer gi-af-back">{layers.back}</span>}
      <span className="gi-af-avatar">{children ?? <AvatarPlaceholder />}</span>
      {layers.conic && <span className="gi-af-conic" aria-hidden="true" />}
      {layers.ring && <span className="gi-af-layer gi-af-ring">{layers.ring}</span>}
      {layers.sheen && fx !== "off" && <span className="gi-af-sheen" aria-hidden="true" />}
      {layers.spin && <span className="gi-af-layer gi-af-spin">{layers.spin}</span>}
      {layers.front && <span className="gi-af-layer gi-af-front">{layers.front}</span>}
      {layers.sparks?.map(([x, y], index) => (
        <span
          key={index}
          className="gi-af-spark gi-sparkle"
          aria-hidden="true"
          style={{ left: `${x}%`, top: `${y}%`, "--d": `${2.4 + index * 0.55}s`, "--delay": `${-index * 0.9}s` } as CSSProperties}
        />
      ))}
      {layers.embers &&
        [38, 52, 64].map((x, index) => (
          <span key={x} className="gi-af-ember" aria-hidden="true" style={{ left: `${x}%`, "--d": `${1.7 + index * 0.4}s`, "--delay": `${-index * 0.7}s` } as CSSProperties} />
        ))}
      {showLevel && (
        <span className="gi-af-level" aria-label={levelLabel} title={levelLabel}>
          {level}
        </span>
      )}
    </span>
  );
}
