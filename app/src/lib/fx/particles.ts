// Prior's shared particle engine: one lazily created full-screen canvas, pooled particles,
// and a requestAnimationFrame loop that only runs while something is alive.
// See specs/GAMIFICATION.md §8. Canvas 2D only; no allocation per frame.
import { particleScale } from "../gamification/effects";
import type { EffectsIntensity } from "../gamification/types";
import { arcControlPoint, easeInOutCubic, rectCenter, type Point, type RectLike } from "./bezier";
import { CONFETTI_THEME_SPECS, STARDUST_COLORS, shade, type ConfettiTheme } from "./themes";

export type ParticlePreset = "sparkle" | "burst" | "cannon" | "wave" | "shower" | "stardust";

export const PARTICLE_PRESETS: readonly ParticlePreset[] = ["sparkle", "burst", "cannon", "wave", "shower", "stardust"];

/** Hard cap on live particles, whatever is emitted. */
export const MAX_PARTICLES = 450;

/** Particle count per preset at full intensity. */
export const PRESET_BASE_COUNT: Readonly<Record<ParticlePreset, number>> = {
  sparkle: 16,
  burst: 60,
  cannon: 220,
  wave: 110,
  shower: 170,
  stardust: 14,
};

/** Above this the canvas costs more than it shows on high-density phones. */
const MAX_DPR = 2;
const TAU = Math.PI * 2;
/** z-index above overlays and toasts so confetti falls in front of them. */
export const FX_CANVAS_Z_INDEX = 100020;

export const SHAPE_RECT = 0;
export const SHAPE_CIRCLE = 1;
export const SHAPE_STREAMER = 2;
export const SHAPE_GLINT = 3;
export const SHAPE_PETAL = 4;
export type ParticleShape = 0 | 1 | 2 | 3 | 4;

export type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** px/s² */
  gravity: number;
  /** Velocity decay rate per second (air drag). */
  drag: number;
  /** Seconds over which drag ramps up from 30% (lets cannons fly far, then flutter). */
  dragRamp: number;
  rot: number;
  vrot: number;
  /** 3D flutter phase: one axis is scaled by cos(spin). */
  spin: number;
  vspin: number;
  w: number;
  h: number;
  shape: ParticleShape;
  color: string;
  /** Color of the back face, seen while the particle flutters over. */
  back: string;
  age: number;
  life: number;
  delay: number;
  /** Side-to-side acceleration amplitude (px/s²) and its frequency. */
  sway: number;
  swayFreq: number;
  phase: number;
  /** Non-zero: follow the quadratic path (x0,y0)→(cx,cy)→(x1,y1) over the particle's life. */
  homing: number;
  x0: number;
  y0: number;
  cx: number;
  cy: number;
  x1: number;
  y1: number;
};

function blankParticle(): Particle {
  return {
    x: 0, y: 0, vx: 0, vy: 0, gravity: 0, drag: 0, dragRamp: 0, rot: 0, vrot: 0, spin: 0, vspin: 0,
    w: 0, h: 0, shape: SHAPE_RECT, color: "#000", back: "#000", age: 0, life: 1, delay: 0,
    sway: 0, swayFreq: 0, phase: 0, homing: 0, x0: 0, y0: 0, cx: 0, cy: 0, x1: 0, y1: 0,
  };
}

function resetParticle(p: Particle): Particle {
  p.x = 0; p.y = 0; p.vx = 0; p.vy = 0; p.gravity = 0; p.drag = 0; p.dragRamp = 0;
  p.rot = 0; p.vrot = 0; p.spin = 0; p.vspin = 0; p.w = 0; p.h = 0; p.shape = SHAPE_RECT;
  p.age = 0; p.life = 1; p.delay = 0; p.sway = 0; p.swayFreq = 0; p.phase = 0; p.homing = 0;
  return p;
}

/**
 * Fixed-capacity pool. Live particles occupy `items[0 … alive)`; releasing swaps the last live
 * particle into the freed slot, so objects are created once and reused forever.
 */
export class ParticlePool {
  readonly capacity: number;
  readonly items: Particle[] = [];
  alive = 0;

  constructor(capacity = MAX_PARTICLES) {
    this.capacity = Math.max(0, Math.floor(capacity));
  }

  /** Particle objects created so far (never shrinks). */
  get allocated(): number {
    return this.items.length;
  }

  acquire(): Particle | null {
    if (this.alive >= this.capacity) return null;
    if (this.alive === this.items.length) this.items.push(blankParticle());
    return resetParticle(this.items[this.alive++]);
  }

