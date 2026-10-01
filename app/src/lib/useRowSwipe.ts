import { useRef, type PointerEvent as ReactPointerEvent } from "react";
import { haptic, prefersReducedMotion } from "./useMediaQuery";

/** Distance (share of the row width) past which a swipe commits its action. */
export const SWIPE_COMMIT_RATIO = 0.35;
const ENGAGE_PX = 10;
const EDGE_GUARD_PX = 24;
const RESISTANCE = 0.45;

type Options = {
  readonly enabled: boolean;
  /** Swipe right past the threshold. */
  readonly onRight: () => void;
  /** Swipe left past the threshold. */
  readonly onLeft: () => void;
};

type Gesture = {
  readonly pointerId: number;
  startX: number;
  readonly startY: number;
  readonly width: number;
  engaged: boolean;
  ignored: boolean;
  crossed: boolean;
  offset: number;
};

/**
 * Touch swipe actions for a list row: right completes, left opens the menu.
 * The row is translated imperatively (no re-render per move); `touch-action:
 * pan-y` on the row (see TaskList.css) keeps vertical scrolling native, so a
 * vertical drag never reaches the swipe logic. Mouse and pen are ignored.
 */
export function useRowSwipe({ enabled, onRight, onLeft }: Options) {
  const rowRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const suppressClick = useRef(false);

  function paint(offset: number, width: number, animate: boolean): void {
    const row = rowRef.current;
    const wrap = wrapRef.current;
    if (!row) return;
    row.style.transition = animate && !prefersReducedMotion() ? "transform 320ms cubic-bezier(0.2, 0.9, 0.3, 1.12)" : "none";
    row.style.transform = offset ? `translate3d(${offset}px, 0, 0)` : "";
    if (!wrap) return;
    if (offset) wrap.dataset.swipe = offset > 0 ? "right" : "left";
    else delete wrap.dataset.swipe;
    wrap.style.setProperty("--swipe-progress", String(Math.min(1, Math.abs(offset) / Math.max(1, width * SWIPE_COMMIT_RATIO))));
  }

  function settle(): void {
    const state = gesture.current;
    gesture.current = null;
    if (!state?.engaged) return;
    suppressClick.current = true;
    window.setTimeout(() => { suppressClick.current = false; }, 80);
    const commit = state.crossed;
    const direction = state.offset > 0 ? "right" : "left";
    paint(0, state.width, true);
    if (commit) (direction === "right" ? onRight : onLeft)();
  }

  return {
    rowRef,
    wrapRef,
    rowProps: {
      onPointerDown: (event: ReactPointerEvent<HTMLElement>) => {
        if (!enabled || event.pointerType !== "touch" || !event.isPrimary || event.clientX < EDGE_GUARD_PX) return;
        gesture.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, width: event.currentTarget.getBoundingClientRect().width, engaged: false, ignored: false, crossed: false, offset: 0 };
      },
      onPointerMove: (event: ReactPointerEvent<HTMLElement>) => {
        const state = gesture.current;
        if (!state || state.pointerId !== event.pointerId || state.ignored) return;
        const dx = event.clientX - state.startX;
        const dy = event.clientY - state.startY;
        if (!state.engaged) {
          if (Math.abs(dy) > ENGAGE_PX && Math.abs(dy) > Math.abs(dx)) { state.ignored = true; return; }
          if (Math.abs(dx) <= ENGAGE_PX || Math.abs(dx) < Math.abs(dy) * 1.3) return;
          state.engaged = true;
          // The finger has travelled ENGAGE_PX already: the row starts from where it is.
          state.startX = event.clientX - Math.sign(dx) * 2;
          event.currentTarget.setPointerCapture?.(event.pointerId);
        }
        const raw = event.clientX - state.startX;
        const commitAt = state.width * SWIPE_COMMIT_RATIO;
        const eased = Math.abs(raw) <= commitAt ? raw : Math.sign(raw) * (commitAt + (Math.abs(raw) - commitAt) * RESISTANCE);
        state.offset = Math.max(-state.width * 0.8, Math.min(state.width * 0.8, eased));
        const crossed = Math.abs(raw) >= commitAt;
        if (crossed !== state.crossed) { state.crossed = crossed; if (crossed) haptic(10); }
        const wrap = wrapRef.current;
        if (wrap) wrap.dataset.armed = crossed ? "true" : "false";
        paint(state.offset, state.width, false);
      },
      onPointerUp: () => settle(),
      onPointerCancel: () => {
        const state = gesture.current;
        if (state) state.crossed = false;
        settle();
      },
      onClickCapture: (event: { preventDefault: () => void; stopPropagation: () => void }) => {
        if (suppressClick.current) { event.preventDefault(); event.stopPropagation(); }
      },
    },
  };
}
