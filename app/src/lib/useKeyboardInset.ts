import { useEffect } from "react";

/**
 * Publishes the on-screen keyboard height as `--keyboard-inset` on <html> so
 * bottom sheets can lift their sticky footer above it (iOS and Android
 * Chrome shrink the visual viewport but not the layout viewport).
 */
export function useKeyboardInset(active: boolean): void {
  useEffect(() => {
    const viewport = typeof window === "undefined" ? undefined : window.visualViewport;
    if (!active || !viewport) return undefined;
    const root = document.documentElement;
    const update = () => {
      const inset = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop);
      root.style.setProperty("--keyboard-inset", `${Math.round(inset)}px`);
    };
    viewport.addEventListener("resize", update);
    viewport.addEventListener("scroll", update);
    update();
    return () => {
      viewport.removeEventListener("resize", update);
      viewport.removeEventListener("scroll", update);
      root.style.removeProperty("--keyboard-inset");
    };
  }, [active]);
}
