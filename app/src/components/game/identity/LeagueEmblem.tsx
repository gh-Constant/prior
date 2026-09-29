// Weekly league emblems. Progression reads at a glance: a plain pebble, then
// metal shields (bronze → gold), then enamel shields set with gems, gaining
// wings, a crown, and finally a radiant diamond with rotating rays.
import { useId, type CSSProperties, type ReactNode } from "react";
import type { EffectsIntensity, LeagueTier } from "../../../lib/gamification/types";
import { leagueTierIndex } from "./rules";
import { Stops, featherPath } from "./svg";
import { cx, identityClass, useIdentityFx, useIdentityTone, type IdentityTone } from "./tone";
import "./LeagueEmblem.css";

export type LeagueEmblemProps = {
  readonly tier: LeagueTier;
  /** px, default 48. Wings and rays may extend a little beyond the box. */
  readonly size?: number;
  /** Accessible name; defaults to the capitalized tier id. */
  readonly label?: string;
  readonly tone?: IdentityTone;
  readonly intensity?: EffectsIntensity;
  readonly className?: string;
};

type TierStyle = {
  readonly body: readonly string[];
  readonly rim?: readonly string[];
  readonly gem?: readonly string[];
  readonly edge: string;
  readonly wing?: readonly string[];
};

const GOLD_RIM = ["#fff4c7", "#eab53a", "#9a6503"];

const STYLES: Readonly<Record<LeagueTier, TierStyle>> = {
  pebble: { body: ["#d3cfc7", "#a09b92", "#6f6b64"], edge: "#57534c" },
  bronze: { body: ["#eab184", "#b8703c", "#7d4219"], rim: ["#f6cfaa", "#a45e2b", "#63300f"], edge: "#4e260b" },
  silver: { body: ["#fbfcfd", "#c3cad2", "#7f8a96"], rim: ["#ffffff", "#9aa4af", "#56606b"], edge: "#3f4852" },
  gold: { body: ["#fff3c0", "#f6c844", "#bb7d06"], rim: ["#fff8dc", "#dea21b", "#855600"], edge: "#624000" },
  sapphire: { body: ["#6aa6ff", "#1f4fd1", "#0f2472"], rim: ["#ffffff", "#bcc6d2", "#65707d"], gem: ["#e3efff", "#4b8dff", "#0c2680"], edge: "#0b1f5c" },
  ruby: { body: ["#ff7385", "#c8102e", "#590313"], rim: GOLD_RIM, gem: ["#ffe3e8", "#ff2d55", "#6e0016"], edge: "#420010", wing: ["#8a5a00", "#f0bd3f", "#fff3c4"] },
  emerald: { body: ["#58e6ab", "#0b8a57", "#023a25"], rim: GOLD_RIM, gem: ["#e0fff1", "#1bc983", "#035236"], edge: "#022e1e", wing: ["#8a5a00", "#f0bd3f", "#fff3c4"] },
  amethyst: { body: ["#d3a8ff", "#7c2fd9", "#2b0a5c"], rim: ["#fff0dc", "#e3ad5e", "#86560f"], gem: ["#f7eaff", "#b366ff", "#480d85"], edge: "#23064a", wing: ["#86560f", "#f1c779", "#fff4e0"] },
  obsidian: { body: ["#524a63", "#1b1824", "#060509"], rim: ["#ffb3df", "#b8267f", "#380826"], gem: ["#ffe0f3", "#ff2f9a", "#3d0024"], edge: "#000000", wing: ["#0b0a10", "#3b3548", "#8a7fa3"] },
  diamond: { body: ["#f2fcff", "#96ddff", "#3787cf"], rim: ["#ffffff", "#d3ecff", "#8bb2d8"], gem: ["#ffffff", "#d7f4ff", "#9fd2ff", "#e6dcff"], edge: "#23507e", wing: ["#9fbfe0", "#e3f3ff", "#ffffff"] },
};

const SHIELD = "M50 8 L84 19 L84 47 C84 70 69 84 50 93 C31 84 16 70 16 47 L16 19 Z";
const PEBBLE = "M50 19 C69 17 85 30 84 51 C83 73 67 86 48 85 C28 84 15 71 16 51 C17 31 31 20 50 19 Z";

