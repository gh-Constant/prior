import { useState } from "react";

/**
 * Small single-series charts for the admin dashboard. Marks are drawn in an
 * SVG that stretches to its box; text stays in HTML so it never distorts.
 * Each chart has a hover layer: one hit column per point that shows the
 * exact value, wider than the mark itself.
 */

export type Point = { readonly label: string; readonly value: number };

type ChartProps = {
  readonly points: readonly Point[];
  readonly format: (value: number) => string;
  readonly formatLabel?: (label: string) => string;
  readonly height?: number;
  readonly ariaLabel: string;
};

const W = 600;

function niceMax(value: number): number {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const step = [1, 2, 2.5, 5, 10].find((candidate) => candidate * magnitude >= value) ?? 10;
  return step * magnitude;
}

function HoverLayer({ points, format, formatLabel, onHover, active }: Pick<ChartProps, "points" | "format" | "formatLabel"> & { onHover: (index: number | null) => void; active: number | null }) {
  return (
    <div className="admin-chart-hits" onMouseLeave={() => onHover(null)}>
      {points.map((point, index) => (
        <span
          key={point.label}
          className={active === index ? "is-active" : ""}
          onMouseEnter={() => onHover(index)}
          onFocus={() => onHover(index)}
          onBlur={() => onHover(null)}
          tabIndex={0}
          aria-label={`${formatLabel ? formatLabel(point.label) : point.label}: ${format(point.value)}`}
        />
      ))}
      {active !== null && points[active] && (
        <div
          className="admin-chart-tooltip"
          style={{ left: `${((active + 0.5) / points.length) * 100}%` }}
          role="status"
        >
          <span>{formatLabel ? formatLabel(points[active].label) : points[active].label}</span>
          <strong>{format(points[active].value)}</strong>
        </div>
      )}
    </div>
  );
}

function Axis({ max, format }: { max: number; format: (value: number) => string }) {
  return (
    <div className="admin-chart-axis" aria-hidden="true">
      <span>{format(max)}</span>
      <span>{format(max / 2)}</span>
      <span>{format(0)}</span>
    </div>
  );
}

function EdgeLabels({ points, formatLabel }: Pick<ChartProps, "points" | "formatLabel">) {
  if (points.length === 0) return null;
  const first = points[0].label;
  const last = points[points.length - 1].label;
  return (
    <div className="admin-chart-labels" aria-hidden="true">
      <span>{formatLabel ? formatLabel(first) : first}</span>
      <span>{formatLabel ? formatLabel(last) : last}</span>
    </div>
  );
}

export function ColumnChart({ points, format, formatLabel, height = 150, ariaLabel }: ChartProps) {
  const [active, setActive] = useState<number | null>(null);
  const max = niceMax(Math.max(0, ...points.map((point) => point.value)));
  return (
    <figure className="admin-chart" aria-label={ariaLabel}>
      <div className="admin-chart-frame">
        <Axis max={max} format={format} />
        <div className="admin-chart-plot" style={{ height }}>
          <svg viewBox={`0 0 ${W} 100`} preserveAspectRatio="none" aria-hidden="true">
            {[0, 50, 100].map((y) => <line key={y} x1={0} x2={W} y1={y} y2={y} className="admin-chart-grid" vectorEffect="non-scaling-stroke" />)}
          </svg>
          <div className="admin-chart-columns" aria-hidden="true">
            {points.map((point, index) => (
              <span key={point.label} className="admin-chart-slot">
                {point.value > 0 && <span className={`admin-chart-bar ${active === index ? "is-active" : ""}`} style={{ height: `${(point.value / max) * 100}%` }} />}
              </span>
            ))}
          </div>
          <HoverLayer points={points} format={format} formatLabel={formatLabel} onHover={setActive} active={active} />
        </div>
      </div>
      <EdgeLabels points={points} formatLabel={formatLabel} />
    </figure>
  );
}

export function AreaChart({ points, format, formatLabel, height = 150, ariaLabel }: ChartProps) {
  const [active, setActive] = useState<number | null>(null);
  const max = niceMax(Math.max(0, ...points.map((point) => point.value)));
  const step = W / Math.max(points.length, 1);
  const coords = points.map((point, index) => [index * step + step / 2, 100 - (point.value / max) * 100] as const);
  const line = coords.map(([x, y], index) => `${index === 0 ? "M" : "L"}${x},${y}`).join(" ");
  const area = coords.length > 0 ? `${line} L${coords[coords.length - 1][0]},100 L${coords[0][0]},100 Z` : "";
  const activePoint = active !== null ? coords[active] : null;
  return (
    <figure className="admin-chart" aria-label={ariaLabel}>
      <div className="admin-chart-frame">
        <Axis max={max} format={format} />
        <div className="admin-chart-plot" style={{ height }}>
          <svg viewBox={`0 0 ${W} 100`} preserveAspectRatio="none" aria-hidden="true">
            {[0, 50, 100].map((y) => <line key={y} x1={0} x2={W} y1={y} y2={y} className="admin-chart-grid" vectorEffect="non-scaling-stroke" />)}
            {area && <path d={area} className="admin-chart-area" />}
            {line && <path d={line} className="admin-chart-line" vectorEffect="non-scaling-stroke" />}
            {activePoint && <line x1={activePoint[0]} x2={activePoint[0]} y1={0} y2={100} className="admin-chart-crosshair" vectorEffect="non-scaling-stroke" />}
          </svg>
          {activePoint && (
            <span
              className="admin-chart-dot"
              style={{ left: `${(activePoint[0] / W) * 100}%`, top: `${activePoint[1]}%` }}
              aria-hidden="true"
            />
          )}
          <HoverLayer points={points} format={format} formatLabel={formatLabel} onHover={setActive} active={active} />
        </div>
      </div>
      <EdgeLabels points={points} formatLabel={formatLabel} />
    </figure>
  );
}

/** Labeled horizontal bars: identity comes from the label, not a color. */
export function BarList({ rows, format }: { readonly rows: ReadonlyArray<{ readonly key: string; readonly label: string; readonly value: number; readonly detail?: string }>; readonly format: (value: number) => string }) {
  const max = Math.max(1, ...rows.map((row) => row.value));
  return (
    <ul className="admin-barlist">
      {rows.map((row) => (
        <li key={row.key}>
          <div className="admin-barlist-text">
            <span>{row.label}</span>
            <strong>{format(row.value)}</strong>
          </div>
          <div className="admin-barlist-track" aria-hidden="true"><span style={{ width: `${(row.value / max) * 100}%` }} /></div>
          {row.detail && <small>{row.detail}</small>}
        </li>
      ))}
    </ul>
  );
}
