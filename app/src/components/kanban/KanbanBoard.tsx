import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { useI18n } from "../../lib/i18n";
import { haptic, PHONE_QUERY, prefersReducedMotion } from "../../lib/useMediaQuery";
import { ContextMenu, useContextMenu, type ContextMenuItem } from "../ContextMenu";
import { Icon } from "../Icon";
import "./Kanban.css";

/**
 * Generic, state-driven Kanban board shared by project boards, the All tasks
 * board and the agile project board (specs/KANBAN.md).
 *
 * - Drag and drop uses Pointer Events, so it works with mouse, pen and touch.
 *   A mouse or pen drag starts after 4px of movement; a touch drag starts after
 *   a ~300ms long-press (so vertical scrolling keeps working). A long-press
 *   released without moving opens the card menu instead.
 * - On phones every column is one screen wide (scroll-snap) and a sticky row
 *   of column pills sits above them: tapping a pill scrolls to the column and,
 *   while dragging, the pills are drop targets.
 * - Keyboard: a focused card opens its menu with the context-menu key, which
 *   always lists "Move to …" for every other column.
 */

export type KanbanColumn<T> = {
  readonly id: string;
  readonly label: string;
  readonly glyph?: ReactNode;
  readonly items: readonly T[];
  /** Offer a "+" button creating an item directly in this column. */
  readonly canAdd?: boolean;
  /** False for columns that cannot receive cards (default true). */
  readonly canDrop?: boolean;
  /** Show only this many cards behind a "show more" toggle. */
  readonly previewCount?: number;
};

type Props<T extends { readonly id: string }> = {
  readonly columns: readonly KanbanColumn<T>[];
  /** Accessible name of the board. */
  readonly label: string;
  /** Card content; the board provides the draggable card around it. */
  readonly renderCard: (item: T) => ReactNode;
  /** Moves a card to a column. A rejection is shown inside the board. */
  readonly onMove: (itemId: string, columnId: string) => Promise<void> | void;
  readonly onAdd?: (columnId: string) => void;
  /** Extra menu entries ("Move to …" entries are added by the board). */
  readonly menuItems?: (item: T) => ContextMenuItem[];
  readonly canDrag?: (item: T) => boolean;
  readonly itemClassName?: (item: T) => string;
  /** Extra class on the board element. */
  readonly className?: string;
  /** Text of the empty-column placeholder. */
  readonly emptyLabel: string;
  /** Class added to a column while a card hovers it (kept for existing styling hooks). */
  readonly dropTargetClassName?: string;
};

const TOUCH_HOLD_MS = 300;
const MOUSE_SLOP_PX = 4;
const TOUCH_SCROLL_SLOP_PX = 8;
const EDGE_ZONE_PX = 56;
const MAX_SCROLL_STEP_PX = 18;
const NO_DRAG_SELECTOR = "[data-kanban-nodrag], input, select, textarea, [role='combobox'], [role='listbox']";

type Pending = {
  readonly id: string;
  readonly from: string;
  readonly pointerId: number;
  readonly touch: boolean;
  readonly startX: number;
  readonly startY: number;
  readonly element: HTMLElement;
  x: number;
  y: number;
  armed: boolean;
  active: boolean;
  timer?: number;
  raf?: number;
  ghost?: HTMLElement;
  target: string | null;
};

function scrollParentOf(element: HTMLElement | null): HTMLElement | null {
  for (let node = element?.parentElement ?? null; node; node = node.parentElement) {
    const overflow = getComputedStyle(node).overflowY;
    if ((overflow === "auto" || overflow === "scroll") && node.scrollHeight > node.clientHeight) return node;
  }
  return null;
}