  release(index: number): void {
    const last = this.alive - 1;
    if (index < 0 || index > last) return;
    if (index !== last) {
      const freed = this.items[index];
      this.items[index] = this.items[last];
      this.items[last] = freed;
    }
    this.alive = last;
  }

  clear(): void {
    this.alive = 0;
  }
}

/** Particles to emit for a base count at an intensity multiplier. Never zero unless the scale is. */
export function scaledCount(base: number, scale: number): number {
  if (!(scale > 0) || !(base > 0)) return 0;
  return Math.max(1, Math.round(base * scale));
}

export type SpawnOptions = {
  /** Multiplier from `particleScale(intensity)`. */
  readonly scale: number;
  readonly theme?: ConfettiTheme;
  /** Overrides the theme colors (the theme still decides glints and petals). */
  readonly colors?: readonly string[];
  /** Base count at full intensity; defaults to the preset's. */
  readonly count?: number;
  /** Velocity multiplier, default 1. */
  readonly power?: number;
  /** Stardust destination. */
  readonly target?: Point;
  /** Seconds before the first particle moves. */
  readonly delay?: number;
};

export type Viewport = { readonly width: number; readonly height: number };

type Rng = () => number;

type ShapeMix = { readonly rect: number; readonly circle: number; readonly streamer: number; readonly glint: number };

const shadeCache = new Map<string, string>();
function backColor(color: string): string {
  let back = shadeCache.get(color);
  if (!back) {
    back = shade(color, -0.22);
    shadeCache.set(color, back);
  }
  return back;
}

function pick<T>(items: readonly T[], rng: Rng): T {
  return items[Math.min(items.length - 1, Math.floor(rng() * items.length))];
}

function range(rng: Rng, min: number, max: number): number {
  return min + (max - min) * rng();
}

function pickShape(rng: Rng, mix: ShapeMix, petals: boolean): ParticleShape {
  const total = mix.rect + mix.circle + mix.streamer + mix.glint;
  let roll = rng() * total;
  if ((roll -= mix.rect) < 0) return petals ? SHAPE_PETAL : SHAPE_RECT;
  if ((roll -= mix.circle) < 0) return petals && rng() < 0.6 ? SHAPE_PETAL : SHAPE_CIRCLE;
  if ((roll -= mix.streamer) < 0) return SHAPE_STREAMER;
  return SHAPE_GLINT;
}

/** Size, spin and color for a confetti piece of the given shape. */
function dressConfetti(p: Particle, shape: ParticleShape, rng: Rng, colors: readonly string[], glint: string): void {
  p.shape = shape;
  p.color = shape === SHAPE_GLINT && rng() < 0.6 ? glint : pick(colors, rng);
  p.back = backColor(p.color);
  p.rot = rng() * TAU;
  p.vrot = range(rng, -9, 9);
  p.spin = rng() * TAU;
  p.vspin = range(rng, 5, 15) * (rng() < 0.5 ? -1 : 1);
  p.sway = range(rng, 50, 150);
  p.swayFreq = range(rng, 2.5, 6);
  p.phase = rng() * TAU;
  switch (shape) {
    case SHAPE_RECT:
      p.w = range(rng, 6, 10);
      p.h = range(rng, 3.5, 5.5);
      break;
    case SHAPE_CIRCLE:
      p.w = p.h = range(rng, 4, 6.5);
      break;
    case SHAPE_STREAMER:
      p.w = range(rng, 1.6, 2.4);
      p.h = range(rng, 11, 18);
      p.vspin *= 0.6;
      break;
    case SHAPE_GLINT:
      p.w = p.h = range(rng, 3.5, 7);
      p.vrot *= 0.3;
      break;
    case SHAPE_PETAL:
      p.w = range(rng, 6, 9);
      p.h = range(rng, 9, 13);
      p.vspin *= 0.7;
      p.sway *= 1.4;
      break;
  }
}

const BURST_MIX: ShapeMix = { rect: 50, circle: 22, streamer: 18, glint: 10 };
const CANNON_MIX: ShapeMix = { rect: 50, circle: 16, streamer: 24, glint: 10 };
const WAVE_MIX: ShapeMix = { rect: 38, circle: 20, streamer: 10, glint: 32 };
const SHOWER_MIX: ShapeMix = { rect: 55, circle: 15, streamer: 20, glint: 10 };

