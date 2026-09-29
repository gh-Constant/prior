// A person's display name with their equipped name effect. The name is always
// real, selectable text; gradients use background-clip and decorations are a
// handful of absolutely positioned spans animated with shared CSS keyframes.
import { useMemo, type CSSProperties, type ReactNode } from "react";
import type { EffectsIntensity, NameEffectId } from "../../../lib/gamification/types";
import { seededRandom } from "./rules";
import { cx, identityClass, useIdentityFx, useIdentityTone, type IdentityTone } from "./tone";
import "./Nameplate.css";

export type NameplateSize = "sm" | "md" | "lg";

export type NameplateProps = {
  readonly name: string;
  readonly effect?: NameEffectId;
  /** sm: inline in lists, md: cards and rows, lg: profile header. */
  readonly size?: NameplateSize;
  readonly tone?: IdentityTone;
  /** Overrides the app-wide effects intensity (reduced motion still wins). */
  readonly intensity?: EffectsIntensity;
  readonly className?: string;
};

type DecorKind = "embers" | "glints" | "specks" | "sparkles" | "motes" | "orbits";

const DECOR: Readonly<Record<NameEffectId, readonly DecorKind[]>> = {
  plain: [],
  copper: [],
  silver: [],
  gold: ["embers"],
  emerald: ["glints"],
  sapphire: ["specks"],
  diamond: ["sparkles"],
  aurora: ["motes"],
  mythic: ["orbits", "embers"],
};

const DECOR_COUNT: Readonly<Record<NameplateSize, Readonly<Record<DecorKind, number>>>> = {
  sm: { embers: 3, glints: 2, specks: 4, sparkles: 2, motes: 3, orbits: 2 },
  md: { embers: 6, glints: 3, specks: 6, sparkles: 3, motes: 4, orbits: 3 },
  lg: { embers: 9, glints: 4, specks: 9, sparkles: 4, motes: 6, orbits: 3 },
};

/** Effects drawing a blurred copy of the name behind it. */
const GLOW: ReadonlySet<NameEffectId> = new Set(["emerald", "sapphire", "diamond", "mythic"]);
/** Effects drawing a soft colored light band behind the name. */
const VEIL: ReadonlySet<NameEffectId> = new Set(["aurora", "mythic"]);

const MYTHIC_COLORS = ["#ff5a2e", "#ffc23d", "#ff4fd8", "#8f7bff", "#35d6f0"];
const AURORA_COLORS = ["#5eead4", "#a78bfa", "#f0abfc", "#4ade80"];

function vars(values: Record<string, string | number>): CSSProperties {
  return values as CSSProperties;
}

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function renderDecor(effect: NameEffectId, size: NameplateSize, name: string): ReactNode[] {
  const random = seededRandom(`${effect}:${name}`);
  const between = (min: number, max: number) => min + random() * (max - min);
  const nodes: ReactNode[] = [];
  for (const kind of DECOR[effect]) {
    const count = DECOR_COUNT[size][kind];
    for (let index = 0; index < count; index += 1) {
      const key = `${kind}-${index}`;
      // Spread along the name so decorations never bunch up on one side.
      const lane = (index + between(0.15, 0.85)) / count;
      switch (kind) {
        case "embers": {
          const duration = between(1.9, 3.1);
          const color = effect === "mythic" ? MYTHIC_COLORS[index % MYTHIC_COLORS.length] : undefined;
          nodes.push(
            <span
              key={key}
              className="gi-np-ember"
              style={vars({
                left: pct(lane),
                "--np-d": `${duration.toFixed(2)}s`,
                "--np-delay": `${(-random() * duration).toFixed(2)}s`,
                "--np-dx": `${between(-0.35, 0.35).toFixed(2)}em`,
                "--np-rise": `${between(0.8, 1.25).toFixed(2)}em`,
                "--np-s": between(0.7, 1.25).toFixed(2),
                ...(color ? { "--np-ember": color, "--np-ember-glow": color } : {}),
              })}
            />,
          );
          break;
        }
        case "motes": {
          const duration = between(4.5, 7);
          nodes.push(
            <span
              key={key}
              className="gi-np-mote"
              style={vars({
                left: pct(lane),
                "--np-d": `${duration.toFixed(2)}s`,
                "--np-delay": `${(-random() * duration).toFixed(2)}s`,
                "--np-dx": `${between(-0.5, 0.5).toFixed(2)}em`,
                "--np-rise": `${between(0.7, 1.1).toFixed(2)}em`,
                "--np-mote": AURORA_COLORS[index % AURORA_COLORS.length],
              })}
            />,
          );
          break;
        }
        case "specks": {
          const duration = between(1.6, 3.2);
          nodes.push(
            <span
              key={key}
              className="gi-np-speck"
              style={vars({
                left: pct(lane),
                top: pct(random() < 0.5 ? between(0.02, 0.3) : between(0.7, 0.98)),
                "--np-d": `${duration.toFixed(2)}s`,
                "--np-delay": `${(-random() * duration).toFixed(2)}s`,
                "--np-s": between(0.7, 1.15).toFixed(2),
              })}
            />,
          );
          break;
        }
        case "glints":
        case "sparkles": {
          const duration = kind === "sparkles" ? between(3.6, 5.2) : between(4.2, 6);
          const spot = () => `${pct(between(0.08, 0.92))}`;
          const height = () => `${pct(between(0.25, 0.75))}`;
          nodes.push(
            <span
              key={key}
              className={kind === "sparkles" ? "gi-np-hop gi-np-hop--sparkle" : "gi-np-hop gi-np-hop--glint"}
              style={vars({
                "--x1": pct(lane),
                "--y1": height(),
                "--x2": spot(),
                "--y2": height(),
                "--x3": spot(),
                "--y3": height(),
                "--np-d": `${duration.toFixed(2)}s`,
                "--np-delay": `${(-random() * duration).toFixed(2)}s`,
              })}
            >
              <i className="gi-sparkle" />
            </span>,
          );
          break;
        }
        case "orbits": {
          const duration = size === "sm" ? 2.6 : 3.4;
          nodes.push(
            <span
              key={key}
              className="gi-np-orbit"
              style={vars({
                "--np-d": `${duration}s`,
                "--np-delay": `${(-(index / count) * duration * 2).toFixed(2)}s`,
                "--np-c": MYTHIC_COLORS[(index * 2) % MYTHIC_COLORS.length],
              })}
            >
              <span className="gi-np-orbit-y"><i /></span>
            </span>,
          );
          break;
        }
      }
    }
  }
  return nodes;
}

export function Nameplate({ name, effect = "plain", size = "md", tone, intensity, className }: NameplateProps) {
  const resolvedTone = useIdentityTone(tone);
  const fx = useIdentityFx(intensity);
  const decor = useMemo(() => (fx === "full" ? renderDecor(effect, size, name) : []), [effect, size, name, fx]);

  return (
    <span className={cx("gi-np", `gi-np--${effect}`, `gi-np--${size}`, identityClass(resolvedTone, fx), className)} data-effect={effect}>
      {VEIL.has(effect) && <span className="gi-np-veil" aria-hidden="true" />}
      {GLOW.has(effect) && <span className="gi-np-glow" aria-hidden="true">{name}</span>}
      <span className="gi-np-text">{name}</span>
      {decor.length > 0 && <span className="gi-np-fx" aria-hidden="true">{decor}</span>}
    </span>
  );
}
