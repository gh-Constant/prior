// Small geometry helpers for curved flights (XP labels, stardust).

export type Point = { readonly x: number; readonly y: number };

export type RectLike = { readonly left: number; readonly top: number; readonly width: number; readonly height: number };

export function rectCenter(rect: RectLike): Point {
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

/** Point on a quadratic Bézier curve at t ∈ [0, 1]. */
export function quadraticPoint(p0: Point, control: Point, p1: Point, t: number): Point {
  const u = 1 - t;
  return {
    x: u * u * p0.x + 2 * u * t * control.x + t * t * p1.x,
    y: u * u * p0.y + 2 * u * t * control.y + t * t * p1.y,
  };
}

/**
 * Control point that bends the straight line from → to into an arc.
 * The arc always bulges upward (screen space), which reads as "thrown" rather than "dropped".
 * `bend` is the bulge as a fraction of the distance.
 */
export function arcControlPoint(from: Point, to: Point, bend = 0.35): Point {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const distance = Math.hypot(dx, dy);
  const mid = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
  if (distance < 1) return { x: mid.x, y: mid.y - 40 * bend };
  // Two perpendiculars: (-dy, dx) and (dy, -dx). Pick the one pointing up.
  let nx = -dy / distance;
  let ny = dx / distance;
  if (ny > 0 || (ny === 0 && nx > 0)) {
    nx = -nx;
    ny = -ny;
  }
  return { x: mid.x + nx * distance * bend, y: mid.y + ny * distance * bend };
}

export const easeOutCubic = (t: number): number => 1 - (1 - t) ** 3;
export const easeInCubic = (t: number): number => t * t * t;
export const easeInOutCubic = (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
/** Slow start, fast finish: a label that gathers itself and then zips into its target. */
export const easeInQuart = (t: number): number => t * t * t * t;
export const easeOutBack = (t: number, overshoot = 1.7): number => 1 + (overshoot + 1) * (t - 1) ** 3 + overshoot * (t - 1) ** 2;

/** `steps + 1` points along the curve (both ends included), spaced by an easing of t. */
export function sampleQuadratic(p0: Point, control: Point, p1: Point, steps: number, ease: (t: number) => number = (t) => t): Point[] {
  const count = Math.max(1, Math.floor(steps));
  const points: Point[] = [];
  for (let index = 0; index <= count; index += 1) points.push(quadraticPoint(p0, control, p1, ease(index / count)));
  return points;
}

export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}