/**
 * Writes the particles of a preset into the pool. Pure apart from the pool and the rng,
 * which makes it testable without a canvas. Returns the number of particles spawned.
 */
export function spawnPreset(pool: ParticlePool, preset: ParticlePreset, rect: RectLike, options: SpawnOptions, rng: Rng = Math.random): number {
  const count = scaledCount(options.count ?? PRESET_BASE_COUNT[preset], options.scale);
  if (count === 0) return 0;
  const theme = CONFETTI_THEME_SPECS[options.theme ?? "classic"];
  const colors = options.colors && options.colors.length > 0 ? options.colors : theme.colors;
  const petals = theme.petals === true;
  const power = options.power ?? 1;
  const baseDelay = Math.max(0, options.delay ?? 0);
  const center = rectCenter(rect);
  let spawned = 0;

  for (let index = 0; index < count; index += 1) {
    const p = pool.acquire();
    if (!p) break;
    spawned += 1;

    switch (preset) {
      case "sparkle": {
        const angle = rng() * TAU;
        const speed = range(rng, 60, 250) * power;
        p.shape = rng() < 0.62 ? SHAPE_GLINT : SHAPE_CIRCLE;
        p.color = p.shape === SHAPE_GLINT && rng() < 0.5 ? theme.glint : pick(colors, rng);
        p.back = p.color;
        p.w = p.h = p.shape === SHAPE_GLINT ? range(rng, 3.5, 7.5) : range(rng, 2.2, 4);
        p.x = center.x + (rng() - 0.5) * rect.width * 0.4;
        p.y = center.y + (rng() - 0.5) * rect.height * 0.4;
        p.vx = Math.cos(angle) * speed;
        p.vy = Math.sin(angle) * speed - 50 * power;
        p.gravity = 180;
        p.drag = 3.4;
        p.rot = rng() * TAU;
        p.vrot = range(rng, -3, 3);
        p.life = range(rng, 0.45, 0.85);
        p.delay = baseDelay + rng() * 0.06;
        break;
      }
      case "burst": {
        dressConfetti(p, pickShape(rng, BURST_MIX, petals), rng, colors, theme.glint);
        const angle = -Math.PI / 2 + (rng() - 0.5) * Math.PI * 0.95;
        const speed = (260 + rng() ** 0.8 * 700) * power;
        p.x = center.x + (rng() - 0.5) * Math.min(rect.width, 24);
        p.y = center.y + (rng() - 0.5) * Math.min(rect.height, 24);
        p.vx = Math.cos(angle) * speed;
        p.vy = Math.sin(angle) * speed;
        p.gravity = range(rng, 1050, 1250);
        p.drag = range(rng, 2.8, 3.6);
        p.dragRamp = 0.45;
        p.life = range(rng, 1.4, 2.4);
        p.delay = baseDelay + rng() * 0.04;
        break;
      }
      case "cannon": {
        dressConfetti(p, pickShape(rng, CANNON_MIX, petals), rng, colors, theme.glint);
        const left = index % 2 === 0;
        const aim = -Math.PI / 2 + (left ? 0.42 : -0.42) + (rng() - 0.5) * 0.55;
        const reach = Math.min(2400, Math.max(1000, rect.height * 2.2));
        const speed = reach * range(rng, 0.55, 1.08) * power;
        p.x = left ? rect.left - 6 : rect.left + rect.width + 6;
        p.y = rect.top + rect.height * 0.96 + (rng() - 0.5) * 20;
        p.vx = Math.cos(aim) * speed;
        p.vy = Math.sin(aim) * speed;
        p.gravity = 780;
        p.drag = range(rng, 2.5, 3.2);
        p.dragRamp = 1.1;
        p.life = range(rng, 3.2, 4.4);
        p.delay = baseDelay + rng() ** 1.6 * 0.3;
        break;
      }
      case "wave": {
        dressConfetti(p, pickShape(rng, WAVE_MIX, petals), rng, colors, theme.glint);
        const across = rng();
        const lift = Math.sqrt(Math.max(0.5, rect.height / 260));
        p.x = rect.left + across * rect.width;
        p.y = rect.top + rect.height * range(rng, 0.55, 1);
        p.vx = range(rng, 30, 150) * power;
        p.vy = -range(rng, 340, 780) * lift * power;
        p.gravity = 1100;
        p.drag = range(rng, 2.4, 3.2);
        p.life = range(rng, 1, 1.7);
        p.delay = baseDelay + across * 0.5 + rng() * 0.05;
        break;
      }
      case "shower": {
        dressConfetti(p, pickShape(rng, SHOWER_MIX, petals), rng, colors, theme.glint);
        p.x = rect.left + rng() * rect.width;
        p.y = rect.top - range(rng, 16, 90);
        p.vx = (rng() - 0.5) * 90;
        p.vy = range(rng, 60, 200) * power;
        p.gravity = 720;
        p.drag = range(rng, 2.2, 2.8);
        p.life = range(rng, 4.5, 6);
        p.delay = baseDelay + rng() * 1.1;
        break;
      }
      case "stardust": {
        const target = options.target ?? { x: center.x, y: rect.top - 120 };
        p.shape = SHAPE_GLINT;
        p.color = pick(STARDUST_COLORS, rng);
        p.back = p.color;
        p.w = p.h = range(rng, 2.6, 5);
        p.x0 = rect.left + rng() * rect.width;
        p.y0 = rect.top + rng() * rect.height;
        p.x1 = target.x + (rng() - 0.5) * 6;
        p.y1 = target.y + (rng() - 0.5) * 6;
        const control = arcControlPoint({ x: p.x0, y: p.y0 }, { x: p.x1, y: p.y1 }, range(rng, 0.15, 0.55));
        p.cx = control.x + (rng() - 0.5) * 80;
        p.cy = control.y + (rng() - 0.5) * 40;
        p.x = p.x0;
        p.y = p.y0;
        p.homing = 1;
        p.rot = rng() * TAU;
        p.vrot = range(rng, -4, 4);
        p.life = range(rng, 0.7, 1.05);
        p.delay = baseDelay + rng() * 0.3;
        break;
      }
    }
  }
  return spawned;
}

