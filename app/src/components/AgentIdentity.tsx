import { useEffect, useId, useRef, useState, type CSSProperties } from "react";
import "./AgentIdentity.css";

/**
 * How the assistant feels right now (see specs/DESIGN.md, "Assistant identity").
 * - idle: breathing, blinking, an occasional glance
 * - thinking: eyes up, three sparks orbit, the sprout's spark spins
 * - working: writing the answer: reading eyes and a gentle bob
 * - happy: changes applied: squinting smile, a hop and a burst of sparks
 * - sad: something failed: drooping eyes
 * - listening: dictation is recording: wide eyes and a pulsing ring
 */
export type AgentMood = "idle" | "thinking" | "working" | "happy" | "sad" | "listening";

export const AGENT_MOODS: readonly AgentMood[] = ["idle", "thinking", "working", "happy", "sad", "listening"];

type AgentIdentityProps = {
  /** Legacy switch: same as `mood="thinking"` (an explicit `mood` wins). */
  readonly thinking?: boolean;
  readonly size?: "tiny" | "small" | "hero";
  readonly mood?: AgentMood;
  /** Waves hello once when it appears. Defaults to on for the hero size. */
  readonly wave?: boolean;
};

const BODY = "M32 14 C50 14 61 25.5 61 37 C61 50.5 50 59 32 59 C14 59 3 50.5 3 37 C3 25.5 14 14 32 14Z";
const STAR = "M0 -4.6 C.7 -1.5 1.5 -.7 4.6 0 C1.5 .7 .7 1.5 0 4.6 C-.7 1.5 -1.5 .7 -4.6 0 C-1.5 -.7 -.7 -1.5 0 -4.6Z";
const BURST_ANGLES = [0, 60, 120, 180, 240, 300] as const;

function Eyes({ mood }: { readonly mood: AgentMood }) {
  if (mood === "happy") {
    return (
      <g className="mascot-eyes-happy">
        <path d="M17.6 38.6 Q21.5 32 25.4 38.6" />
        <path d="M38.6 38.6 Q42.5 32 46.4 38.6" />
      </g>
    );
  }
  return (
    <g className="mascot-eyes">
      {[21.5, 42.5].map((cx) => (
        <g key={cx} className="mascot-eye">
          <ellipse className="mascot-pupil" cx={cx} cy="37" rx="4.5" ry="5.8" />
          <circle className="mascot-glint" cx={cx + 1.5} cy="34.6" r="1.7" />
          <circle className="mascot-glint mascot-glint-small" cx={cx - 1.4} cy="39.4" r=".8" />
        </g>
      ))}
    </g>
  );
}

function Mouth({ mood }: { readonly mood: AgentMood }) {
  switch (mood) {
    case "thinking":
      return <ellipse className="mascot-mouth-fill" cx="34" cy="47.4" rx="1.9" ry="1.6" />;
    case "listening":
      return <ellipse className="mascot-mouth-fill" cx="32" cy="47.6" rx="2" ry="2.3" />;
    case "working":
      return <path className="mascot-mouth-fill" d="M28.4 45.6 Q32 50.4 35.6 45.6 Q32 47 28.4 45.6Z" />;
    case "happy":
      return (
        <g>
          <path className="mascot-mouth-fill" d="M26.5 44.6 Q32 54.4 37.5 44.6 Q32 46.4 26.5 44.6Z" />
          <path className="mascot-tongue" d="M29.4 49.6 Q32 47.6 34.6 49.6 Q32 52 29.4 49.6Z" />
        </g>
      );
    case "sad":
      return <path className="mascot-mouth-line" d="M28.2 49.4 Q32 45.6 35.8 49.4" />;
    default:
      return <path className="mascot-mouth-line" d="M28 45.4 Q32 49.4 36 45.4" />;
  }
}

/**
 * Prior's assistant: a small coral pebble with a sprouting spark. Pure SVG + CSS (no images),
 * crisp from 16px to 160px, tinted by the theme's accent so it follows light, dark and any accent.
 */
