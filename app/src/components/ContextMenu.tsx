import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Icon, type IconName } from "./Icon";
import "./ContextMenu.css";

export type ContextMenuItem = {
  readonly label: string;
  readonly icon: IconName;
  readonly danger?: boolean;
  readonly disabled?: boolean;
  readonly run: () => void;
};

export type ContextMenuState = {
  readonly x: number;
  readonly y: number;
  readonly items: readonly ContextMenuItem[];
};

type OpenMenuEvent = {
  readonly clientX: number;
  readonly clientY: number;
  readonly target: EventTarget | null;
  preventDefault: () => void;
  stopPropagation?: () => void;
};

const MENU_WIDTH_ESTIMATE = 240;
const MENU_ITEM_HEIGHT_ESTIMATE = 40;
const MENU_CHROME_ESTIMATE = 16;
const VIEWPORT_MARGIN = 8;
const LONG_PRESS_DURATION_MS = 550;
const LONG_PRESS_MOVE_TOLERANCE_PX = 12;

function clampEstimate(x: number, y: number, itemCount: number): { x: number; y: number } {
  const width = typeof window === "undefined" ? MENU_WIDTH_ESTIMATE : Math.min(MENU_WIDTH_ESTIMATE, window.innerWidth - VIEWPORT_MARGIN * 2);
  const height = Math.min(
    itemCount * MENU_ITEM_HEIGHT_ESTIMATE + MENU_CHROME_ESTIMATE,
    (typeof window === "undefined" ? 480 : window.innerHeight) - VIEWPORT_MARGIN * 2,
  );
  const maxX = (typeof window === "undefined" ? 1024 : window.innerWidth) - width - VIEWPORT_MARGIN;
  const maxY = (typeof window === "undefined" ? 768 : window.innerHeight) - height - VIEWPORT_MARGIN;
  return {
    x: Math.max(VIEWPORT_MARGIN, Math.min(x, Math.max(VIEWPORT_MARGIN, maxX))),
    y: Math.max(VIEWPORT_MARGIN, Math.min(y, Math.max(VIEWPORT_MARGIN, maxY))),
  };
}

/** Native menus stay available inside editable fields; custom menus own every other target. */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!target || !(target instanceof HTMLElement)) return false;
  return Boolean(target.closest("input, textarea, select, [contenteditable], [contenteditable=\"true\"]"));
}

export function ContextMenu({ x, y, items, onClose }: { readonly x: number; readonly y: number; readonly items: readonly ContextMenuItem[]; readonly onClose: () => void }) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState(() => clampEstimate(x, y, items.length));

  // Clamp against the measured menu size so the menu never overflows the
  // viewport on desktop or mobile, even near the edges.
  useLayoutEffect(() => {
    const element = menuRef.current;
    if (!element) return;
    const rect = element.getBoundingClientRect();
    const width = rect.width || MENU_WIDTH_ESTIMATE;
    const height = rect.height || Math.min(items.length * MENU_ITEM_HEIGHT_ESTIMATE + MENU_CHROME_ESTIMATE, 420);
    const maxX = Math.max(VIEWPORT_MARGIN, window.innerWidth - width - VIEWPORT_MARGIN);
    const maxY = Math.max(VIEWPORT_MARGIN, window.innerHeight - height - VIEWPORT_MARGIN);
    const next = {
      x: Math.max(VIEWPORT_MARGIN, Math.min(x, maxX)),
      y: Math.max(VIEWPORT_MARGIN, Math.min(y, maxY)),
    };
    setPosition((current) => (current.x === next.x && current.y === next.y ? current : next));
  }, [x, y, items.length]);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  useEffect(() => {
    menuRef.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
  }, []);

  function moveFocus(event: React.KeyboardEvent, index: number): void {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp" && event.key !== "Home" && event.key !== "End") return;
    event.preventDefault();
    const buttons = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? []);
    if (!buttons.length) return;
    let next = index;
    if (event.key === "ArrowDown") next = (index + 1) % buttons.length;
    else if (event.key === "ArrowUp") next = (index - 1 + buttons.length) % buttons.length;
    else if (event.key === "Home") next = 0;
    else next = buttons.length - 1;
    buttons[next]?.focus();
  }

  return (
    <div
      className="context-menu-overlay"
      onClick={onClose}
      onContextMenu={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <div
        ref={menuRef}
        className="context-menu"
        role="menu"
        style={{ top: position.y, left: position.x }}
        onClick={(event) => event.stopPropagation()}
        onContextMenu={(event) => event.stopPropagation()}
      >
        {items.map((item, index) => (
          <button
            key={item.label}
            type="button"
            role="menuitem"
            className={item.danger ? "danger" : ""}
            disabled={item.disabled}
            onKeyDown={(event) => moveFocus(event, index)}
            onClick={() => {
              if (item.disabled) return;
              onClose();
              item.run();
            }}
          >
            <Icon name={item.icon} />
            <span>{item.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export function useContextMenu() {
  const [menu, setMenu] = useState<ContextMenuState | null>(null);
  const longPressTimer = useRef<number | undefined>(undefined);
  const longPressOrigin = useRef<{ x: number; y: number } | null>(null);

  const closeMenu = useCallback(() => setMenu(null), []);

  const openMenuAt = useCallback((x: number, y: number, items: readonly ContextMenuItem[]) => {
    if (!items.length) return false;
    const clamped = clampEstimate(x, y, items.length);
    setMenu({ x: clamped.x, y: clamped.y, items });
    return true;
  }, []);

  const openMenu = useCallback(
    (event: OpenMenuEvent, items: readonly ContextMenuItem[]) => {
      if (isEditableTarget(event.target)) return false;
      event.preventDefault();
      event.stopPropagation?.();
      return openMenuAt(event.clientX, event.clientY, items);
    },
    [openMenuAt],
  );

  const cancelLongPress = useCallback(() => {
    if (longPressTimer.current !== undefined) window.clearTimeout(longPressTimer.current);
    longPressTimer.current = undefined;
    longPressOrigin.current = null;
  }, []);

  useEffect(() => cancelLongPress, [cancelLongPress]);

  /** Cheap mobile fallback: opening the same menu after a sustained press. */
  const longPress = useCallback(
    (items: readonly ContextMenuItem[] | (() => readonly ContextMenuItem[])) => ({
      onTouchStart: (event: React.TouchEvent) => {
        if (isEditableTarget(event.target)) return;
        const touch = event.touches[0];
        if (!touch) return;
        cancelLongPress();
        longPressOrigin.current = { x: touch.clientX, y: touch.clientY };
        const startX = touch.clientX;
        const startY = touch.clientY;
        longPressTimer.current = window.setTimeout(() => {
          const resolved = typeof items === "function" ? items() : items;
          openMenuAt(startX, startY, resolved);
        }, LONG_PRESS_DURATION_MS);
      },
      onTouchMove: (event: React.TouchEvent) => {
        const origin = longPressOrigin.current;
        const touch = event.touches[0];
        if (!origin || !touch) return;
        if (Math.hypot(touch.clientX - origin.x, touch.clientY - origin.y) > LONG_PRESS_MOVE_TOLERANCE_PX) cancelLongPress();
      },
      onTouchEnd: cancelLongPress,
      onTouchCancel: cancelLongPress,
    }),
    [cancelLongPress, openMenuAt],
  );

  return { menu, openMenu, openMenuAt, closeMenu, longPress };
}