/** Advances one particle. Returns false once it has died. */
export function advanceParticle(p: Particle, dt: number, viewport: Viewport, wind = 14): boolean {
  let t = dt;
  if (p.delay > 0) {
    p.delay -= t;
    if (p.delay > 0) return true;
    t = -p.delay;
    p.delay = 0;
  }
  p.age += t;
  if (p.age >= p.life) return false;
  p.rot += p.vrot * t;

  if (p.homing) {
    const k = easeInOutCubic(p.age / p.life);
    const u = 1 - k;
    p.x = u * u * p.x0 + 2 * u * k * p.cx + k * k * p.x1;
    p.y = u * u * p.y0 + 2 * u * k * p.cy + k * k * p.y1;
    return true;
  }

  // Flat pieces catch more air when they face the fall, which is what makes paper flutter.
  const flat = p.shape === SHAPE_RECT || p.shape === SHAPE_PETAL || p.shape === SHAPE_STREAMER;
  const face = flat ? Math.abs(Math.cos(p.spin)) : 0.6;
  const ramp = p.dragRamp > 0 && p.age < p.dragRamp ? 0.3 + 0.7 * (p.age / p.dragRamp) : 1;
  const damping = Math.exp(-p.drag * (0.45 + face) * ramp * t);
  p.vx = p.vx * damping + (wind + p.sway * Math.sin(p.age * p.swayFreq + p.phase)) * t;
  p.vy = p.vy * damping + p.gravity * t;
  p.x += p.vx * t;
  p.y += p.vy * t;
  p.spin += p.vspin * t;
  return !(p.y > viewport.height + 60 || p.x < -120 || p.x > viewport.width + 120);
}

/** Advances every live particle and releases the dead ones. */
export function stepParticles(pool: ParticlePool, dt: number, viewport: Viewport, wind?: number): void {
  for (let index = pool.alive - 1; index >= 0; index -= 1) {
    if (!advanceParticle(pool.items[index], dt, viewport, wind)) pool.release(index);
  }
}

export function particleAlpha(p: Particle): number {
  if (p.delay > 0) return 0;
  const t = p.age / p.life;
  const fadeIn = Math.min(1, p.age / 0.06);
  const tail = p.homing ? 0.85 : 0.72;
  const fadeOut = t > tail ? 1 - (t - tail) / (1 - tail) : 1;
  return Math.max(0, fadeIn * fadeOut);
}

