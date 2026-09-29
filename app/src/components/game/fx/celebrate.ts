// Imperative celebrations triggered by task actions: a completion burst with a flying "+XP" label,
// and the wave played when a quadrant is cleared. Both honour the effects intensity.
import { useMemo } from "react";
import { arcControlPoint, clamp, easeInOutCubic, rectCenter, type Point, type RectLike } from "../../../lib/fx/bezier";
import { emit, resolveRect, type ParticlePreset } from "../../../lib/fx/particles";
import { QUADRANT_COLOR, QUADRANT_TONES, type ConfettiTheme } from "../../../lib/fx/themes";
import { useEffectsIntensity } from "../../../lib/gamification/effects";
import type { CompletionQuadrant, EffectsIntensity } from "../../../lib/gamification/types";
import "./celebrate.css";

/** Dispatched (cancelable, bubbling) on the XP target when a flying label lands. */
export const XP_ARRIVE_EVENT = "prior:xp-arrive";
export type XpArriveDetail = { readonly xp: number };

type Origin = DOMRect | Element | RectLike;

export type CompletionCelebration = {
  readonly quadrant: CompletionQuadrant;
  /** The checkbox (or its rect) the burst starts from. */
  readonly from: Origin;
  readonly xp: number;
  /** The XP bar. Without it the label floats up and fades. */
  readonly to?: Element | null;
  readonly intensity?: EffectsIntensity;
  /** Equipped confetti theme. "classic" (default) tints the burst with the quadrant's tone. */
  readonly theme?: ConfettiTheme;
  /** Label text; defaults to `+{xp} XP`. */
  readonly label?: string;
  /** Called when the label reaches its target (immediately when effects are off). */
  readonly onArrive?: () => void;
};

type CompletionFx = { readonly preset: ParticlePreset; readonly count: number; readonly power: number };

/** Celebration scale per quadrant: Later sparkles, Focus gets the big confetti burst. */
export const COMPLETION_FX: Readonly<Record<CompletionQuadrant, CompletionFx>> = {
  later: { preset: "sparkle", count: 14, power: 0.85 },
  quick: { preset: "burst", count: 24, power: 0.6 },
  plan: { preset: "burst", count: 52, power: 0.82 },
  focus: { preset: "burst", count: 100, power: 1.05 },
};

const LABEL_Z_INDEX = 100030;

function canAnimate(): boolean {
  return typeof document !== "undefined" && typeof document.body?.animate === "function";
}

function paletteFor(quadrant: CompletionQuadrant, theme?: ConfettiTheme): readonly string[] | undefined {
  return !theme || theme === "classic" ? QUADRANT_TONES[quadrant] : undefined;
}

/** Where a flying label lands inside a target: its `[data-fx-xp-anchor]` if it has one. */
function landingPoint(target: Element): Point {
  const anchor = target.querySelector("[data-fx-xp-anchor]");
  const rect = (anchor ?? target).getBoundingClientRect();
  return rectCenter(rect.width > 0 || rect.height > 0 ? rect : target.getBoundingClientRect());
}

const place = (point: Point, scale: number) => `translate(${point.x.toFixed(1)}px, ${point.y.toFixed(1)}px) translate(-50%, -50%) scale(${scale.toFixed(3)})`;

/**
 * Keyframes for the label: pop out of the checkbox, hover for a beat, then zip along an upward arc
 * into the target, shrinking as it lands. Offsets are linear; easing is baked into the samples.
 */
