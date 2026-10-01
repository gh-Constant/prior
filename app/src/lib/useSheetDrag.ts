import { useRef, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import { prefersReducedMotion } from "./useMediaQuery";

const CLOSE_DISTANCE = 96;
const CLOSE_FLICK_DISTANCE = 32;
const CLOSE_FLICK_SPEED = 0.6;

type DragState = { readonly startY: number; readonly startedAt: number; distance: number };

/**
 * Swipe-down-to-close for phone bottom sheets. Spread `handleProps` on the
 * grab handle (or the sheet header) and attach `sheetRef` to the sheet: the
 * sheet follows the finger, then either flies off and calls `onClose` or
 * springs back.
 */
export function useSheetDrag<T extends HTMLElement>(onClose: () => void): {
  readonly sheetRef: RefObject<T | null>;
  readonly handleProps: {
    readonly onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
    readonly onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void;
    readonly onPointerUp: (event: ReactPointerEvent<HTMLElement>) => void;
    readonly onPointerCancel: () => void;
    readonly style: { readonly touchAction: "none" };
  };
} {
  const sheetRef = useRef<T | null>(null);
  const drag = useRef<DragState | null>(null);

  function settle(transform: string, withTransition: boolean): void {
    const sheet = sheetRef.current;
    if (!sheet) return;
    sheet.style.transition = withTransition && !prefersReducedMotion() ? "transform 200ms cubic-bezier(0.32, 0.72, 0, 1)" : "none";
    sheet.style.transform = transform;
  }

  return {
    sheetRef,
    handleProps: {
      onPointerDown: (event) => {
        if (event.pointerType === "mouse" && event.button !== 0) return;
        event.currentTarget.setPointerCapture?.(event.pointerId);
        drag.current = { startY: event.clientY, startedAt: performance.now(), distance: 0 };
        const sheet = sheetRef.current;
        if (sheet) sheet.style.transition = "none";
      },
      onPointerMove: (event) => {
        const state = drag.current;
        if (!state) return;
        state.distance = Math.max(0, event.clientY - state.startY);
        const sheet = sheetRef.current;
        if (sheet) sheet.style.transform = `translateY(${state.distance}px)`;
      },
      onPointerUp: (event) => {
        const state = drag.current;
        drag.current = null;
        if (!state) return;
        event.currentTarget.releasePointerCapture?.(event.pointerId);
        const elapsed = Math.max(1, performance.now() - state.startedAt);
        const flick = state.distance > CLOSE_FLICK_DISTANCE && state.distance / elapsed > CLOSE_FLICK_SPEED;
        if (state.distance > CLOSE_DISTANCE || flick) {
          settle("translateY(100%)", true);
          window.setTimeout(onClose, prefersReducedMotion() ? 0 : 160);
        } else {
          settle("", true);
        }
      },
      onPointerCancel: () => {
        drag.current = null;
        settle("", true);
      },
      style: { touchAction: "none" },
    },
  };
}