export function AgentIdentity({ thinking = false, size = "small", mood: moodProp, wave }: AgentIdentityProps) {
  const mood: AgentMood = moodProp ?? (thinking ? "thinking" : "idle");
  const shouldWave = wave ?? size === "hero";
  const gradientId = `mascot-skin-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const rootRef = useRef<HTMLSpanElement>(null);
  // Per-instance rhythm so several mascots on screen never blink in unison.
  const [rhythm] = useState(() => ({
    blinkDur: 4.4 + Math.random() * 3.2,
    blinkDelay: -Math.random() * 6,
    glanceDur: 9 + Math.random() * 5,
    glanceDelay: -Math.random() * 9,
    breatheDelay: -Math.random() * 4,
  }));

  // The hero follows the pointer with its eyes while idle (one rAF-throttled listener).
  useEffect(() => {
    const root = rootRef.current;
    if (size !== "hero" || mood !== "idle" || !root) return undefined;
    if (typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return undefined;
    let frame = 0;
    const onMove = (event: PointerEvent) => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        const box = root.getBoundingClientRect();
        const dx = (event.clientX - (box.left + box.width / 2)) / 240;
        const dy = (event.clientY - (box.top + box.height / 2)) / 240;
        root.style.setProperty("--look-x", String(Math.max(-1, Math.min(1, dx)) * 2.6));
        root.style.setProperty("--look-y", String(Math.max(-1, Math.min(1, dy)) * 1.8));
        root.classList.add("is-tracking");
      });
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      if (frame) window.cancelAnimationFrame(frame);
      root.classList.remove("is-tracking");
      root.style.removeProperty("--look-x");
      root.style.removeProperty("--look-y");
    };
  }, [size, mood]);

  const style = {
    "--blink-dur": `${rhythm.blinkDur.toFixed(2)}s`,
    "--blink-delay": `${rhythm.blinkDelay.toFixed(2)}s`,
    "--glance-dur": `${rhythm.glanceDur.toFixed(2)}s`,
    "--glance-delay": `${rhythm.glanceDelay.toFixed(2)}s`,
    "--breathe-delay": `${rhythm.breatheDelay.toFixed(2)}s`,
  } as CSSProperties;

  return (
    <span
      ref={rootRef}
      className={`agent-identity agent-identity-${size} mood-${mood} ${mood === "thinking" ? "is-thinking" : "is-idle"}${shouldWave ? " is-waving" : ""}`}
      data-state={mood === "thinking" ? "thinking" : "idle"}
      data-mood={mood}
      style={style}
      aria-hidden="true"
    >
      <svg className="agent-mark agent-mascot" viewBox="0 0 64 64" focusable="false">
        <defs>
          <radialGradient id={gradientId} cx="36%" cy="26%" r="82%">
            <stop className="mascot-stop mascot-stop-hi" offset="0" />
            <stop className="mascot-stop mascot-stop-mid" offset=".52" />
            <stop className="mascot-stop mascot-stop-lo" offset="1" />
          </radialGradient>
        </defs>

        <ellipse className="mascot-shadow" cx="32" cy="61.4" rx="17" ry="2.2" />

        <g className="mascot-ring-group">
          <circle className="mascot-ring" cx="32" cy="37" r="28" />
          <circle className="mascot-ring mascot-ring-late" cx="32" cy="37" r="28" />
        </g>
        <g className="mascot-orbit">
          <circle className="mascot-spark" cx="32" cy="7.5" r="2.7" />
          <circle className="mascot-spark mascot-spark-2" cx="57.1" cy="51.5" r="2.1" />
          <circle className="mascot-spark mascot-spark-3" cx="6.9" cy="51.5" r="1.6" />
        </g>

        <g className="mascot-body">
          <g className="mascot-sprout">
            <path className="mascot-stem" d="M32 15.5 C32 12 32.4 10 34 8" />
            <path className="mascot-leaf" d="M34 8.2 C32.2 4.8 35 1.6 39.6 1.8 C39.8 6 37.6 8.8 34 8.2Z" />
            <path className="mascot-leaf mascot-leaf-small" d="M33.4 10 C30.8 8.4 28.4 9.2 27.6 11.4 C30.2 12.6 32.4 12 33.4 10Z" />
          </g>
          <g transform="translate(51 8.2)">
            <path className="mascot-star" d={STAR} />
          </g>

          <g className="mascot-arm-group">
            <ellipse className="mascot-arm" cx="60.6" cy="42.5" rx="4.4" ry="3.3" fill={`url(#${gradientId})`} />
          </g>

          <path className="mascot-skin" d={BODY} fill={`url(#${gradientId})`} />
          <path className="mascot-shine" d="M14.5 27.5 C17.5 21 24 17.6 30 17.2" />

          <g className="mascot-face">
            <ellipse className="mascot-cheek" cx="11.6" cy="46" rx="4.2" ry="2.6" />
            <ellipse className="mascot-cheek" cx="52.4" cy="46" rx="4.2" ry="2.6" />
            {mood === "sad" && (
              <g className="mascot-brows">
                <path d="M16.6 31.6 L26 28.4" />
                <path d="M38 28.4 L47.4 31.6" />
              </g>
            )}
            <g className="mascot-look">
              <g className="mascot-glance">
                <Eyes mood={mood} />
              </g>
            </g>
            <g className="mascot-mouth" key={mood}>
              <Mouth mood={mood} />
            </g>
            {mood === "sad" && <path className="mascot-tear" d="M13.4 42.2 C11.6 45 11.9 47.4 13.4 47.4 C14.9 47.4 15.2 45 13.4 42.2Z" />}
          </g>
        </g>

        {mood === "happy" && (
          <g className="mascot-burst">
            {BURST_ANGLES.map((angle) => (
              <circle key={angle} className="mascot-burst-dot" cx="32" cy="37" r={angle % 120 === 0 ? 2.3 : 1.7} style={{ "--angle": `${angle}deg` } as CSSProperties} />
            ))}
          </g>
        )}
      </svg>
    </span>
  );
}
