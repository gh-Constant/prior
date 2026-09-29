// Achievement toasts: slide in from the top-right (from the top on narrow screens), the medallion
// flips in like a coin with a rarity glow, auto-dismiss, and several stack like notifications.
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { emit } from "../../../lib/fx/particles";
import { rarityPalette } from "../../../lib/fx/themes";
import { useEffectsIntensity } from "../../../lib/gamification/effects";
import type { EffectsIntensity, Rarity } from "../../../lib/gamification/types";
import "./rarity.css";
import "./AchievementToast.css";

export type AchievementToastData = {
  readonly id: string;
  readonly title: string;
  readonly description?: string;
  readonly rarity: Rarity;
  readonly icon: ReactNode;
  /** Line above the title, for example "Achievement unlocked · Rare". */
  readonly eyebrow?: string;
  /** Reward pill, for example "+50 XP". */
  readonly reward?: string;
};

export type AchievementToastStackProps = {
  /** Oldest first; the newest is shown on top. */
  readonly toasts: readonly AchievementToastData[];
  readonly onDismiss: (id: string) => void;
  /** Time on screen in ms, paused while hovered or focused. */
  readonly duration?: number;
  /** Cards visible in the collapsed stack. */
  readonly maxVisible?: number;
  readonly dismissLabel?: string;
  readonly regionLabel?: string;
  readonly defaultEyebrow?: string;
};

const LEAVE_MS = 280;
const PEEK_PX = 10;
const GAP_PX = 8;

export function AchievementToastStack(props: AchievementToastStackProps) {
  if (typeof document === "undefined") return null;
  return createPortal(<Stack {...props} />, document.body);
}

function Stack({ toasts, onDismiss, duration = 5200, maxVisible = 3, dismissLabel = "Dismiss", regionLabel = "Achievements", defaultEyebrow = "Achievement unlocked" }: AchievementToastStackProps) {
  const intensity = useEffectsIntensity();
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [heights, setHeights] = useState<ReadonlyMap<string, number>>(() => new Map());
  const nodes = useRef(new Map<string, HTMLElement>());
  const expanded = hovered || focused;
  const ordered = [...toasts].reverse();

  useLayoutEffect(() => {
    const next = new Map<string, number>();
    let changed = false;
    for (const toast of toasts) {
      const height = nodes.current.get(toast.id)?.offsetHeight ?? 0;
      next.set(toast.id, height);
      if (heights.get(toast.id) !== height) changed = true;
    }
    if (changed || next.size !== heights.size) setHeights(next);
  }, [toasts, heights]);

  let offset = 0;
  const layout = ordered.map((toast, index) => {
    const y = expanded ? offset : index * PEEK_PX;
    offset += (heights.get(toast.id) ?? 76) + GAP_PX;
    const scale = expanded ? 1 : 1 - Math.min(index, maxVisible) * 0.045;
    const hidden = index >= maxVisible && !expanded;
    return { toast, index, y, scale, hidden };
  });
  const frontHeight = heights.get(ordered[0]?.id ?? "") ?? 76;
  const height = expanded ? Math.max(0, offset - GAP_PX) : frontHeight + Math.min(ordered.length - 1, maxVisible - 1) * PEEK_PX;

  return (
    <section
      className={`fx-ach-stack fx-ach-${intensity}${expanded ? " is-expanded" : ""}`}
      aria-label={regionLabel}
      style={{ height: ordered.length ? height : 0 }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false);
      }}
    >
      {layout.map(({ toast, index, y, scale, hidden }) => (
        <div
          key={toast.id}
          className="fx-ach-slot"
          style={{ transform: `translateY(${y}px) scale(${scale})`, zIndex: 100 - index, opacity: hidden ? 0 : 1, pointerEvents: hidden ? "none" : undefined } as CSSProperties}
          aria-hidden={hidden || undefined}
        >
          <AchievementToastCard
            toast={toast}
            intensity={intensity}
            duration={duration}
            paused={expanded}
            behind={index > 0 && !expanded}
            dismissLabel={dismissLabel}
            defaultEyebrow={defaultEyebrow}
            onDismiss={onDismiss}
            nodeRef={(node) => {
              if (node) nodes.current.set(toast.id, node);
              else nodes.current.delete(toast.id);
            }}
          />
        </div>
      ))}
    </section>
  );
}