function star(cx: number, cy: number, outer: number, inner: number, points = 5): string {
  const coordinates: string[] = [];
  for (let index = 0; index < points * 2; index += 1) {
    const radius = index % 2 === 0 ? outer : inner;
    const angle = (Math.PI * index) / points - Math.PI / 2;
    coordinates.push(`${(cx + radius * Math.cos(angle)).toFixed(2)},${(cy + radius * Math.sin(angle)).toFixed(2)}`);
  }
  return coordinates.join(" ");
}

const WING_SETS: Readonly<Partial<Record<LeagueTier, readonly (readonly [number, number])[]>>> = {
  ruby: [
    [32, 25],
    [12, 21],
  ],
  emerald: [
    [38, 28],
    [20, 25],
    [3, 20],
  ],
  amethyst: [
    [44, 31],
    [28, 29],
    [13, 26],
    [-2, 20],
  ],
  diamond: [
    [48, 35],
    [33, 33],
    [19, 30],
    [6, 26],
    [-7, 20],
  ],
};

function Gem({ tier, fill }: { readonly tier: LeagueTier; readonly fill: string }): ReactNode {
  const facet = { fill: "none", stroke: "rgb(255 255 255 / 0.45)", strokeWidth: 0.8, strokeLinejoin: "round" as const };
  const outline = { fill, stroke: "rgb(0 0 0 / 0.35)", strokeWidth: 1, strokeLinejoin: "round" as const };
  switch (tier) {
    case "sapphire":
      return (
        <g>
          <polygon points="50,33 64,41 64,58 50,66 36,58 36,41" {...outline} />
          <polygon points="50,42 56,45.5 56,53.5 50,57 44,53.5 44,45.5" {...facet} />
          <path d="M50 33 V42 M64 41 L56 45.5 M64 58 L56 53.5 M50 66 V57 M36 58 L44 53.5 M36 41 L44 45.5" {...facet} />
          <polygon points="50,33 36,41 44,45.5 50,42" fill="rgb(255 255 255 / 0.4)" />
        </g>
      );
    case "ruby":
      return (
        <g>
          <ellipse cx="50" cy="50" rx="12.5" ry="15.5" {...outline} />
          <ellipse cx="50" cy="50" rx="6" ry="8" {...facet} />
          <path d="M50 34.5 V42 M50 58 V65.5 M37.5 50 H44 M56 50 H62.5 M41 39 L45.5 44 M59 39 L54.5 44 M41 61 L45.5 56 M59 61 L54.5 56" {...facet} />
          <path d="M42 40 C44 37 47 35.5 50 35 L50 42 C47 42.5 45 43.5 44 45 Z" fill="rgb(255 255 255 / 0.45)" />
        </g>
      );
    case "emerald":
      return (
        <g>
          <polygon points="43,34 57,34 62,39 62,61 57,66 43,66 38,61 38,39" {...outline} />
          <polygon points="45.5,39 54.5,39 57,41.5 57,58.5 54.5,61 45.5,61 43,58.5 43,41.5" {...facet} />
          <path d="M43 34 L45.5 39 M57 34 L54.5 39 M62 39 L57 41.5 M62 61 L57 58.5 M57 66 L54.5 61 M43 66 L45.5 61 M38 61 L43 58.5 M38 39 L43 41.5" {...facet} />
          <polygon points="43,34 57,34 54.5,39 45.5,39" fill="rgb(255 255 255 / 0.4)" />
        </g>
      );
    case "amethyst":
      return (
        <g>
          <path d="M50 31 C59 41 64.5 48.5 64.5 55.5 C64.5 63.5 58 69 50 69 C42 69 35.5 63.5 35.5 55.5 C35.5 48.5 41 41 50 31 Z" {...outline} />
          <path d="M50 42 C54 47 57 51 57 55 C57 59.5 54 62 50 62 C46 62 43 59.5 43 55 C43 51 46 47 50 42 Z" {...facet} />
          <path d="M50 31 V42 M64.5 55.5 H57 M35.5 55.5 H43 M50 69 V62" {...facet} />
          <path d="M50 31 C45 37 41 42.5 38.5 47.5 L45 50 C46.5 47 48 44.5 50 42 Z" fill="rgb(255 255 255 / 0.45)" />
        </g>
      );
    case "obsidian":
      return (
        <g>
          <polygon points="50,29 60,41 58,62 50,71 42,62 40,41" {...outline} stroke="#ff5cb8" strokeWidth={1.1} />
          <path d="M50 29 L47 45 L52 53 L48 71 M60 41 L52 53 M40 41 L47 45" fill="none" stroke="rgb(255 120 200 / 0.8)" strokeWidth="0.9" />
          <polygon points="50,29 40,41 47,45" fill="rgb(255 255 255 / 0.28)" />
        </g>
      );
    case "diamond":
      return (
        <g>
          <polygon points="33,44 40.5,35 59.5,35 67,44 50,70" {...outline} stroke="#2b5c8a" />
          <path d="M33 44 H67 M40.5 35 L45 44 L50 70 M59.5 35 L55 44 L50 70 M45 44 L50 35 L55 44 M33 44 L50 70 M67 44 L50 70" fill="none" stroke="rgb(40 90 140 / 0.45)" strokeWidth="0.8" strokeLinejoin="round" />
          <polygon points="40.5,35 50,35 45,44 33,44" fill="rgb(255 255 255 / 0.85)" />
          <polygon points="45,44 50,70 33,44" fill="rgb(160 210 255 / 0.35)" />
        </g>
      );
    default:
      return null;
  }
}