export function flightKeyframes(from: Point, to: Point, steps = 22): Keyframe[] {
  const lifted = { x: from.x, y: from.y - 30 };
  const frames: Keyframe[] = [
    { offset: 0, transform: place({ x: from.x, y: from.y - 4 }, 0.45), opacity: 0 },
    { offset: 0.07, transform: place({ x: from.x, y: from.y - 20 }, 1.2), opacity: 1 },
    { offset: 0.16, transform: place({ x: from.x, y: from.y - 26 }, 0.96), opacity: 1 },
    { offset: 0.24, transform: place(lifted, 1), opacity: 1 },
  ];
  const control = arcControlPoint(lifted, to, 0.32);
  const start = 0.24;
  for (let index = 1; index <= steps; index += 1) {
    const linear = index / steps;
    const t = easeInOutCubic(linear);
    const u = 1 - t;
    const point = { x: u * u * lifted.x + 2 * u * t * control.x + t * t * to.x, y: u * u * lifted.y + 2 * u * t * control.y + t * t * to.y };
    frames.push({ offset: start + (1 - start) * linear, transform: place(point, 1 - 0.5 * t), opacity: linear < 0.85 ? 1 : 1 - (linear - 0.85) / 0.15 * 0.6 });
  }
  return frames;
}

function floatKeyframes(from: Point): Keyframe[] {
  return [
    { offset: 0, transform: place({ x: from.x, y: from.y - 4 }, 0.45), opacity: 0 },
    { offset: 0.14, transform: place({ x: from.x, y: from.y - 22 }, 1.15), opacity: 1 },
    { offset: 0.3, transform: place({ x: from.x, y: from.y - 30 }, 1), opacity: 1 },
    { offset: 1, transform: place({ x: from.x + 6, y: from.y - 78 }, 0.92), opacity: 0 },
  ];
}

function createLabel(text: string, quadrant: CompletionQuadrant, point: Point): HTMLDivElement {
  const label = document.createElement("div");
  label.className = `fx-xp-fly fx-xp-fly-${quadrant}`;
  label.setAttribute("aria-hidden", "true");
  label.style.setProperty("--fx-tone", QUADRANT_COLOR[quadrant]);
  label.style.zIndex = String(LABEL_Z_INDEX);
  label.style.transform = place(point, 0.45);
  const star = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  star.setAttribute("viewBox", "0 0 16 16");
  star.setAttribute("class", "fx-xp-fly-star");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", "M8 0.5C8.6 5 11 7.4 15.5 8C11 8.6 8.6 11 8 15.5C7.4 11 5 8.6 0.5 8C5 7.4 7.4 5 8 0.5Z");
  star.appendChild(path);
  label.append(star, document.createTextNode(text));
  document.body.appendChild(label);
  return label;
}

function arrive(target: Element | null | undefined, xp: number, intensity: EffectsIntensity): void {
  if (!target) return;
  const event = new CustomEvent<XpArriveDetail>(XP_ARRIVE_EVENT, { detail: { xp }, bubbles: true, cancelable: true });
  const handled = !target.dispatchEvent(event);
  if (!handled && intensity !== "off" && target instanceof HTMLElement && typeof target.animate === "function") {
    target.animate([{ scale: "1" }, { scale: "1.04", offset: 0.35 }, { scale: "1" }], { duration: 360, easing: "cubic-bezier(0.23, 1, 0.32, 1)" });
  }
}

/**
 * Celebrates a completed task: a burst sized by the quadrant, then a "+XP" label that flies
 * along a curve into the XP bar (which pulses) — or floats up and fades without a target.
 * Resolves when the label lands.
 */