function drawParticles(ctx: CanvasRenderingContext2D, pool: ParticlePool, dpr: number, width: number, height: number): void {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, width, height);
  ctx.lineCap = "round";
  for (let index = 0; index < pool.alive; index += 1) {
    const p = pool.items[index];
    const alpha = particleAlpha(p);
    if (alpha <= 0.01) continue;
    ctx.globalAlpha = alpha;
    const cos = Math.cos(p.rot) * dpr;
    const sin = Math.sin(p.rot) * dpr;
    const x = p.x * dpr;
    const y = p.y * dpr;

    switch (p.shape) {
      case SHAPE_RECT:
      case SHAPE_PETAL: {
        const flip = Math.cos(p.spin);
        const sy = flip >= 0 ? Math.max(0.1, flip) : Math.min(-0.1, flip);
        ctx.fillStyle = flip >= 0 ? p.color : p.back;
        ctx.setTransform(cos, sin, -sin * sy, cos * sy, x, y);
        if (p.shape === SHAPE_RECT) {
          ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        } else {
          const hw = p.w / 2;
          const hh = p.h / 2;
          ctx.beginPath();
          ctx.moveTo(0, -hh);
          ctx.bezierCurveTo(hw * 1.25, -hh * 0.7, hw, hh * 0.6, 0, hh);
          ctx.bezierCurveTo(-hw, hh * 0.6, -hw * 1.25, -hh * 0.7, 0, -hh);
          ctx.fill();
        }
        break;
      }
      case SHAPE_CIRCLE: {
        const sx = Math.max(0.25, Math.abs(Math.cos(p.spin)));
        ctx.fillStyle = p.color;
        ctx.setTransform(cos * sx, sin * sx, -sin, cos, x, y);
        ctx.beginPath();
        ctx.arc(0, 0, p.w / 2, 0, TAU);
        ctx.fill();
        break;
      }
      case SHAPE_STREAMER: {
        const bend = Math.sin(p.spin) * p.h * 0.4;
        const hh = p.h / 2;
        ctx.strokeStyle = Math.cos(p.spin) >= 0 ? p.color : p.back;
        ctx.lineWidth = p.w;
        ctx.setTransform(cos, sin, -sin, cos, x, y);
        ctx.beginPath();
        ctx.moveTo(0, -hh);
        ctx.bezierCurveTo(bend, -hh / 3, -bend, hh / 3, 0, hh);
        ctx.stroke();
        break;
      }
      case SHAPE_GLINT: {
        // Four-point star that swells and twinkles over its life.
        const life = p.age / p.life;
        const twinkle = Math.sin(Math.PI * Math.min(1, life * 1.15)) * (0.78 + 0.22 * Math.sin(p.age * 26 + p.phase));
        const r = p.w * Math.max(0.05, twinkle);
        ctx.fillStyle = p.color;
        ctx.setTransform(cos, sin, -sin, cos, x, y);
        ctx.beginPath();
        ctx.moveTo(0, -r);
        ctx.quadraticCurveTo(0, 0, r, 0);
        ctx.quadraticCurveTo(0, 0, 0, r);
        ctx.quadraticCurveTo(0, 0, -r, 0);
        ctx.quadraticCurveTo(0, 0, 0, -r);
        ctx.fill();
        break;
      }
    }
  }
  ctx.globalAlpha = 1;
}

// ── Singleton canvas overlay ────────────────────────────────────────────────

type Engine = {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  readonly pool: ParticlePool;
  raf: number;
  last: number;
  width: number;
  height: number;
  dpr: number;
  sizeDirty: boolean;
  readonly onResize: () => void;
  readonly onVisibility: () => void;
};

let engine: Engine | null = null;

function canUseCanvas(): boolean {
  if (typeof window === "undefined" || typeof document === "undefined" || !document.body) return false;
  if (typeof requestAnimationFrame !== "function") return false;
  // jsdom has no 2D context and logs noisily when asked for one.
  return !(typeof navigator !== "undefined" && /jsdom/i.test(navigator.userAgent));
}

function resize(target: Engine): void {
  const dpr = Math.min(MAX_DPR, Math.max(1, window.devicePixelRatio || 1));
  const width = window.innerWidth;
  const height = window.innerHeight;
  target.sizeDirty = false;
  if (width === target.width && height === target.height && dpr === target.dpr) return;
  target.width = width;
  target.height = height;
  target.dpr = dpr;
  target.canvas.width = Math.round(width * dpr);
  target.canvas.height = Math.round(height * dpr);
  target.canvas.style.width = `${width}px`;
  target.canvas.style.height = `${height}px`;
}

function idle(target: Engine): void {
  if (target.raf) cancelAnimationFrame(target.raf);
  target.raf = 0;
  target.ctx.setTransform(1, 0, 0, 1, 0, 0);
  target.ctx.clearRect(0, 0, target.canvas.width, target.canvas.height);
  // A hidden canvas drops out of compositing entirely.
  target.canvas.style.display = "none";
}

