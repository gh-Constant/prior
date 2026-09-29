// The pet rig: named parts shared by all species. Pure render functions, no
// hooks, so Pet, PetHeadshot and the Den compose the same art.
import type { CSSProperties, ReactNode } from "react";
import type { PetSpecies } from "../../../lib/gamification/types";
import { AccessoryArt } from "./AccessoryArt";
import { hatCoversCrown, type PetAccessories } from "./accessories";
import type { PetExpression } from "./expressions";
import { getAccessoryAnchor, type PetGeometry } from "./geometry";
import { FLAME, type PetPalette } from "./palette";
import { blobPath, flamePath, leafPath, MIRROR_X, puffPath, sparklePath } from "./shapes";

export type FigureProps = {
  readonly uid: string;
  readonly geometry: PetGeometry;
  readonly palette: PetPalette;
};

const SW = 1.5;
const r1 = (value: number) => Math.round(value * 100) / 100;
const vars = (values: Record<string, string | number>) => values as CSSProperties;

export function headPath({ species, head }: PetGeometry): string {
  const shapes: Record<PetSpecies, Parameters<typeof blobPath>[4]> = {
    mochi: { kTop: 0.62, kBottom: 0.76, shift: 0.14 },
    fern: { kTop: 0.5, kBottom: 0.66, shift: 0.1 },
    nova: { kTop: 0.56, kBottom: 0.62, shift: 0.06 },
    ember: { kTop: 0.58, kBottom: 0.68, shift: 0.1 },
  };
  return blobPath(head.cx, head.cy, head.rx, head.ry, shapes[species]);
}

export function bodyPath({ species, body }: PetGeometry): string {
  return blobPath(body.cx, body.cy, body.rx, body.ry, { kTop: 0.5, kBottom: species === "mochi" ? 0.78 : 0.72, shift: 0.18 });
}

