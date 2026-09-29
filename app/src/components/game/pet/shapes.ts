// Small SVG path builders shared by the pet art.

const f = (value: number) => Math.round(value * 100) / 100;

type BlobOptions = {
  /** Bezier handle factor for the top half (0.55 ≈ ellipse, higher = squarer). */
  readonly kTop?: number;
  readonly kBottom?: number;
  /** Moves the widest point down (positive) as a fraction of ry. */
  readonly shift?: number;
};

/** A soft ellipse-like blob with independently squarer top/bottom halves. */
export function blobPath(cx: number, cy: number, rx: number, ry: number, { kTop = 0.56, kBottom = 0.56, shift = 0 }: BlobOptions = {}): string {
  const top = cy - ry;
  const bottom = cy + ry;
  const mid = cy + ry * shift;
  const upper = mid - top;
  const lower = bottom - mid;
  return [
    `M${f(cx)} ${f(top)}`,
    `C${f(cx + rx * kTop)} ${f(top)} ${f(cx + rx)} ${f(mid - upper * kTop)} ${f(cx + rx)} ${f(mid)}`,
    `C${f(cx + rx)} ${f(mid + lower * kBottom)} ${f(cx + rx * kBottom)} ${f(bottom)} ${f(cx)} ${f(bottom)}`,
    `C${f(cx - rx * kBottom)} ${f(bottom)} ${f(cx - rx)} ${f(mid + lower * kBottom)} ${f(cx - rx)} ${f(mid)}`,
    `C${f(cx - rx)} ${f(mid - upper * kTop)} ${f(cx - rx * kTop)} ${f(top)} ${f(cx)} ${f(top)}Z`,
  ].join("");
}

/** A scalloped cloud puff made of outward arcs. */
export function puffPath(cx: number, cy: number, r: number, bumps = 5, rotation = -90): string {
  const points = Array.from({ length: bumps }, (_, index) => {
    const angle = ((rotation + (index * 360) / bumps) * Math.PI) / 180;
    return [cx + Math.cos(angle) * r, cy + Math.sin(angle) * r] as const;
  });
  const arc = r * Math.sin(Math.PI / bumps) * 1.08;
  const [first] = points;
  let path = `M${f(first[0])} ${f(first[1])}`;
  for (let index = 1; index <= bumps; index += 1) {
    const [x, y] = points[index % bumps];
    path += `A${f(arc)} ${f(arc)} 0 0 1 ${f(x)} ${f(y)}`;
  }
  return `${path}Z`;
}

/** A four-point sparkle centred on (x, y). */
export function sparklePath(x: number, y: number, r: number, pinch = 0.18): string {
  const p = r * pinch;
  return `M${f(x)} ${f(y - r)}Q${f(x + p)} ${f(y - p)} ${f(x + r)} ${f(y)}Q${f(x + p)} ${f(y + p)} ${f(x)} ${f(y + r)}Q${f(x - p)} ${f(y + p)} ${f(x - r)} ${f(y)}Q${f(x - p)} ${f(y - p)} ${f(x)} ${f(y - r)}Z`;
}

/** A rounded heart centred on (x, y), about `size` wide. */
export function heartPath(x: number, y: number, size: number): string {
  const s = size / 2;
  return `M${f(x)} ${f(y + s * 0.85)}C${f(x - s * 0.35)} ${f(y + s * 0.55)} ${f(x - s)} ${f(y + s * 0.1)} ${f(x - s)} ${f(y - s * 0.35)}C${f(x - s)} ${f(y - s * 0.85)} ${f(x - s * 0.3)} ${f(y - s * 1.05)} ${f(x)} ${f(y - s * 0.5)}C${f(x + s * 0.3)} ${f(y - s * 1.05)} ${f(x + s)} ${f(y - s * 0.85)} ${f(x + s)} ${f(y - s * 0.35)}C${f(x + s)} ${f(y + s * 0.1)} ${f(x + s * 0.35)} ${f(y + s * 0.55)} ${f(x)} ${f(y + s * 0.85)}Z`;
}

/** An almond leaf whose base is (0,0), pointing up (negative y). */
export function leafPath(length: number, width: number): string {
  const w = width / 2;
  return `M0 0C${f(w * 1.5)} ${f(-length * 0.22)} ${f(w * 1.1)} ${f(-length * 0.78)} 0 ${f(-length)}C${f(-w * 1.1)} ${f(-length * 0.78)} ${f(-w * 1.5)} ${f(-length * 0.22)} 0 0Z`;
}

/** A soft teardrop flame whose base is (x, y), pointing up. */
export function flamePath(x: number, y: number, height: number): string {
  const w = height * 0.42;
  return `M${f(x)} ${f(y - height)}C${f(x + w * 0.35)} ${f(y - height * 0.62)} ${f(x + w)} ${f(y - height * 0.5)} ${f(x + w)} ${f(y - height * 0.22)}C${f(x + w)} ${f(y + height * 0.04)} ${f(x + w * 0.5)} ${f(y + height * 0.14)} ${f(x)} ${f(y + height * 0.14)}C${f(x - w * 0.5)} ${f(y + height * 0.14)} ${f(x - w)} ${f(y + height * 0.04)} ${f(x - w)} ${f(y - height * 0.22)}C${f(x - w)} ${f(y - height * 0.5)} ${f(x - w * 0.2)} ${f(y - height * 0.6)} ${f(x)} ${f(y - height)}Z`;
}

/** Five-point star centred on (x, y). */
export function starPath(x: number, y: number, outer: number, inner = outer * 0.48): string {
  let path = "";
  for (let index = 0; index < 10; index += 1) {
    const radius = index % 2 === 0 ? outer : inner;
    const angle = (-90 + index * 36) * (Math.PI / 180);
    path += `${index === 0 ? "M" : "L"}${f(x + Math.cos(angle) * radius)} ${f(y + Math.sin(angle) * radius)}`;
  }
  return `${path}Z`;
}

/** SVG transform that mirrors content across the pet's vertical centre line. */
export const MIRROR_X = "translate(120 0) scale(-1 1)";

export const fmt = f;