export function celebrateCompletion({ quadrant, from, xp, to, intensity = "full", theme, label, onArrive }: CompletionCelebration): Promise<void> {
  const text = label ?? `+${xp} XP`;
  if (typeof document === "undefined") {
    onArrive?.();
    return Promise.resolve();
  }
  const origin = rectCenter(resolveRect(from));
  const fx = COMPLETION_FX[quadrant];
  emit(fx.preset, origin, { intensity, theme, colors: paletteFor(quadrant, theme), count: fx.count, power: fx.power * (intensity === "subtle" ? 0.8 : 1) });

  if (intensity === "off" || !canAnimate()) {
    // Plain feedback: the label appears and fades in place, no movement.
    arrive(to, xp, intensity);
    onArrive?.();
    if (canAnimate()) {
      const at = to ? landingPoint(to) : { x: origin.x, y: origin.y - 24 };
      const node = createLabel(text, quadrant, at);
      node.style.transform = place(at, 1);
      node.animate([{ opacity: 0 }, { opacity: 1, offset: 0.15 }, { opacity: 1, offset: 0.7 }, { opacity: 0 }], { duration: 1100, easing: "linear" }).finished.then(() => node.remove(), () => node.remove());
    }
    return Promise.resolve();
  }

  const node = createLabel(text, quadrant, origin);
  const destination = to && to.isConnected ? landingPoint(to) : null;
  const distance = destination ? Math.hypot(destination.x - origin.x, destination.y - origin.y) : 0;
  const duration = destination ? Math.round(clamp(760 + distance * 0.45, 900, 1350)) : 1050;
  const animation = node.animate(destination ? flightKeyframes(origin, destination) : floatKeyframes(origin), { duration, easing: "linear", fill: "forwards" });

  return new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      node.remove();
      if (destination) {
        emit("sparkle", destination, { intensity, theme, colors: paletteFor(quadrant, theme), count: 9, power: 0.55 });
        arrive(to, xp, intensity);
      }
      onArrive?.();
      resolve();
    };
    animation.finished.then(finish, finish);
  });
}

export type QuadrantClearedCelebration = {
  /** The quadrant panel that was just emptied. */
  readonly element: Element;
  readonly quadrant: CompletionQuadrant;
  readonly intensity?: EffectsIntensity;
  readonly theme?: ConfettiTheme;
};

/** Sweeps a wave of light and confetti across a quadrant that was just cleared. */
export function celebrateQuadrantCleared({ element, quadrant, intensity = "full", theme }: QuadrantClearedCelebration): void {
  if (typeof document === "undefined" || !canAnimate()) return;
  const rect = element.getBoundingClientRect();
  const overlay = document.createElement("div");
  overlay.className = "fx-sheen";
  overlay.setAttribute("aria-hidden", "true");
  overlay.style.setProperty("--fx-tone", QUADRANT_COLOR[quadrant]);
  Object.assign(overlay.style, {
    left: `${rect.left}px`,
    top: `${rect.top}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
    borderRadius: getComputedStyle(element).borderRadius,
  });
  const ring = document.createElement("div");
  ring.className = "fx-sheen-ring";
  overlay.appendChild(ring);
  document.body.appendChild(overlay);

  const animations: Animation[] = [ring.animate([{ opacity: 0 }, { opacity: 1, offset: 0.25 }, { opacity: 0 }], { duration: intensity === "off" ? 900 : 1300, easing: "ease-out" })];
  if (intensity !== "off") {
    const band = document.createElement("div");
    band.className = "fx-sheen-band";
    overlay.appendChild(band);
    animations.push(band.animate([{ transform: "translateX(-110%) skewX(-18deg)" }, { transform: "translateX(260%) skewX(-18deg)" }], { duration: intensity === "subtle" ? 800 : 950, easing: "cubic-bezier(0.45, 0, 0.25, 1)", fill: "both" }));
    emit("wave", rect, { intensity, theme, colors: paletteFor(quadrant, theme) });
    if (intensity === "full" && element instanceof HTMLElement) {
      // Individual `scale` so the panel's own transform is left alone.
      element.animate([{ scale: "1" }, { scale: "1.018", offset: 0.3 }, { scale: "1" }], { duration: 520, easing: "cubic-bezier(0.23, 1, 0.32, 1)" });
    }
  }
  Promise.allSettled(animations.map((animation) => animation.finished)).then(() => overlay.remove());
}

/** Celebration helpers bound to the current effects intensity. */
export function useCelebrations() {
  const intensity = useEffectsIntensity();
  return useMemo(
    () => ({
      intensity,
      celebrateCompletion: (celebration: Omit<CompletionCelebration, "intensity">) => celebrateCompletion({ ...celebration, intensity }),
      celebrateQuadrantCleared: (celebration: Omit<QuadrantClearedCelebration, "intensity">) => celebrateQuadrantCleared({ ...celebration, intensity }),
    }),
    [intensity],
  );
}
