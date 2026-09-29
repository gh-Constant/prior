import { afterEach, describe, expect, it } from "vitest";
import { particleScale } from "../gamification/effects";
import {
  MAX_PARTICLES,
  PARTICLE_PRESETS,
  PRESET_BASE_COUNT,
  ParticlePool,
  SHAPE_PETAL,
  advanceParticle,
  disposeParticles,
  emit,
  liveParticleCount,
  particleAlpha,
  scaledCount,
  spawnPreset,
  stepParticles,
} from "./particles";

/** Deterministic pseudo-random numbers (mulberry32). */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const viewport = { width: 1200, height: 800 };
const point = { left: 300, top: 400, width: 20, height: 20 };

afterEach(() => disposeParticles());

describe("ParticlePool", () => {
  it("reuses released particle objects instead of allocating new ones", () => {
    const pool = new ParticlePool(8);
    const first = [pool.acquire(), pool.acquire(), pool.acquire()];
    expect(pool.alive).toBe(3);
    for (let index = pool.alive - 1; index >= 0; index -= 1) pool.release(index);
    expect(pool.alive).toBe(0);
    const second = [pool.acquire(), pool.acquire(), pool.acquire()];
    expect(pool.allocated).toBe(3);
    expect(new Set(second)).toEqual(new Set(first));
  });

  it("refuses particles past its capacity", () => {
    const pool = new ParticlePool(2);
    expect(pool.acquire()).not.toBeNull();
    expect(pool.acquire()).not.toBeNull();
    expect(pool.acquire()).toBeNull();
    expect(pool.alive).toBe(2);
  });

  it("keeps live particles packed when one in the middle dies", () => {
    const pool = new ParticlePool(4);
    const a = pool.acquire()!;
    const b = pool.acquire()!;
    const c = pool.acquire()!;
    pool.release(0);
    expect(pool.alive).toBe(2);
    expect(pool.items.slice(0, 2)).toEqual([c, b]);
    expect(pool.items[2]).toBe(a);
  });

  it("resets recycled particles", () => {
    const pool = new ParticlePool(1);
    const particle = pool.acquire()!;
    particle.age = 3;
    particle.homing = 1;
    particle.delay = 2;
    pool.release(0);
    const again = pool.acquire()!;
    expect(again).toBe(particle);
    expect(again.age).toBe(0);
    expect(again.homing).toBe(0);
    expect(again.delay).toBe(0);
  });
});

describe("intensity scaling", () => {
  it("scales counts by the intensity multiplier and emits nothing when off", () => {
    expect(scaledCount(60, particleScale("full"))).toBe(60);
    expect(scaledCount(60, particleScale("subtle"))).toBe(18);
    expect(scaledCount(60, particleScale("off"))).toBe(0);
    expect(scaledCount(2, particleScale("subtle"))).toBe(1);
  });

  it("spawns the preset count scaled by intensity", () => {
    for (const preset of PARTICLE_PRESETS) {
      const full = new ParticlePool(1000);
      const subtle = new ParticlePool(1000);
      expect(spawnPreset(full, preset, point, { scale: 1 }, seeded(1))).toBe(PRESET_BASE_COUNT[preset]);
      expect(spawnPreset(subtle, preset, point, { scale: 0.3 }, seeded(1))).toBe(Math.round(PRESET_BASE_COUNT[preset] * 0.3));
    }
  });

  it("never exceeds the pool cap, even for several cannons at once", () => {
    const pool = new ParticlePool(MAX_PARTICLES);
    const screen = { left: 0, top: 0, ...viewport };
    let total = 0;
    for (let shot = 0; shot < 4; shot += 1) total += spawnPreset(pool, "cannon", screen, { scale: 1 }, seeded(shot));
    expect(total).toBe(MAX_PARTICLES);
    expect(pool.alive).toBe(MAX_PARTICLES);
    expect(pool.allocated).toBe(MAX_PARTICLES);
  });

  it("does nothing without a canvas and nothing at all when effects are off", () => {
    expect(emit("burst", point, { intensity: "off" })).toBe(0);
    expect(document.querySelector(".prior-fx-canvas")).toBeNull();
    // jsdom has no 2D canvas: the engine declines quietly.
    expect(emit("burst", point, { intensity: "full" })).toBe(0);
    expect(liveParticleCount()).toBe(0);
  });
});