type CardProps = {
  readonly toast: AchievementToastData;
  readonly intensity: EffectsIntensity;
  readonly duration: number;
  readonly paused: boolean;
  readonly behind: boolean;
  readonly dismissLabel: string;
  readonly defaultEyebrow: string;
  readonly onDismiss: (id: string) => void;
  readonly nodeRef: (node: HTMLElement | null) => void;
};

function AchievementToastCard({ toast, intensity, duration, paused, behind, dismissLabel, defaultEyebrow, onDismiss, nodeRef }: CardProps) {
  const [leaving, setLeaving] = useState(false);
  const remaining = useRef(duration);
  const medalRef = useRef<HTMLSpanElement>(null);
  const { id, rarity } = toast;

  const leave = useCallback(() => setLeaving(true), []);

  useEffect(() => {
    if (paused || leaving) return;
    const started = performance.now();
    const timeout = window.setTimeout(leave, Math.max(0, remaining.current));
    return () => {
      window.clearTimeout(timeout);
      remaining.current -= performance.now() - started;
    };
  }, [paused, leaving, leave]);

  useEffect(() => {
    if (!leaving) return;
    if (intensity === "off") {
      onDismiss(id);
      return;
    }
    const timeout = window.setTimeout(() => onDismiss(id), LEAVE_MS);
    return () => window.clearTimeout(timeout);
  }, [leaving, intensity, id, onDismiss]);

  // A few glints as the medallion lands.
  useEffect(() => {
    if (intensity === "off") return;
    const timeout = window.setTimeout(() => {
      if (medalRef.current) emit("sparkle", medalRef.current, { intensity, colors: rarityPalette(rarity), count: rarity === "legendary" ? 22 : rarity === "epic" ? 16 : 10, power: 0.9 });
    }, 820);
    return () => window.clearTimeout(timeout);
  }, [intensity, rarity]);

  return (
    <article
      ref={nodeRef}
      className={`fx-ach fx-rarity-${rarity}${leaving ? " is-leaving" : ""}${behind ? " is-behind" : ""}${paused ? " is-paused" : ""}`}
      role="status"
      aria-live="polite"
      aria-atomic="true"
      style={{ "--fx-ach-duration": `${duration}ms` } as CSSProperties}
    >
      <span ref={medalRef} className="fx-ach-medal" aria-hidden="true">
        <span className="fx-ach-medal-coin">
          <span className="fx-ach-medal-face fx-ach-medal-back" />
          <span className="fx-ach-medal-face fx-ach-medal-front">{toast.icon}</span>
        </span>
        <span className="fx-ach-medal-glint" />
      </span>
      <span className="fx-ach-text">
        <span className="fx-ach-eyebrow">{toast.eyebrow ?? defaultEyebrow}</span>
        <strong className="fx-ach-title">{toast.title}</strong>
        {toast.description && <span className="fx-ach-description">{toast.description}</span>}
      </span>
      {toast.reward && <span className="fx-ach-reward">{toast.reward}</span>}
      <button type="button" className="fx-ach-close" aria-label={dismissLabel} onClick={leave}>
        <svg viewBox="0 0 12 12" aria-hidden="true">
          <path d="M3 3l6 6M9 3l-6 6" />
        </svg>
      </button>
      {intensity !== "off" && <span className="fx-ach-timer" aria-hidden="true" />}
    </article>
  );
}

/** Local queue of achievement toasts. */
export function useAchievementToasts() {
  const [toasts, setToasts] = useState<readonly AchievementToastData[]>([]);
  const push = useCallback((toast: AchievementToastData) => setToasts((list) => [...list.filter((item) => item.id !== toast.id), toast]), []);
  const dismiss = useCallback((id: string) => setToasts((list) => list.filter((item) => item.id !== id)), []);
  const clear = useCallback(() => setToasts([]), []);
  return { toasts, push, dismiss, clear };
}
