import { act, fireEvent } from "@testing-library/react";
import { vi } from "vitest";

// jsdom has no PointerEvent: a MouseEvent carrying the pointer fields is enough
// for Testing Library, which builds events from `window.PointerEvent`.
if (typeof window.PointerEvent === "undefined") {
  class PointerEventPolyfill extends MouseEvent {
    readonly pointerId: number;
    readonly pointerType: string;
    readonly isPrimary: boolean;

    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 0;
      this.pointerType = init.pointerType ?? "";
      this.isPrimary = init.isPrimary ?? false;
    }
  }
  Object.defineProperty(window, "PointerEvent", { configurable: true, writable: true, value: PointerEventPolyfill });
}

type PointerKind = "mouse" | "touch";

const base = (pointerType: PointerKind) => ({ pointerId: 1, pointerType, isPrimary: true, button: 0 });

/**
 * Drives a Kanban drag with Pointer Events. jsdom has no layout, so
 * `document.elementFromPoint` is stubbed to answer with the drop target.
 * `hover` runs while the card is over the target (before the drop).
 */
export function dragCard(card: HTMLElement, target: HTMLElement, options: { pointerType?: PointerKind; hover?: () => void; drop?: boolean } = {}): void {
  const pointerType = options.pointerType ?? "mouse";
  const original = document.elementFromPoint;
  document.elementFromPoint = vi.fn(() => target);
  try {
    fireEvent.pointerDown(card, { ...base(pointerType), clientX: 10, clientY: 10 });
    // A touch drag starts after a long-press (fake timers must be enabled by the test).
    if (pointerType === "touch") act(() => { vi.advanceTimersByTime(350); });
    fireEvent.pointerMove(window, { ...base(pointerType), clientX: 40, clientY: 40 });
    fireEvent.pointerMove(window, { ...base(pointerType), clientX: 80, clientY: 80 });
    options.hover?.();
    if (options.drop !== false) fireEvent.pointerUp(window, { ...base(pointerType), clientX: 80, clientY: 80 });
  } finally {
    document.elementFromPoint = original;
  }
}
