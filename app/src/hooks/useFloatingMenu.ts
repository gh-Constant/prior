import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";

export type FloatingPlacement = "bottom" | "top";

export type UseFloatingMenuOptions = {
  readonly open: boolean;
  readonly onClose?: () => void;
  readonly isPill?: boolean;
  readonly offset?: number;
  readonly minWidth?: number;
  readonly maxWidth?: number;
  readonly estimatedHeight?: number;
};

export type FloatingResult = {
  readonly style: CSSProperties;
  readonly placement: FloatingPlacement;
  readonly portalTarget: HTMLElement | null;
  readonly menuRef: React.RefObject<HTMLDivElement | null>;
  readonly updatePosition: () => void;
};

const VIEWPORT_MARGIN = 8;
const DEFAULT_OFFSET = 4;
const DEFAULT_MAX_HEIGHT = 280;
const MIN_REASONABLE_HEIGHT = 100;

export function calculateFloatingStyle(
  trigger: HTMLElement,
  menu: HTMLElement | null,
  options: Omit<UseFloatingMenuOptions, "open" | "onClose"> = {},
): { style: CSSProperties; placement: FloatingPlacement } {
  const rect = trigger.getBoundingClientRect();
  const windowWidth = typeof window !== "undefined" ? window.innerWidth : 1024;
  const windowHeight = typeof window !== "undefined" ? window.innerHeight : 768;
  const offset = options.offset ?? DEFAULT_OFFSET;
  const isPill = Boolean(options.isPill);

  // Available vertical space
  const spaceBelow = windowHeight - rect.bottom - offset - VIEWPORT_MARGIN;
  const spaceAbove = rect.top - offset - VIEWPORT_MARGIN;

  // Expected or measured height of the menu
  const menuHeight = menu?.offsetHeight || options.estimatedHeight || 200;

  // Decide whether to open upward or downward.
  // If space below is cramped (less than menuHeight or 170px) and there is more room above, flip upward.
  const openUp = spaceBelow < Math.min(menuHeight, 170) && spaceAbove > spaceBelow;
  const placement: FloatingPlacement = openUp ? "top" : "bottom";

  // Vertical placement & max height
  let top: number | undefined;
  let bottom: number | undefined;
  let maxHeight: number;

  if (openUp) {
    bottom = Math.round(windowHeight - rect.top + offset);
    maxHeight = Math.min(DEFAULT_MAX_HEIGHT, Math.max(MIN_REASONABLE_HEIGHT, Math.floor(spaceAbove)));
  } else {
    top = Math.round(rect.bottom + offset);
    maxHeight = Math.min(DEFAULT_MAX_HEIGHT, Math.max(MIN_REASONABLE_HEIGHT, Math.floor(spaceBelow)));
  }

  // Width calculation
  let minWidth: number;
  let maxWidth: number;
  let width: number | string;

  if (options.minWidth !== undefined) {
    minWidth = options.minWidth;
    maxWidth = options.maxWidth ?? Math.min(320, windowWidth - VIEWPORT_MARGIN * 2);
    width = "max-content";
  } else if (isPill) {
    minWidth = Math.max(180, Math.round(rect.width));
    maxWidth = options.maxWidth ?? Math.min(320, windowWidth - VIEWPORT_MARGIN * 2);
    width = "max-content";
  } else {
    minWidth = Math.max(130, Math.round(rect.width));
    maxWidth = Math.min(Math.max(Math.round(rect.width), 360), windowWidth - VIEWPORT_MARGIN * 2);
    width = Math.round(rect.width);
  }

  // Horizontal position (left/right alignment and clamping to screen)
  const measuredWidth = menu?.offsetWidth || (typeof width === "number" ? width : minWidth);
  let left = Math.round(rect.left);

  if (left + measuredWidth > windowWidth - VIEWPORT_MARGIN) {
    left = Math.max(VIEWPORT_MARGIN, windowWidth - VIEWPORT_MARGIN - measuredWidth);
  }
  if (left < VIEWPORT_MARGIN) {
    left = VIEWPORT_MARGIN;
  }

  const style: CSSProperties = {
    position: "fixed",
    zIndex: 99999,
    top: top !== undefined ? `${top}px` : "auto",
    bottom: bottom !== undefined ? `${bottom}px` : "auto",
    left: `${left}px`,
    right: "auto",
    minWidth: `${minWidth}px`,
    maxWidth: `${maxWidth}px`,
    maxHeight: `${maxHeight}px`,
    width: typeof width === "number" ? `${width}px` : width,
  };

  return { style, placement };
}

export function useFloatingMenu(
  triggerRef: React.RefObject<HTMLElement | null>,
  options: UseFloatingMenuOptions,
): FloatingResult {
  const menuRef = useRef<HTMLDivElement>(null);
  const [placement, setPlacement] = useState<FloatingPlacement>("bottom");
  const [style, setStyle] = useState<CSSProperties>(() => ({
    position: "fixed",
    zIndex: 99999,
    visibility: "hidden",
  }));
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);

  // Determine portal target when trigger mounts
  useLayoutEffect(() => {
    if (typeof document === "undefined") return;
    const target = triggerRef.current?.closest("dialog") || document.body;
    setPortalTarget(target);
  }, [triggerRef]);

  const updatePosition = () => {
    const trigger = triggerRef.current;
    if (!trigger || !options.open) return;

    // Check if trigger is scrolled completely outside viewport
    const rect = trigger.getBoundingClientRect();
    if (rect.bottom < -20 || rect.top > (window.innerHeight || 768) + 20) {
      options.onClose?.();
      return;
    }

    const result = calculateFloatingStyle(trigger, menuRef.current, options);
    setPlacement(result.placement);
    setStyle(result.style);
  };

  // Update immediately when opened or layout changes
  useLayoutEffect(() => {
    if (!options.open) return;
    updatePosition();
  }, [options.open, options.isPill, options.minWidth, options.maxWidth, options.offset]);

  // Track scrolling and resizing
  useEffect(() => {
    if (!options.open) return;

    // Second-pass measurement after menu is mounted to DOM with true content size
    const timer = requestAnimationFrame(() => {
      updatePosition();
    });

    const handleScrollOrResize = () => {
      updatePosition();
    };

    // Capture true is vital: it intercepts scroll events on ANY scrollable ancestor
    window.addEventListener("scroll", handleScrollOrResize, true);
    window.addEventListener("resize", handleScrollOrResize);

    return () => {
      cancelAnimationFrame(timer);
      window.removeEventListener("scroll", handleScrollOrResize, true);
      window.removeEventListener("resize", handleScrollOrResize);
    };
  }, [options.open]);

  // Click outside and Escape handling
  useEffect(() => {
    if (!options.open) return;

    function handleClickOutside(event: MouseEvent) {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      options.onClose?.();
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        options.onClose?.();
        triggerRef.current?.focus();
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [options.open, options.onClose, triggerRef]);

  return {
    style,
    placement,
    portalTarget,
    menuRef,
    updatePosition,
  };
}
