import { useEffect, useState } from "react";

/** The phone layout of the app (tab bar, sheets, one-column Kanban). */
export const PHONE_QUERY = "(max-width: 760px)";

function matches(query: string): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(query).matches;
}

/** Tracks a CSS media query; false where matchMedia is unavailable (tests, SSR). */
export function useMediaQuery(query: string): boolean {
  const [value, setValue] = useState(() => matches(query));
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return undefined;
    const list = window.matchMedia(query);
    const update = () => setValue(list.matches);
    update();
    list.addEventListener?.("change", update);
    return () => list.removeEventListener?.("change", update);
  }, [query]);
  return value;
}

export function useIsPhone(): boolean {
  return useMediaQuery(PHONE_QUERY);
}

export function prefersReducedMotion(): boolean {
  return matches("(prefers-reduced-motion: reduce)");
}

/** Light haptic tick where the platform exposes one (Android WebView; iOS has none). */
export function haptic(duration = 8): void {
  try { if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") navigator.vibrate(duration); } catch { /* not allowed */ }
}