function frame(now: number): void {
  const target = engine;
  if (!target) return;
  const dt = Math.min(1 / 30, Math.max(0, (now - target.last) / 1000));
  target.last = now;
  if (target.sizeDirty) resize(target);
  stepParticles(target.pool, dt, target);
  if (target.pool.alive === 0) {
    idle(target);
    return;
  }
  drawParticles(target.ctx, target.pool, target.dpr, target.canvas.width, target.canvas.height);
  target.raf = requestAnimationFrame(frame);
}

function ensureEngine(): Engine | null {
  if (engine) {
    if (!engine.canvas.isConnected) document.body.appendChild(engine.canvas);
    return engine;
  }
  if (!canUseCanvas()) return null;
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  canvas.className = "prior-fx-canvas";
  canvas.setAttribute("aria-hidden", "true");
  Object.assign(canvas.style, {
    position: "fixed",
    left: "0",
    top: "0",
    pointerEvents: "none",
    zIndex: String(FX_CANVAS_Z_INDEX),
    display: "none",
    contain: "strict",
  });
  document.body.appendChild(canvas);
  const created: Engine = {
    canvas,
    ctx,
    pool: new ParticlePool(MAX_PARTICLES),
    raf: 0,
    last: 0,
    width: 0,
    height: 0,
    dpr: 1,
    sizeDirty: true,
    onResize: () => {
      created.sizeDirty = true;
    },
    onVisibility: () => {
      if (!document.hidden) return;
      created.pool.clear();
      idle(created);
    },
  };
  window.addEventListener("resize", created.onResize, { passive: true });
  document.addEventListener("visibilitychange", created.onVisibility);
  engine = created;
  return created;
}

function start(target: Engine): void {
  if (target.raf) return;
  target.canvas.style.display = "block";
  target.last = performance.now();
  target.raf = requestAnimationFrame(frame);
}

export type FxOrigin = Point | RectLike | Element;

export type EmitOptions = Omit<SpawnOptions, "scale" | "target"> & {
  /** Scales the particle count; "off" emits nothing. Defaults to "full". */
  readonly intensity?: EffectsIntensity;
  /** Stardust destination. */
  readonly target?: FxOrigin;
};

function isElement(value: unknown): value is Element {
  return typeof Element !== "undefined" && value instanceof Element;
}

/** Viewport rectangle of an origin: an element, a DOMRect-like box, or a point. */
export function resolveRect(origin: FxOrigin): RectLike {
  if (isElement(origin)) return origin.getBoundingClientRect();
  if ("width" in origin) return origin;
  return { left: origin.x, top: origin.y, width: 0, height: 0 };
}

export function viewportRect(): RectLike {
  return typeof window === "undefined" ? { left: 0, top: 0, width: 0, height: 0 } : { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
}

/**
 * Emits a preset from an origin, in viewport coordinates.
 * `cannon` and `shower` treat the origin as the area to cover (pass `viewportRect()` for the screen);
 * `wave` sweeps across its rectangle; `stardust` flies to `options.target`.
 * Returns the number of particles emitted (0 when effects are off or the page is hidden).
 */
export function emit(preset: ParticlePreset, origin: FxOrigin, options: EmitOptions = {}): number {
  const scale = particleScale(options.intensity ?? "full");
  if (scale <= 0 || (typeof document !== "undefined" && document.hidden)) return 0;
  const target = ensureEngine();
  if (!target) return 0;
  if (target.sizeDirty || target.width === 0) resize(target);
  const destination = options.target ? rectCenter(resolveRect(options.target)) : undefined;
  const spawned = spawnPreset(target.pool, preset, resolveRect(origin), { ...options, scale, target: destination });
  if (spawned > 0) start(target);
  return spawned;
}

export function liveParticleCount(): number {
  return engine?.pool.alive ?? 0;
}

/** Drops every live particle immediately. */
export function clearParticles(): void {
  if (!engine) return;
  engine.pool.clear();
  idle(engine);
}

/** Removes the canvas and listeners (tests, hot reload). The next emit recreates them. */
export function disposeParticles(): void {
  if (!engine) return;
  idle(engine);
  window.removeEventListener("resize", engine.onResize);
  document.removeEventListener("visibilitychange", engine.onVisibility);
  engine.canvas.remove();
  engine = null;
}
