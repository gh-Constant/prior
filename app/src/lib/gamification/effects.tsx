import { createContext, useContext, useSyncExternalStore, type ReactNode } from "react";
import type { EffectsIntensity } from "./types";

const EffectsContext = createContext<EffectsIntensity>("full");

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

function subscribeReducedMotion(onChange: () => void): () => void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => undefined;
  const query = window.matchMedia(REDUCED_MOTION_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

function readReducedMotion(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(subscribeReducedMotion, readReducedMotion, () => false);
}

export function EffectsProvider({ intensity, children }: { readonly intensity: EffectsIntensity; readonly children: ReactNode }) {
  return <EffectsContext.Provider value={intensity}>{children}</EffectsContext.Provider>;
}

/** The intensity game effects should use: the user's choice, forced to "off" by prefers-reduced-motion. */
export function useEffectsIntensity(): EffectsIntensity {
  const intensity = useContext(EffectsContext);
  return usePrefersReducedMotion() ? "off" : intensity;
}

/** Particle-count multiplier for an intensity. */
export function particleScale(intensity: EffectsIntensity): number {
  return intensity === "full" ? 1 : intensity === "subtle" ? 0.3 : 0;
}