export function LeagueEmblem({ tier, size = 48, label, tone, intensity, className }: LeagueEmblemProps) {
  const resolvedTone = useIdentityTone(tone);
  const fx = useIdentityFx(intensity);
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const id = (name: string) => `${uid}-${name}`;
  const url = (name: string) => `url(#${id(name)})`;
  const index = leagueTierIndex(tier);
  const style = STYLES[tier];
  const wings = WING_SETS[tier];
  const accessibleName = label ?? tier.charAt(0).toUpperCase() + tier.slice(1);
  const inner = "translate(50 50) scale(0.8) translate(-50 -50.5)";

  return (
    <span
      className={cx("gi-le", `gi-le--${tier}`, identityClass(resolvedTone, fx), className)}
      style={{ "--le-size": `${size}px` } as CSSProperties}
      role="img"
      aria-label={accessibleName}
    >
      {tier === "diamond" && <span className="gi-le-rays" aria-hidden="true" />}
      {tier === "obsidian" && <span className="gi-le-aura" aria-hidden="true" />}
      <svg viewBox="0 0 100 100" aria-hidden="true" focusable="false">
        <defs>
          <linearGradient id={id("body")} x1="0.2" y1="0" x2="0.8" y2="1">
            <Stops colors={style.body} />
          </linearGradient>
          {style.rim && (
            <linearGradient id={id("rim")} x1="0" y1="0" x2="1" y2="1">
              <Stops colors={style.rim} />
            </linearGradient>
          )}
          {style.gem && (
            <linearGradient id={id("gem")} x1="0.1" y1="0" x2="0.9" y2="1">
              <Stops colors={style.gem} />
            </linearGradient>
          )}
          {style.wing && (
            <linearGradient id={id("wing")} x1="1" y1="0" x2="0" y2="0">
              <Stops colors={style.wing} />
            </linearGradient>
          )}
          <linearGradient id={id("gloss")} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#fff" stopOpacity="0.5" />
            <stop offset="0.55" stopColor="#fff" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Obsidian: jagged spikes behind the shield */}
        {tier === "obsidian" &&
          [0, 1].map((side) => (
            <g key={side} transform={side ? "translate(100 0) scale(-1 1)" : undefined} fill={url("wing")} stroke="#d0258a" strokeWidth="0.9" strokeLinejoin="round">
              <path d="M22 30 L-4 12 L10 36 Z" />
              <path d="M20 44 L-8 38 L12 52 Z" />
              <path d="M22 58 L0 64 L18 66 Z" />
            </g>
          ))}

        {wings?.map(([angle, length], featherIndex) =>
          [0, 1].map((side) => (
            <path
              key={`${featherIndex}-${side}`}
              d={featherPath(length, 4.6)}
              transform={`${side ? "translate(100 0) scale(-1 1) " : ""}translate(20 44) rotate(${angle})`}
              fill={url("wing")}
              stroke={style.edge}
              strokeWidth="0.7"
            />
          )),
        )}

        {tier === "pebble" ? (
          <g>
            <path d={PEBBLE} fill={url("body")} stroke={style.edge} strokeWidth="1.4" />
            <path d="M31 36 C37 27 48 24 58 26 C48 29 39 33 34 41 Z" fill="rgb(255 255 255 / 0.45)" />
            {[
              [40, 58, 1.6],
              [58, 66, 1.2],
              [63, 48, 1.4],
              [47, 72, 1],
              [33, 50, 1],
            ].map(([cx, cy, r]) => (
              <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={r} fill="rgb(60 55 50 / 0.35)" />
            ))}
          </g>
        ) : (
          <g>
            <path d={SHIELD} fill={url(style.rim ? "rim" : "body")} stroke={style.edge} strokeWidth="1.4" strokeLinejoin="round" />
            <path d={SHIELD} transform={inner} fill={url("body")} stroke={style.edge} strokeOpacity="0.55" strokeWidth="1.2" strokeLinejoin="round" />
            {index >= 2 && <path d={SHIELD} transform="translate(50 50) scale(0.9) translate(-50 -50.2)" fill="none" stroke="rgb(255 255 255 / 0.55)" strokeWidth="0.8" />}
            <path d={SHIELD} transform={inner} fill={url("gloss")} />
          </g>
        )}

        {tier === "bronze" && <path d="M33 47 L50 36 L67 47 L67 56 L50 45 L33 56 Z" fill="#f2c197" stroke={style.edge} strokeWidth="1.1" strokeLinejoin="round" />}
        {tier === "silver" && <polygon points={star(50, 51, 15, 6.5)} fill="#ffffff" stroke={style.edge} strokeWidth="1.1" strokeLinejoin="round" />}
        {tier === "gold" && (
          <g>
            <polygon points={star(50, 49, 15.5, 6.8)} fill="#fffbe8" stroke={style.edge} strokeWidth="1.1" strokeLinejoin="round" />
            {[0, 1].map((side) => (
              <g key={side} transform={side ? "translate(100 0) scale(-1 1)" : undefined} fill="#fff3c4" stroke={style.edge} strokeWidth="0.7">
                <path d="M38 72 C33 69 30 64 29.5 58" fill="none" strokeWidth="1" />
                <ellipse cx="31" cy="61" rx="1.8" ry="3.6" transform="rotate(-25 31 61)" />
                <ellipse cx="34" cy="67" rx="1.8" ry="3.6" transform="rotate(-50 34 67)" />
                <ellipse cx="38.5" cy="71" rx="1.8" ry="3.4" transform="rotate(-75 38.5 71)" />
              </g>
            ))}
          </g>
        )}
        {style.gem && <Gem tier={tier} fill={url("gem")} />}

        {index >= 6 && (
          <g stroke={style.edge} strokeWidth="0.9" strokeLinejoin="round">
            <path d="M35 17 L32.5 4 L42 10 L50 -1.5 L58 10 L67.5 4 L65 17 Z" fill={url("rim")} />
            <path d="M35 17 H65 L65.4 14 H34.6 Z" fill="rgb(0 0 0 / 0.2)" stroke="none" />
            {[
              [32.5, 4],
              [50, -1.5],
              [67.5, 4],
            ].map(([cx, cy]) => (
              <circle key={cx} cx={cx} cy={cy} r="2" fill="#fff" />
            ))}
            <circle cx="50" cy="11" r="2.4" fill={style.gem ? url("gem") : "#fff"} />
          </g>
        )}

        {index >= 3 && <polygon className="gi-le-glint" points={star(29, 24, 5.5, 1.3, 4)} fill="#fff" />}
      </svg>
      {tier === "diamond" && (
        <>
          <span className="gi-le-spark gi-sparkle" style={{ left: "20%", top: "30%" }} aria-hidden="true" />
          <span className="gi-le-spark gi-sparkle" style={{ left: "82%", top: "58%", animationDelay: "-1.1s" }} aria-hidden="true" />
          <span className="gi-le-spark gi-sparkle" style={{ left: "62%", top: "12%", animationDelay: "-2s" }} aria-hidden="true" />
        </>
      )}
    </span>
  );
}