describe("presets", () => {
  it("uses petals for the sakura theme", () => {
    const pool = new ParticlePool(200);
    spawnPreset(pool, "burst", point, { scale: 1, theme: "sakura" }, seeded(7));
    const petals = pool.items.slice(0, pool.alive).filter((p) => p.shape === SHAPE_PETAL);
    expect(petals.length).toBeGreaterThan(10);
  });

  it("honours custom colors", () => {
    const pool = new ParticlePool(200);
    spawnPreset(pool, "burst", point, { scale: 1, colors: ["#123456"], theme: "classic" }, seeded(3));
    const colors = new Set(pool.items.slice(0, pool.alive).map((p) => p.color));
    // Glints may use the theme's glint color; everything else is the custom color.
    for (const color of colors) expect(["#123456", "#ffd66b"]).toContain(color);
  });

  it("fires cannons from both sides of the area, upwards", () => {
    const pool = new ParticlePool(400);
    const screen = { left: 0, top: 0, ...viewport };
    spawnPreset(pool, "cannon", screen, { scale: 1 }, seeded(5));
    const live = pool.items.slice(0, pool.alive);
    const left = live.filter((p) => p.x < 0);
    const right = live.filter((p) => p.x > viewport.width);
    expect(left.length).toBe(110);
    expect(right.length).toBe(110);
    expect(left.every((p) => p.vy < 0 && p.vx > 0)).toBe(true);
    expect(right.every((p) => p.vy < 0 && p.vx < 0)).toBe(true);
  });

  it("sweeps a wave from left to right", () => {
    const pool = new ParticlePool(400);
    spawnPreset(pool, "wave", { left: 0, top: 0, width: 400, height: 200 }, { scale: 1 }, seeded(9));
    const live = pool.items.slice(0, pool.alive);
    const leftDelay = live.filter((p) => p.x < 100).reduce((sum, p, _, all) => sum + p.delay / all.length, 0);
    const rightDelay = live.filter((p) => p.x > 300).reduce((sum, p, _, all) => sum + p.delay / all.length, 0);
    expect(rightDelay).toBeGreaterThan(leftDelay + 0.2);
  });

  it("flies stardust into its target", () => {
    const pool = new ParticlePool(50);
    const target = { x: 900, y: 60 };
    spawnPreset(pool, "stardust", { left: 100, top: 500, width: 80, height: 100 }, { scale: 1, target }, seeded(11));
    const particle = pool.items[0];
    particle.delay = 0;
    advanceParticle(particle, particle.life * 0.999, viewport);
    expect(Math.abs(particle.x - target.x)).toBeLessThan(6);
    expect(Math.abs(particle.y - target.y)).toBeLessThan(6);
  });
});

describe("simulation", () => {
  it("waits for a particle's delay before moving it", () => {
    const pool = new ParticlePool(1);
    spawnPreset(pool, "burst", point, { scale: 1, count: 1, delay: 0.5 }, seeded(2));
    const particle = pool.items[0];
    const start = { x: particle.x, y: particle.y };
    expect(advanceParticle(particle, 0.2, viewport)).toBe(true);
    expect(particle.x).toBe(start.x);
    expect(particleAlpha(particle)).toBe(0);
    advanceParticle(particle, 0.5, viewport);
    expect(particle.x).not.toBe(start.x);
  });

  it("falls under gravity and releases particles once their life is over", () => {
    const pool = new ParticlePool(100);
    spawnPreset(pool, "burst", point, { scale: 1, count: 40 }, seeded(4));
    for (let frame = 0; frame < 30; frame += 1) stepParticles(pool, 1 / 60, viewport);
    expect(pool.alive).toBe(40);
    for (let frame = 0; frame < 60 * 4; frame += 1) stepParticles(pool, 1 / 60, viewport);
    expect(pool.alive).toBe(0);
  });

  it("releases confetti that leaves the bottom of the screen", () => {
    const pool = new ParticlePool(1);
    spawnPreset(pool, "shower", { left: 0, top: 0, ...viewport }, { scale: 1, count: 1 }, seeded(8));
    const particle = pool.items[0];
    particle.delay = 0;
    particle.y = viewport.height + 100;
    stepParticles(pool, 1 / 60, viewport);
    expect(pool.alive).toBe(0);
  });
});
