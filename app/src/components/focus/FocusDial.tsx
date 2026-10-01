import type { ReactNode } from "react";

const SIZE = 320;
const CENTER = SIZE / 2;
const RADIUS = 128;
const TICKS = 60;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

type Props = {
  /** 0 → 1 through the current phase. */
  readonly progress: number;
  readonly running: boolean;
  readonly children: ReactNode;
};

/** The round timer face: a tick ring that lights up as the phase advances, and the progress arc. */
export function FocusDial({ progress, running, children }: Props) {
  const lit = Math.round(progress * TICKS);
  const angle = progress * 2 * Math.PI - Math.PI / 2;
  const head = { x: CENTER + RADIUS * Math.cos(angle), y: CENTER + RADIUS * Math.sin(angle) };
  return (
    <div className={`focus-dial ${running ? "is-running" : ""}`}>
      <span className="focus-dial-glow" aria-hidden="true" />
      <svg className="focus-dial-svg" viewBox={`0 0 ${SIZE} ${SIZE}`} aria-hidden="true" focusable="false">
        <g className="focus-dial-ticks">
          {Array.from({ length: TICKS }, (_, index) => {
            const tickAngle = (index / TICKS) * 2 * Math.PI - Math.PI / 2;
            const major = index % 5 === 0;
            const inner = major ? 145 : 148;
            const outer = 154;
            return (
              <line
                key={index}
                className={index < lit ? "is-lit" : ""}
                x1={CENTER + inner * Math.cos(tickAngle)}
                y1={CENTER + inner * Math.sin(tickAngle)}
                x2={CENTER + outer * Math.cos(tickAngle)}
                y2={CENTER + outer * Math.sin(tickAngle)}
                strokeWidth={major ? 2.4 : 1.4}
              />
            );
          })}
        </g>
        <circle className="focus-dial-track" cx={CENTER} cy={CENTER} r={RADIUS} />
        <circle
          className="focus-dial-progress"
          cx={CENTER}
          cy={CENTER}
          r={RADIUS}
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={CIRCUMFERENCE * (1 - progress)}
          transform={`rotate(-90 ${CENTER} ${CENTER})`}
        />
        {progress > 0.002 && <circle className="focus-dial-head" cx={head.x} cy={head.y} r={7} />}
      </svg>
      <div className="focus-dial-center">{children}</div>
    </div>
  );
}
