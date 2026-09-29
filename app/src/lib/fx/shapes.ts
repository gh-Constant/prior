// SVG path builders for badges and medallions.
import type { Point } from "./bezier";

/** Closed SVG path through `points` with every corner rounded by `radius` (quadratic corners). */
export function roundedPolygonPath(points: readonly Point[], radius: number): string {
  const count = points.length;
  if (count < 3) return "";
  const corner = (index: number) => {
    const current = points[index];
    const previous = points[(index - 1 + count) % count];
    const next = points[(index + 1) % count];
    const toPrevious = Math.hypot(previous.x - current.x, previous.y - current.y) || 1;
    const toNext = Math.hypot(next.x - current.x, next.y - current.y) || 1;
    const r = Math.min(radius, toPrevious / 2, toNext / 2);
    return {
      start: { x: current.x + ((previous.x - current.x) / toPrevious) * r, y: current.y + ((previous.y - current.y) / toPrevious) * r },
      end: { x: current.x + ((next.x - current.x) / toNext) * r, y: current.y + ((next.y - current.y) / toNext) * r },
      vertex: current,
    };
  };
  const corners = points.map((_, index) => corner(index));
  const f = (value: number) => Number(value.toFixed(2));
  let path = `M${f(corners[0].end.x)} ${f(corners[0].end.y)}`;
  for (let index = 1; index <= count; index += 1) {
    const { start, vertex, end } = corners[index % count];
    path += `L${f(start.x)} ${f(start.y)}Q${f(vertex.x)} ${f(vertex.y)} ${f(end.x)} ${f(end.y)}`;
  }
  return `${path}Z`;
}

/** Pointy-top hexagon inscribed in a width × height box, inset by `inset`. */
export function hexagonPoints(width: number, height: number, inset = 0): Point[] {
  const left = inset;
  const right = width - inset;
  const top = inset;
  const bottom = height - inset;
  const cx = width / 2;
  const shoulder = (bottom - top) * 0.25;
  return [
    { x: cx, y: top },
    { x: right, y: top + shoulder },
    { x: right, y: bottom - shoulder },
    { x: cx, y: bottom },
    { x: left, y: bottom - shoulder },
    { x: left, y: top + shoulder },
  ];
}