/** Gradients and clip paths. Ids are prefixed with the per-pet uid. */
export function PetDefs({ uid, geometry, palette }: FigureProps) {
  return (
    <defs>
      <radialGradient id={`${uid}-fur`} cx="0.36" cy="0.3" r="0.82">
        <stop offset="0" stopColor={palette.light} />
        <stop offset="0.52" stopColor={palette.base} />
        <stop offset="1" stopColor={palette.shade} />
      </radialGradient>
      <radialGradient id={`${uid}-belly`} cx="0.5" cy="0.34" r="0.72">
        <stop offset="0" stopColor={palette.belly} />
        <stop offset="1" stopColor={palette.bellyShade} />
      </radialGradient>
      <linearGradient id={`${uid}-accent`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor={palette.accent} />
        <stop offset="1" stopColor={palette.accentShade} />
      </linearGradient>
      <linearGradient id={`${uid}-feature`} x1="0.2" y1="0" x2="0.8" y2="1">
        <stop offset="0" stopColor={palette.feature} />
        <stop offset="1" stopColor={palette.featureShade} />
      </linearGradient>
      <linearGradient id={`${uid}-eye`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor={palette.eye} />
        <stop offset="0.58" stopColor={palette.eye} />
        <stop offset="1" stopColor={palette.eyeTint} />
      </linearGradient>
      <radialGradient id={`${uid}-cheek`}>
        <stop offset="0" stopColor={palette.cheek} stopOpacity="0.85" />
        <stop offset="0.6" stopColor={palette.cheek} stopOpacity="0.5" />
        <stop offset="1" stopColor={palette.cheek} stopOpacity="0" />
      </radialGradient>
      <radialGradient id={`${uid}-glow`}>
        <stop offset="0" stopColor={palette.glow} stopOpacity="0.9" />
        <stop offset="0.45" stopColor={palette.glow} stopOpacity="0.42" />
        <stop offset="1" stopColor={palette.glow} stopOpacity="0" />
      </radialGradient>
      <linearGradient id={`${uid}-flame`} x1="0" y1="1" x2="0" y2="0">
        <stop offset="0" stopColor={FLAME.outer} />
        <stop offset="1" stopColor={FLAME.mid} />
      </linearGradient>
      <clipPath id={`${uid}-head`}><path d={headPath(geometry)} /></clipPath>
      <clipPath id={`${uid}-body`}><path d={bodyPath(geometry)} /></clipPath>
      <clipPath id={`${uid}-tail`}><path d={NOVA_TAIL} /></clipPath>
    </defs>
  );
}

// ─── Back layer: tails and wings ────────────────────────────────────────────

const NOVA_TAIL = "M-2 3C10 6 24 1 27 -13C29 -23 24 -32 16 -36C18 -28 16 -20 9 -15C4 -11 0 -9 -3 -6Z";
const EMBER_TAIL = "M-2 -3.6C6 -4 12 -6 15.4 -13L19 -11.6C15.6 -2.6 8 3.6 -2 3.6Z";
const EMBER_WING = "M2 2C-3 -6 -12 -13 -21 -14Q-19.4 -9.6 -16.4 -8.6Q-16 -4.6 -11.4 -4Q-10.6 0 -5.6 0.8Q-3 4 2 4Z";

export function PetBack({ uid, geometry: g, palette: p }: FigureProps) {
  const { body: b, feature: f } = g;
  if (g.species === "mochi") {
    const r = 5.2 + 3.6 * f;
    return (
      <g className="pet-tail" style={{ transformOrigin: "10% 60%" }}>
        <path d={puffPath(b.cx + b.rx * 0.9, b.cy + b.ry * 0.12, r, 6, -60)} fill={`url(#${uid}-fur)`} stroke={p.outline} strokeWidth={SW} strokeLinejoin="round" />
        <circle cx={b.cx + b.rx * 0.9 - r * 0.25} cy={b.cy + b.ry * 0.12 - r * 0.3} r={r * 0.28} fill="#fff" opacity={0.55} />
      </g>
    );
  }
  if (g.species === "nova") {
    const s = 0.62 + 0.62 * f;
    const specks: Array<[number, number, number, number]> = [[19, -12, 2.4, 0], [11.5, -5.5, 1.7, 0.6], [23.5, -22, 1.9, 1.1], [7, -12.5, 1.5, 1.6]];
    const count = g.stage === "baby" ? 1 : g.stage === "young" ? 2 : g.stage === "adult" ? 3 : 4;
    return (
      <g transform={`translate(${r1(b.cx + b.rx * 0.42)} ${r1(b.cy + b.ry * 0.62)}) scale(${r1(s)})`}>
        <g className="pet-tail" style={{ transformOrigin: "0% 100%" }}>
          <path d={NOVA_TAIL} fill={`url(#${uid}-fur)`} stroke={p.outline} strokeWidth={SW / s} strokeLinejoin="round" />
          <g clipPath={`url(#${uid}-tail)`}>
            <ellipse cx={19} cy={-35} rx={10} ry={9} fill={p.belly} />
          </g>
          <path d="M16 -36C24 -32 29 -23 27 -13" fill="none" stroke={p.outline} strokeWidth={SW / s} strokeLinecap="round" />
          {specks.slice(0, count).map(([x, y, r, delay]) => (
            <path key={`${x}-${y}`} className="pet-twinkle" style={vars({ "--pet-delay": `${delay}s` })} d={sparklePath(x, y, r / s * 0.9 + 0.6)} fill={p.feature} />
          ))}
        </g>
      </g>
    );
  }
  if (g.species === "ember") {
    const s = 0.6 + 0.4 * f;
    const ws = 0.55 + 0.62 * f;
    const flame = 8.5 + 3 * f + (g.radiant ? 2.5 : 0);
    const wing = (
      <g className="pet-wing" style={{ transformOrigin: "100% 100%" }}>
        <g transform={`translate(${r1(b.cx - b.rx * 0.46)} ${r1(b.cy - b.ry * 0.5)}) scale(${r1(ws)})`}>
          <path d={EMBER_WING} fill={`url(#${uid}-accent)`} stroke={p.outline} strokeWidth={SW / ws} strokeLinejoin="round" />
          {g.markings && <path d="M-3 -2L-15.6 -8.4M-4 -0.4L-10.8 -3.6" stroke={p.accentShade} strokeWidth={1.1 / ws} strokeLinecap="round" />}
        </g>
      </g>
    );
    return (
      <g>
        <g transform={`translate(${r1(b.cx + b.rx * 0.7)} ${r1(b.cy + b.ry * 0.5)}) scale(${r1(s)})`}>
          <g className="pet-tail" style={{ transformOrigin: "0% 80%" }}>
            <path d={EMBER_TAIL} fill={`url(#${uid}-fur)`} stroke={p.outline} strokeWidth={SW / s} strokeLinejoin="round" />
            <g transform="translate(17.4 -12.8) rotate(24)">
              <g className="pet-flame" style={{ transformOrigin: "50% 100%" }}>
                <path d={flamePath(0, 0, flame / s)} fill={`url(#${uid}-flame)`} stroke={FLAME.outer} strokeWidth={0.8 / s} />
                <path d={flamePath(0, 0.6, (flame / s) * 0.55)} fill={FLAME.core} />
              </g>
            </g>
          </g>
        </g>
        {wing}
        <g transform={MIRROR_X}>{wing}</g>
      </g>
    );
  }
  return null;
}

// ─── Body: torso, belly, feet, paws ────────────────────────────────────────

export function PetBody({ uid, geometry: g, palette: p }: FigureProps) {
  const { body: b, foot, paw, species } = g;
  const socks = species === "nova" ? p.shade : `url(#${uid}-fur)`;
  const bellyRy = species === "ember" ? b.ry * 0.78 : b.ry * 0.7;
  return (
    <g className="pet-body">
      <path d={bodyPath(g)} fill={`url(#${uid}-fur)`} stroke={p.outline} strokeWidth={SW} />
      <g clipPath={`url(#${uid}-body)`}>
        <ellipse cx={b.cx} cy={b.cy + b.ry * 0.28} rx={b.rx * (species === "ember" ? 0.64 : 0.6)} ry={bellyRy} fill={`url(#${uid}-belly)`} className={g.radiant ? "pet-glow-soft" : undefined} />
        {species === "ember" && g.markings && [0.02, 0.3, 0.58].map((t) => (
          <path key={t} d={`M${r1(b.cx - b.rx * 0.42)} ${r1(b.cy + b.ry * t)}Q${b.cx} ${r1(b.cy + b.ry * (t + 0.14))} ${r1(b.cx + b.rx * 0.42)} ${r1(b.cy + b.ry * t)}`} fill="none" stroke={p.bellyShade} strokeWidth={1.3} strokeLinecap="round" />
        ))}
        {species === "fern" && g.markings && (
          <g fill={p.marking} opacity={0.9}>
            <circle cx={b.cx - b.rx * 0.8} cy={b.cy - b.ry * 0.05} r={2} />
            <circle cx={b.cx + b.rx * 0.78} cy={b.cy + b.ry * 0.1} r={1.6} />
          </g>
        )}
      </g>
      {[-1, 1].map((side) => {
        const x = b.cx + side * foot.dx;
        return (
          <g key={side}>
            {species === "fern" && (
              <path d={`M${r1(x - 2.2)} ${r1(foot.y + 3)}q-1.6 1.6 -3.8 1.4M${r1(x + 2.2)} ${r1(foot.y + 3)}q1.6 1.6 3.8 1.4M${r1(x)} ${r1(foot.y + 3.4)}v1.8`} fill="none" stroke="#a37a52" strokeWidth={1.3} strokeLinecap="round" />
            )}
            <ellipse cx={x} cy={foot.y} rx={foot.rx} ry={foot.ry} fill={socks} stroke={p.outline} strokeWidth={SW} />
            {(species === "mochi" || species === "nova") && g.stage !== "baby" && (
              <path d={`M${r1(x - 1.6)} ${r1(foot.y + 0.6)}v1.8M${r1(x + 1.6)} ${r1(foot.y + 0.6)}v1.8`} stroke={p.outline} strokeWidth={0.9} strokeLinecap="round" opacity={0.6} />
            )}
            {species === "ember" && (
              <path d={`M${r1(x - 3)} ${r1(foot.y + 2.2)}l0.6 1.6M${r1(x)} ${r1(foot.y + 2.6)}v1.6M${r1(x + 3)} ${r1(foot.y + 2.2)}l-0.6 1.6`} stroke={p.feature} strokeWidth={1.3} strokeLinecap="round" />
            )}
          </g>
        );
      })}
      {[-1, 1].map((side) => (
        <g key={side} className={`pet-paw pet-paw--${side < 0 ? "l" : "r"}`}>
          <ellipse
            cx={b.cx + side * paw.dx}
            cy={paw.y}
            rx={paw.rx}
            ry={paw.ry}
            transform={`rotate(${side * -22} ${b.cx + side * paw.dx} ${paw.y})`}
            fill={socks}
            stroke={p.outline}
            strokeWidth={SW}
          />
        </g>
      ))}
    </g>
  );
}

// ─── Head: ears, face, markings, accessories ───────────────────────────────

type HeadProps = FigureProps & {
  readonly expression: PetExpression;
  readonly accessories: PetAccessories;
};

function Ear({ className, children }: { readonly className: string; readonly children: ReactNode }) {
  return (
    <>
      <g className={`pet-ear pet-ear--l ${className}`}>{children}</g>
      <g transform={MIRROR_X}><g className={`pet-ear pet-ear--r ${className}`}>{children}</g></g>
    </>
  );
}

function EarsAndCrown({ uid, geometry: g, palette: p, hideCrown }: FigureProps & { readonly hideCrown: boolean }) {
  const { head: h, feature: f } = g;
  switch (g.species) {
    case "mochi": {
      const s = 0.72 + 0.28 * f;
      return (
        <Ear className="pet-ear--cat">
          <g transform={`translate(${r1(h.cx - h.rx * 0.52)} ${r1(h.cy - h.ry * 0.74)}) rotate(-24) scale(${r1(s)})`}>
            <path d="M-8 2Q-7.4 -8 -1.6 -13.4Q0 -14.8 1.4 -13.2Q6.6 -7.6 8 2Z" fill={`url(#${uid}-fur)`} stroke={p.outline} strokeWidth={SW / s} strokeLinejoin="round" />
            <path d="M-4.4 0Q-4 -6.2 -0.8 -9.6Q0.2 -10.4 1 -9.4Q3.8 -5.4 4.4 0Z" fill={`url(#${uid}-accent)`} />
          </g>
        </Ear>
      );
    }
    case "nova": {
      const s = 0.8 + 0.2 * f;
      return (
        <>
          <Ear className="pet-ear--fox">
            <g transform={`translate(${r1(h.cx - h.rx * 0.54)} ${r1(h.cy - h.ry * 0.68)}) rotate(-20) scale(${r1(s)})`}>
              <path d="M-8 3Q-7.6 -10 -1.4 -20.6Q0 -22.4 1.4 -20.6Q7.6 -10 8 3Z" fill={`url(#${uid}-fur)`} stroke={p.outline} strokeWidth={SW / s} strokeLinejoin="round" />
              <path d="M-4.2 1Q-3.8 -8 -0.6 -14.6Q0 -15.6 0.6 -14.6Q3.8 -8 4.2 1Z" fill={`url(#${uid}-accent)`} />
              <path d="M-3.2 -13.8Q-1.4 -21.2 0 -21.4Q1.4 -21.2 3.2 -13.8Q0 -15.4 -3.2 -13.8Z" fill={p.shade} />
            </g>
          </Ear>
          {[false, true].map((mirror) => (
            <g key={String(mirror)} transform={mirror ? MIRROR_X : undefined}>
              <path
                d={`M${r1(h.cx - h.rx * 0.9)} ${r1(h.cy + h.ry * 0.1)}Q${r1(h.cx - h.rx * 1.08)} ${r1(h.cy + h.ry * 0.3)} ${r1(h.cx - h.rx * 1.12)} ${r1(h.cy + h.ry * 0.5)}Q${r1(h.cx - h.rx * 1.04)} ${r1(h.cy + h.ry * 0.52)} ${r1(h.cx - h.rx * 0.99)} ${r1(h.cy + h.ry * 0.5)}Q${r1(h.cx - h.rx * 1.04)} ${r1(h.cy + h.ry * 0.7)} ${r1(h.cx - h.rx * 0.9)} ${r1(h.cy + h.ry * 0.82)}Q${r1(h.cx - h.rx * 0.76)} ${r1(h.cy + h.ry * 0.84)} ${r1(h.cx - h.rx * 0.6)} ${r1(h.cy + h.ry * 0.72)}Z`}
                fill={p.belly}
                stroke={p.outline}
                strokeWidth={SW}
                strokeLinejoin="round"
              />
            </g>
          ))}
        </>
      );
    }
    case "fern": {
      const s = 0.66 + 0.34 * f;
      const ss = 0.72 + 0.28 * f;
      const length = 17;
      return (
        <>
          <Ear className="pet-ear--leaf">
            <g transform={`translate(${r1(h.cx - h.rx * 0.68)} ${r1(h.cy - h.ry * 0.58)}) rotate(-44) scale(${r1(s)})`}>
              <path d={leafPath(length, 12.5)} fill={`url(#${uid}-accent)`} stroke={p.outline} strokeWidth={SW / s} strokeLinejoin="round" />
              <path d={`M0 -1Q1 ${-length * 0.5} 0 ${-length * 0.84}`} fill="none" stroke={p.accentShade} strokeWidth={1.1 / s} strokeLinecap="round" />
              {g.markings && <path d="M0.4 -6.5L3 -9.4M0.3 -10.5L-2.4 -12.8" stroke={p.accentShade} strokeWidth={0.9 / s} strokeLinecap="round" />}
            </g>
          </Ear>
          {!hideCrown && (
            <g transform={`translate(${h.cx} ${r1(h.cy - h.ry + 3)}) scale(${r1(ss)})`}>
              <g className="pet-sprout" style={{ transformOrigin: "50% 100%" }}>
                <path d="M0 2C0.6 -3 -0.8 -6.4 0.4 -10" fill="none" stroke={p.featureShade} strokeWidth={2.2 / ss} strokeLinecap="round" />
                <path d={leafPath(8.4, 6)} transform="translate(0.4 -9.4) rotate(-64)" fill={`url(#${uid}-feature)`} stroke={p.outline} strokeWidth={1.2 / ss} strokeLinejoin="round" />
                <path d={leafPath(9.6, 6.6)} transform="translate(0.4 -9.4) rotate(58)" fill={`url(#${uid}-feature)`} stroke={p.outline} strokeWidth={1.2 / ss} strokeLinejoin="round" />
                {g.markings && !g.radiant && <ellipse cx={0.4} cy={-12.6} rx={2.2} ry={2.8} fill="#ffa3b6" stroke="#d45f7c" strokeWidth={1 / ss} />}
                {g.radiant && (
                  <g className="pet-glow-mark" transform="translate(0.4 -13.4)">
                    {[0, 72, 144, 216, 288].map((angle) => <ellipse key={angle} cx={0} cy={-3} rx={2.3} ry={3.1} transform={`rotate(${angle})`} fill="#fff4b0" stroke="#e9b949" strokeWidth={0.9 / ss} />)}
                    <circle r={1.8} fill="#ffd166" />
                  </g>
                )}
              </g>
            </g>
          )}
        </>
      );
    }
    case "ember": {
      const s = 0.55 + 0.35 * f;
      const hs = 0.62 + 0.5 * f;
      return (
        <>
          {[false, true].map((mirror) => (
            <g key={String(mirror)} transform={mirror ? MIRROR_X : undefined}>
              <g transform={`translate(${r1(h.cx - h.rx * 0.38)} ${r1(h.cy - h.ry * 0.8)}) rotate(-10) scale(${r1(hs)})`}>
                <path d="M-3.6 1.6C-4 -3.6 -4.8 -8.4 -4 -12.8Q-2.6 -13 -1.4 -11C0.8 -7 2.6 -2.8 3.6 1.6Z" fill={`url(#${uid}-feature)`} stroke={p.outline} strokeWidth={SW / hs} strokeLinejoin="round" />
                {g.markings && <path d="M-3.4 -2.4Q0 -1.6 2.6 -2.8M-3.6 -6.4Q-1.4 -5.8 0.6 -6.8" fill="none" stroke={p.featureShade} strokeWidth={1 / hs} strokeLinecap="round" />}
              </g>
            </g>
          ))}
          <Ear className="pet-ear--fin">
            <g transform={`translate(${r1(h.cx - h.rx * 0.93)} ${r1(h.cy + h.ry * 0.1)}) scale(${r1(s)})`}>
              <path d="M1 -4.4Q-5 -5.4 -9.6 -10.4Q-8.6 -2.4 1 4.4Z" fill={`url(#${uid}-accent)`} stroke={p.outline} strokeWidth={SW / s} strokeLinejoin="round" />
              <path d="M-0.6 -1.6L-6.6 -6.8" stroke={p.accentShade} strokeWidth={0.9 / s} strokeLinecap="round" />
            </g>
          </Ear>
        </>
      );
    }
  }
}

function HeadMarkings({ uid, geometry: g, palette: p }: FigureProps) {
  const { head: h } = g;
  const glow = g.radiant ? "pet-glow-mark" : undefined;
  return (
    <g clipPath={`url(#${uid}-head)`}>
      {g.species === "nova" && (
        <path
          d={`M${r1(h.cx - h.rx * 1.05)} ${r1(h.cy + h.ry * 0.16)}Q${r1(h.cx - h.rx * 0.56)} ${r1(h.cy + h.ry * 0.02)} ${r1(h.cx - h.rx * 0.26)} ${r1(h.cy + h.ry * 0.4)}Q${h.cx} ${r1(h.cy + h.ry * 0.26)} ${r1(h.cx + h.rx * 0.26)} ${r1(h.cy + h.ry * 0.4)}Q${r1(h.cx + h.rx * 0.56)} ${r1(h.cy + h.ry * 0.02)} ${r1(h.cx + h.rx * 1.05)} ${r1(h.cy + h.ry * 0.16)}L${r1(h.cx + h.rx * 1.1)} ${r1(h.cy + h.ry * 1.2)}L${r1(h.cx - h.rx * 1.1)} ${r1(h.cy + h.ry * 1.2)}Z`}
          fill={`url(#${uid}-belly)`}
        />
      )}
      {g.species === "ember" && (
        <ellipse cx={h.cx} cy={h.cy + h.ry * 0.6} rx={h.rx * 0.36} ry={h.ry * 0.24} fill={p.belly} opacity={0.45} />
      )}
      <ellipse cx={h.cx - h.rx * 0.46} cy={h.cy - h.ry * 0.56} rx={h.rx * 0.26} ry={h.ry * 0.13} transform={`rotate(-28 ${h.cx - h.rx * 0.46} ${h.cy - h.ry * 0.56})`} fill="#fff" opacity={g.species === "mochi" ? 0.8 : 0.32} />
      {g.markings && g.species === "mochi" && (
        <path className={glow} d={`M${h.cx - 4.4} ${r1(h.cy - h.ry * 0.98)}v5.2M${h.cx} ${r1(h.cy - h.ry * 1.02)}v6.4M${h.cx + 4.4} ${r1(h.cy - h.ry * 0.98)}v5.2`} stroke={g.radiant ? p.glow : p.marking} strokeWidth={2.4} strokeLinecap="round" />
      )}
      {g.markings && g.species === "nova" && (
        <path className={glow} d={sparklePath(h.cx, h.cy - h.ry * 0.6, 3.6, 0.2)} fill={g.radiant ? "#fff6c8" : p.marking} />
      )}
      {g.markings && g.species === "fern" && (
        <g fill={p.marking} className={glow}>
          <circle cx={h.cx - h.rx * 0.62} cy={h.cy - h.ry * 0.5} r={2.2} />
          <circle cx={h.cx - h.rx * 0.44} cy={h.cy - h.ry * 0.7} r={1.3} />
          <circle cx={h.cx + h.rx * 0.6} cy={h.cy - h.ry * 0.56} r={1.8} />
        </g>
      )}
      {g.markings && g.species === "ember" && (
        <path className={glow} d={`M${h.cx - 3.2} ${r1(h.cy - h.ry * 0.9)}l3.2 3.4l3.2 -3.4`} fill="none" stroke={g.radiant ? "#fff0a8" : p.marking} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      )}
    </g>
  );
}

export function PetEyes({ uid, geometry: g, palette: p, state }: FigureProps & { readonly state: PetExpression["eyes"] }) {
  const { eye, head } = g;
  return (
    <g className={`pet-eyes pet-eyes--${state}`}>
      {[-1, 1].map((side) => {
        const x = head.cx + side * eye.dx;
        const { y, rx, ry } = eye;
        if (state === "happy") {
          return <path key={side} d={`M${r1(x - rx * 1.05)} ${r1(y + ry * 0.28)}Q${x} ${r1(y - ry * 0.8)} ${r1(x + rx * 1.05)} ${r1(y + ry * 0.28)}`} fill="none" stroke={p.eye} strokeWidth={2.3} strokeLinecap="round" />;
        }
        if (state === "closed") {
          return <path key={side} d={`M${r1(x - rx)} ${r1(y + ry * 0.05)}Q${x} ${r1(y + ry * 0.62)} ${r1(x + rx)} ${r1(y + ry * 0.05)}`} fill="none" stroke={p.eye} strokeWidth={2} strokeLinecap="round" />;
        }
        if (state === "half") {
          // Heavy, drooping lid: only a soft crescent of the eye shows.
          const lx = rx * 0.98;
          const edge = y + ry * 0.08;
          const sag = y + ry * 0.52;
          return (
            <g key={side} className="pet-eye">
              <g className="pet-look">
                <path d={`M${r1(x - lx)} ${r1(edge)}Q${x} ${r1(sag)} ${r1(x + lx)} ${r1(edge)}A${rx} ${ry} 0 0 1 ${r1(x - lx)} ${r1(edge)}Z`} fill={`url(#${uid}-eye)`} />
                <circle cx={x - rx * 0.28} cy={y + ry * 0.62} r={rx * 0.17} fill="#fff" opacity={0.9} />
              </g>
              <path d={`M${r1(x - rx * 1.12)} ${r1(edge - 0.3)}Q${x} ${r1(sag + 0.2)} ${r1(x + rx * 1.12)} ${r1(edge - 0.3)}`} fill="none" stroke={p.eye} strokeWidth={1.7} strokeLinecap="round" />
            </g>
          );
        }
        return (
          <g key={side} className="pet-eye">
            <g className="pet-look">
              <ellipse cx={x} cy={y} rx={rx} ry={ry} fill={`url(#${uid}-eye)`} />
              {state === "star" ? (
                <>
                  <path className="pet-star-glint" d={sparklePath(x - rx * 0.08, y - ry * 0.14, rx * 0.95, 0.16)} fill="#fff" />
                  <circle cx={x + rx * 0.42} cy={y + ry * 0.5} r={rx * 0.16} fill="#fff" opacity={0.85} />
                </>
              ) : (
                <>
                  <circle cx={x - rx * 0.3} cy={y - ry * 0.34} r={rx * 0.42} fill="#fff" />
                  <circle cx={x + rx * 0.36} cy={y + ry * 0.4} r={rx * 0.18} fill="#fff" opacity={0.85} />
                </>
              )}
            </g>
          </g>
        );
      })}
    </g>
  );
}

export function PetMouth({ geometry: g, palette: p, state }: FigureProps & { readonly state: PetExpression["mouth"] }) {
  const { head, mouthY, species, mouthScale } = g;
  const cat = species === "mochi" || species === "nova";
  const stroke = { fill: "none", stroke: p.mouth, strokeWidth: 1.3 / mouthScale, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  const fang = species === "ember" ? <path d="M1.3 0.6L2.1 2.9L3 0.4Z" fill="#fff" stroke={p.mouth} strokeWidth={0.7 / mouthScale} strokeLinejoin="round" /> : null;
  let mouth: ReactNode;
  switch (state) {
    case "open":
      mouth = (
        <>
          <path d="M-4.2 -0.4Q0 0.4 4.2 -0.4Q3.8 5.6 0 5.8Q-3.8 5.6 -4.2 -0.4Z" fill={p.mouth} stroke={p.mouth} strokeWidth={0.8} strokeLinejoin="round" />
          <path d="M-2.5 4.1Q0 2.4 2.5 4.1Q1.8 5.5 0 5.6Q-1.8 5.5 -2.5 4.1Z" fill={p.tongue} />
          {species === "ember" && <path d="M1.4 0L2.1 1.8L2.9 -0.1Z" fill="#fff" />}
        </>
      );
      break;
    case "yawn":
      mouth = (
        <g className="pet-mouth-yawn">
          <ellipse cx={0} cy={3} rx={3.3} ry={4.3} fill={p.mouth} />
          <ellipse cx={0} cy={5.3} rx={2.1} ry={1.5} fill={p.tongue} />
        </g>
      );
      break;
    case "small":
      mouth = <path d={cat ? "M-2.6 0Q-1.3 1.6 0 0.3Q1.3 1.6 2.6 0" : "M-2 0.3Q0 1.8 2 0.3"} {...stroke} />;
      break;
    case "tiny":
      mouth = <path d="M-1.3 0.8Q0 1.6 1.3 0.8" {...stroke} />;
      break;
    default:
      mouth = (
        <>
          <path d={cat ? "M-3.6 -0.4Q-1.8 2.4 0 0.2Q1.8 2.4 3.6 -0.4" : "M-3.2 0Q0 3 3.2 0"} {...stroke} />
          {fang}
        </>
      );
  }
  return (
    <g className="pet-mouth" transform={`translate(${head.cx} ${r1(mouthY)}) scale(${mouthScale})`}>
      {species === "mochi" && <path d="M-1.7 -2.9Q0 -3.3 1.7 -2.9Q0.7 -1.1 0 -1Q-0.7 -1.1 -1.7 -2.9Z" fill={p.nose} stroke={p.nose} strokeWidth={0.6} strokeLinejoin="round" />}
      {species === "nova" && <path d="M-1.9 -3Q0 -3.5 1.9 -3Q0.8 -1 0 -0.9Q-0.8 -1 -1.9 -3Z" fill={p.nose} stroke={p.nose} strokeWidth={0.6} strokeLinejoin="round" />}
      {species === "ember" && (
        <g fill={p.nose}>
          <ellipse cx={-1.9} cy={-2.8} rx={0.65} ry={0.5} />
          <ellipse cx={1.9} cy={-2.8} rx={0.65} ry={0.5} />
        </g>
      )}
      {mouth}
    </g>
  );
}

export function PetHead({ uid, geometry: g, palette: p, expression, accessories }: HeadProps) {
  const { head: h, cheek } = g;
  const hat = accessories.hat ?? null;
  const face = accessories.face ?? null;
  const hideCrown = g.species === "fern" && hatCoversCrown(hat);
  return (
    <>
      <EarsAndCrown uid={uid} geometry={g} palette={p} hideCrown={hideCrown} />
      <path className="pet-head-shape" d={headPath(g)} fill={`url(#${uid}-fur)`} stroke={p.outline} strokeWidth={SW} />
      <HeadMarkings uid={uid} geometry={g} palette={p} />
      <g className={expression.blush ? "pet-cheeks pet-cheeks--blush" : "pet-cheeks"}>
        {[-1, 1].map((side) => <ellipse key={side} cx={h.cx + side * cheek.dx} cy={cheek.y} rx={cheek.rx * 1.25} ry={cheek.ry * 1.25} fill={`url(#${uid}-cheek)`} />)}
      </g>
      <PetEyes uid={uid} geometry={g} palette={p} state={expression.eyes} />
      <PetMouth uid={uid} geometry={g} palette={p} state={expression.mouth} />
      {face && <AccessoryArt className="pet-accessory pet-accessory--face" id={face} anchor={getAccessoryAnchor(g.species, g.stage, "face")} />}
      {hat && <AccessoryArt className="pet-accessory pet-accessory--hat" id={hat} anchor={getAccessoryAnchor(g.species, g.stage, "hat")} />}
    </>
  );
}

export function PetNeck({ geometry: g, accessories }: { readonly geometry: PetGeometry; readonly accessories: PetAccessories }) {
  const neck = accessories.neck ?? null;
  if (!neck) return null;
  return <AccessoryArt className="pet-accessory pet-accessory--neck" id={neck} anchor={getAccessoryAnchor(g.species, g.stage, "neck")} />;
}

/** Radiant aura and shimmer, drawn behind the pet. */
export function PetAura({ uid, geometry: g, sparkles }: { readonly uid: string; readonly geometry: PetGeometry; readonly sparkles: number }) {
  const points: Array<[number, number, number, number]> = [[18, 40, 3.2, 0], [102, 32, 2.6, 0.7], [106, 78, 3, 1.3], [12, 84, 2.4, 1.9], [60, 6, 2.6, 0.4], [90, 100, 2, 1.6], [30, 104, 1.8, 2.2]];
  return (
    <g className="pet-aura-group">
      <ellipse className="pet-aura" cx={60} cy={g.head.cy + 14} rx={58} ry={56} fill={`url(#${uid}-glow)`} />
      {points.slice(0, sparkles).map(([x, y, r, delay]) => (
        <path key={`${x}-${y}`} className="pet-shimmer" style={vars({ "--pet-delay": `${delay}s` })} d={sparklePath(x, y, r)} fill="#fffbe6" stroke="#f4c95d" strokeWidth={0.6} />
      ))}
    </g>
  );
}
