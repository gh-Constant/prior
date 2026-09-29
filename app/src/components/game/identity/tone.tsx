// Identity cosmetics must read on the light canvas and on the dark sidebar.
// A surface declares its tone once; every nameplate, frame and card below it
// picks the matching palette. A `tone` prop still overrides it locally, and
// without either the tone follows the app theme (light or dark canvas).
import { createContext, useContext, type ReactNode } from "react";
import { useEffectsIntensity, usePrefersReducedMotion } from "../../../lib/gamification/effects";
import type { EffectsIntensity } from "../../../lib/gamification/types";
import { useResolvedTheme } from "../../../lib/theme";
import "./identity.css";

export type IdentityTone = "light" | "dark";

const ToneContext = createContext<IdentityTone | null>(null);

export function IdentityToneProvider({ tone, children }: { readonly tone: IdentityTone; readonly children: ReactNode }) {
  return <ToneContext.Provider value={tone}>{children}</ToneContext.Provider>;
}

export function useIdentityTone(override?: IdentityTone): IdentityTone {
  const tone = useContext(ToneContext);
  const theme = useResolvedTheme();
  return override ?? tone ?? theme;
}

/** Effects intensity with an optional local override; prefers-reduced-motion always wins. */
export function useIdentityFx(override?: EffectsIntensity): EffectsIntensity {
  const intensity = useEffectsIntensity();
  const reduced = usePrefersReducedMotion();
  if (reduced) return "off";
  return override ?? intensity;
}

export function cx(...parts: readonly (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

/** Classes shared by every identity component root: palette tone and motion level. */
export function identityClass(tone: IdentityTone, fx: EffectsIntensity): string {
  return `gi-${tone} gi-fx-${fx}`;
}