export function KanbanBoard<T extends { readonly id: string }>({ columns, label, renderCard, onMove, onAdd, menuItems, canDrag, itemClassName, className = "", emptyLabel, dropTargetClassName = "" }: Props<T>) {
  const { t, tp } = useI18n();
  const contextMenu = useContextMenu();
  const rootRef = useRef<HTMLDivElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const pillsRef = useRef<HTMLElement>(null);
  const pendingRef = useRef<Pending | null>(null);
  const suppressClickRef = useRef(false);
  const lastTouchRef = useRef(0);
  const [dragging, setDragging] = useState<{ readonly id: string; readonly from: string } | null>(null);
  const [armedId, setArmedId] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [activeColumn, setActiveColumn] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const [error, setError] = useState("");

  // The window-level listeners below must always see the latest props.
  const latest = useRef({ columns, onMove, menuItems, canDrag, t });
  latest.current = { columns, onMove, menuItems, canDrag, t };

  const findItem = useCallback((id: string): { item: T; columnId: string } | null => {
    for (const column of latest.current.columns) {
      const item = column.items.find((candidate) => candidate.id === id);
      if (item) return { item, columnId: column.id };
    }
    return null;
  }, []);

  const commit = useCallback(async (itemId: string, columnId: string) => {
    setError("");
    try {
      await latest.current.onMove(itemId, columnId);
    } catch (cause) {
      setError(cause instanceof Error && cause.message ? cause.message : latest.current.t("kanban.moveError"));
    }
  }, []);

  useEffect(() => {
    if (!error) return undefined;
    const timer = window.setTimeout(() => setError(""), 6000);
    return () => window.clearTimeout(timer);
  }, [error]);

  const cardMenu = useCallback((item: T, columnId: string): ContextMenuItem[] => {
    const current = latest.current;
    const moves = current.columns
      .filter((column) => column.id !== columnId && column.canDrop !== false)
      .map((column): ContextMenuItem => ({
        icon: "arrow",
        label: current.t("kanban.moveTo", { column: column.label }),
        run: () => { void commit(item.id, column.id); },
      }));
    return [...(current.menuItems?.(item) ?? []), ...moves];
  }, [commit]);

  function openMenuFor(itemId: string, x: number, y: number): void {
    const found = findItem(itemId);
    if (found) contextMenu.openMenuAt(x, y, cardMenu(found.item, found.columnId));
  }

  /* ── Drag and drop ─────────────────────────────────────────────────── */

  function targetAt(x: number, y: number): string | null {
    const root = rootRef.current;
    const hit = typeof document.elementFromPoint === "function" ? document.elementFromPoint(x, y) : null;
    if (!root || !hit || !root.contains(hit)) return null;
    const holder = hit.closest<HTMLElement>("[data-kanban-pill], [data-kanban-column]");
    const id = holder?.dataset.kanbanPill ?? holder?.dataset.kanbanColumn ?? null;
    if (!id) return null;
    return latest.current.columns.find((column) => column.id === id)?.canDrop === false ? null : id;
  }

  function updateTarget(pending: Pending): void {
    const next = targetAt(pending.x, pending.y);
    if (next !== pending.target) {
      pending.target = next;
      setHover(next);
    }
  }

  // Window listeners need a stable identity to be removable, but must run the
  // latest handlers: they forward through this ref.
  const handlers = useRef({ move: (_event: PointerEvent) => {}, up: (_event: PointerEvent) => {}, cancel: () => {}, key: (_event: KeyboardEvent) => {} });
  const listeners = useRef({
    move: (event: PointerEvent) => handlers.current.move(event),
    up: (event: PointerEvent) => handlers.current.up(event),
    cancel: () => handlers.current.cancel(),
    key: (event: KeyboardEvent) => handlers.current.key(event),
  });

  function addListeners(): void {
    window.addEventListener("pointermove", listeners.current.move);
    window.addEventListener("pointerup", listeners.current.up);
    window.addEventListener("pointercancel", listeners.current.cancel);
    window.addEventListener("keydown", listeners.current.key, true);
    window.addEventListener("blur", listeners.current.cancel);
  }

  function removeListeners(): void {
    window.removeEventListener("pointermove", listeners.current.move);
    window.removeEventListener("pointerup", listeners.current.up);
    window.removeEventListener("pointercancel", listeners.current.cancel);
    window.removeEventListener("keydown", listeners.current.key, true);
    window.removeEventListener("blur", listeners.current.cancel);
  }

  function disposeGhost(pending: Pending, snapBack: boolean): void {
    const ghost = pending.ghost;
    pending.ghost = undefined;
    if (!ghost) return;
    if (snapBack && !prefersReducedMotion()) {
      ghost.style.transition = "transform 180ms cubic-bezier(0.32, 0.72, 0, 1), opacity 180ms ease";
      ghost.style.transform = "translate3d(0, 0, 0)";
      ghost.style.opacity = "0";
      window.setTimeout(() => ghost.remove(), 190);
    } else {
      ghost.remove();
    }
  }

  function finish(pending: Pending, snapBack: boolean): void {
    if (pending.timer !== undefined) window.clearTimeout(pending.timer);
    if (pending.raf !== undefined) cancelAnimationFrame(pending.raf);
    disposeGhost(pending, snapBack);
    removeListeners();
    pendingRef.current = null;
    setDragging(null);
    setArmedId(null);
    setHover(null);
  }

  function swallowNextClick(): void {
    suppressClickRef.current = true;
    window.setTimeout(() => { suppressClickRef.current = false; }, 60);
  }

  function tick(): void {
    const pending = pendingRef.current;
    if (!pending?.active) return;
    const scroller = scrollerRef.current;
    if (scroller) {
      const rect = scroller.getBoundingClientRect();
      if (pending.x < rect.left + EDGE_ZONE_PX) scroller.scrollLeft -= MAX_SCROLL_STEP_PX * Math.min(1, (rect.left + EDGE_ZONE_PX - pending.x) / EDGE_ZONE_PX);
      else if (pending.x > rect.right - EDGE_ZONE_PX) scroller.scrollLeft += MAX_SCROLL_STEP_PX * Math.min(1, (pending.x - (rect.right - EDGE_ZONE_PX)) / EDGE_ZONE_PX);
    }
    const parent = scrollParentOf(scroller);
    const phone = window.matchMedia?.(PHONE_QUERY).matches ?? false;
    const topEdge = Math.max(parent ? parent.getBoundingClientRect().top : 0, pillsRef.current && phone ? pillsRef.current.getBoundingClientRect().bottom : 0);
    const bottomEdge = (parent ? parent.getBoundingClientRect().bottom : window.innerHeight) - (phone ? 92 : 0);
    let step = 0;
    if (pending.y >= topEdge && pending.y < topEdge + EDGE_ZONE_PX) step = -MAX_SCROLL_STEP_PX * Math.min(1, (topEdge + EDGE_ZONE_PX - pending.y) / EDGE_ZONE_PX);
    else if (pending.y > bottomEdge - EDGE_ZONE_PX) step = MAX_SCROLL_STEP_PX * Math.min(1, (pending.y - (bottomEdge - EDGE_ZONE_PX)) / EDGE_ZONE_PX);
    if (step) {
      if (parent) parent.scrollTop += step;
      else window.scrollBy(0, step);
    }
    updateTarget(pending);
    pending.raf = requestAnimationFrame(tick);
  }

  function begin(pending: Pending): void {
    pending.active = true;
    const rect = pending.element.getBoundingClientRect();
    const ghost = pending.element.cloneNode(true) as HTMLElement;
    ghost.classList.add("kanban-ghost");
    ghost.classList.remove("is-drag-source", "is-armed");
    ghost.removeAttribute("data-kanban-card");
    ghost.setAttribute("aria-hidden", "true");
    ghost.inert = true;
    Object.assign(ghost.style, { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` });
    document.body.appendChild(ghost);
    pending.ghost = ghost;
    moveGhost(pending);
    setDragging({ id: pending.id, from: pending.from });
    setArmedId(null);
    pending.raf = requestAnimationFrame(tick);
    updateTarget(pending);
  }

  function moveGhost(pending: Pending): void {
    if (pending.ghost) pending.ghost.style.transform = `translate3d(${pending.x - pending.startX}px, ${pending.y - pending.startY}px, 0) rotate(1.6deg) scale(1.03)`;
  }

  function handleMove(event: PointerEvent): void {
    const pending = pendingRef.current;
    if (!pending || event.pointerId !== pending.pointerId) return;
    pending.x = event.clientX;
    pending.y = event.clientY;
    const distance = Math.hypot(pending.x - pending.startX, pending.y - pending.startY);
    if (!pending.active) {
      // A finger that moves before the long-press fires is scrolling.
      if (pending.touch && !pending.armed) {
        if (distance > TOUCH_SCROLL_SLOP_PX) finish(pending, false);
        return;
      }
      if (distance < MOUSE_SLOP_PX) return;
      begin(pending);
      return;
    }
    moveGhost(pending);
    updateTarget(pending);
  }

  function handleUp(event: PointerEvent): void {
    const pending = pendingRef.current;
    if (!pending || event.pointerId !== pending.pointerId) return;
    const { active, armed, target, id, from, x, y } = pending;
    finish(pending, false);
    if (active) {
      swallowNextClick();
      if (target && target !== from) void commit(id, target);
    } else if (armed) {
      // Long-press without a drag: the card menu (a bottom sheet on phones).
      swallowNextClick();
      openMenuFor(id, x, y);
    }
  }

  function handleCancel(): void {
    const pending = pendingRef.current;
    if (pending) finish(pending, pending.active);
  }

  function handleKey(event: KeyboardEvent): void {
    if (event.key !== "Escape" || !pendingRef.current?.active) return;
    event.preventDefault();
    event.stopPropagation();
    handleCancel();
    swallowNextClick();
  }

  function onCardPointerDown(event: ReactPointerEvent<HTMLElement>, item: T, columnId: string): void {
    if (!event.isPrimary || (event.pointerType === "mouse" && event.button !== 0)) return;
    if (latest.current.canDrag && !latest.current.canDrag(item)) return;
    if ((event.target as HTMLElement).closest(NO_DRAG_SELECTOR)) return;
    if (pendingRef.current) finish(pendingRef.current, false);
    const touch = event.pointerType === "touch";
    if (touch) lastTouchRef.current = Date.now();
    const pending: Pending = {
      id: item.id, from: columnId, pointerId: event.pointerId, touch,
      startX: event.clientX, startY: event.clientY, x: event.clientX, y: event.clientY,
      element: event.currentTarget, armed: false, active: false, target: null,
    };
    if (touch) {
      pending.timer = window.setTimeout(() => {
        if (pendingRef.current !== pending || pending.active) return;
        pending.armed = true;
        haptic(8);
        setArmedId(pending.id);
      }, TOUCH_HOLD_MS);
    }
    pendingRef.current = pending;
    addListeners();
  }
  handlers.current = { move: handleMove, up: handleUp, cancel: handleCancel, key: handleKey };

  // Once a long-press has armed (or a drag is running) the finger must not
  // scroll the page: a non-passive touchmove listener is the only way to stop it.
  useEffect(() => {
    const blockScroll = (event: TouchEvent) => {
      const pending = pendingRef.current;
      if (pending && (pending.armed || pending.active) && event.cancelable) event.preventDefault();
    };
    document.addEventListener("touchmove", blockScroll, { passive: false });
    return () => {
      document.removeEventListener("touchmove", blockScroll);
      if (pendingRef.current) finish(pendingRef.current, false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── Phone column pills ────────────────────────────────────────────── */

  const syncActiveColumn = useCallback(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const padding = Number.parseFloat(getComputedStyle(scroller).paddingLeft) || 0;
    let best: string | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const element of Array.from(scroller.querySelectorAll<HTMLElement>("[data-kanban-column]"))) {
      const distance = Math.abs(element.offsetLeft - padding - scroller.scrollLeft);
      if (distance < bestDistance) { bestDistance = distance; best = element.dataset.kanbanColumn ?? null; }
    }
    setActiveColumn((current) => current === best ? current : best);
  }, []);

  useEffect(() => { syncActiveColumn(); }, [syncActiveColumn, columns.length]);

  useEffect(() => {
    const pill = pillsRef.current?.querySelector<HTMLElement>(`[data-kanban-pill][aria-current="true"]`);
    const strip = pillsRef.current;
    if (!pill || !strip || !strip.scrollTo) return;
    strip.scrollTo({ left: pill.offsetLeft - (strip.clientWidth - pill.offsetWidth) / 2, behavior: prefersReducedMotion() ? "auto" : "smooth" });
  }, [activeColumn]);

  function scrollToColumn(columnId: string): void {
    const scroller = scrollerRef.current;
    const column = scroller ? Array.from(scroller.querySelectorAll<HTMLElement>("[data-kanban-column]")).find((element) => element.dataset.kanbanColumn === columnId) : undefined;
    if (!scroller || !column) return;
    const padding = Number.parseFloat(getComputedStyle(scroller).paddingLeft) || 0;
    setActiveColumn(columnId);
    scroller.scrollTo?.({ left: column.offsetLeft - padding, behavior: prefersReducedMotion() ? "auto" : "smooth" });
  }

  /* ── Render ────────────────────────────────────────────────────────── */

  const isDragging = dragging !== null;

  return (
    <div ref={rootRef} className={`kanban${isDragging ? " is-dragging" : ""} ${className}`.trim()}>
      <nav ref={pillsRef} className="kanban-pills" aria-label={t("kanban.columns")}>
        {columns.map((column) => {
          const droppable = column.canDrop !== false;
          return (
            <button
              key={column.id}
              type="button"
              data-kanban-pill={column.id}
              className={`kanban-pill${hover === column.id ? " is-drop-target" : ""}${isDragging && !droppable ? " is-disabled" : ""}`}
              aria-current={activeColumn === column.id ? "true" : undefined}
              onClick={() => scrollToColumn(column.id)}
            >
              {column.glyph}
              <span className="kanban-pill-label">{column.label}</span>
              <span className="kanban-pill-count">{column.items.length}</span>
            </button>
          );
        })}
      </nav>
      <div
        ref={scrollerRef}
        className="project-board kanban-scroller"
        style={{ "--board-columns": columns.length } as CSSProperties}
        aria-label={label}
        role="group"
        onScroll={syncActiveColumn}
      >
        {columns.map((column) => {
          const droppable = column.canDrop !== false;
          const collapsed = column.previewCount !== undefined && !expanded.has(column.id) && column.items.length > column.previewCount;
          const visible = collapsed ? column.items.slice(0, column.previewCount) : column.items;
          const targeted = hover === column.id && dragging !== null && dragging.from !== column.id;
          const addLabel = t("common.projectHub.addTaskIn", { status: column.label });
          return (
            <section
              key={column.id}
              data-kanban-column={column.id}
              aria-label={column.label}
              className={`project-board-column kanban-column${targeted ? ` is-drop-target ${dropTargetClassName}`.trimEnd() : ""}${isDragging && !droppable ? " is-disabled" : ""}`}
            >
              <header className="project-board-column-heading">
                {column.glyph}
                <h3>{column.label}</h3>
                <span className="project-board-count">{column.items.length}</span>
                {column.canAdd && onAdd && <button type="button" className="project-board-add" aria-label={addLabel} title={addLabel} onClick={() => onAdd(column.id)}><Icon name="plus" /></button>}
              </header>
              <div className="project-board-cards">
                {visible.map((item) => {
                  const draggable = canDrag ? canDrag(item) : true;
                  return (
                    <article
                      key={item.id}
                      data-kanban-card={item.id}
                      data-draggable={draggable ? "true" : "false"}
                      className={`board-card kanban-card${draggable ? " is-draggable" : ""}${dragging?.id === item.id ? " is-drag-source" : ""}${armedId === item.id ? " is-armed" : ""}${itemClassName ? ` ${itemClassName(item)}` : ""}`}
                      onPointerDown={(event) => onCardPointerDown(event, item, column.id)}
                      onDragStart={(event) => event.preventDefault()}
                      onClickCapture={(event) => { if (suppressClickRef.current) { event.preventDefault(); event.stopPropagation(); } }}
                      onContextMenu={(event) => {
                        // A touch long-press is handled by the drag logic (menu on release).
                        if (Date.now() - lastTouchRef.current < 1500) { event.preventDefault(); return; }
                        const items = cardMenu(item, column.id);
                        if (items.length) contextMenu.openMenu(event, items);
                      }}
                    >
                      {renderCard(item)}
                    </article>
                  );
                })}
                {targeted && <div className="kanban-drop-slot" aria-hidden="true" />}
                {!column.items.length && !targeted && <div className="project-board-empty">{emptyLabel}</div>}
                {column.previewCount !== undefined && column.items.length > column.previewCount && (
                  <button type="button" className="project-board-more" aria-expanded={!collapsed} onClick={() => setExpanded((current) => { const next = new Set(current); if (next.has(column.id)) next.delete(column.id); else next.add(column.id); return next; })}>
                    {collapsed ? tp("common.projectHub.showMore", column.items.length - column.previewCount) : t("common.projectHub.showLess")}
                  </button>
                )}
              </div>
            </section>
          );
        })}
      </div>
      {error && <p className="collab-error kanban-error" role="alert">{error}</p>}
      {contextMenu.menu && <ContextMenu x={contextMenu.menu.x} y={contextMenu.menu.y} items={contextMenu.menu.items} onClose={contextMenu.closeMenu} />}
    </div>
  );
}
