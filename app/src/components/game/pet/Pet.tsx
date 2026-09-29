// The animated pet. Moods drive looping CSS idles on named parts; reactions
// are one-shot Web Animations layered on top; pointer tracking moves the eyes
// through CSS variables so React never re-renders on mouse move.
import { useCallback, useEffect, useId, useImperativeHandle, useMemo, useRef, useState, type CSSProperties, type Ref } from "react";
import { useEffectsIntensity } from "../../../lib/gamification/effects";
import type { EffectsIntensity, PetMood, PetReaction, PetSpecies, PetStage } from "../../../lib/gamification/types";
import { HAT_HEIGHT, sanitizeAccessories, type PetAccessories } from "./accessories";
import { moodExpression, reactionExpression, REACTION_DURATION, STILL_REACTION_DURATION, type PetExpression, type PetEyeState } from "./expressions";
import { getAccessoryAnchor, getPetGeometry, headFeaturesTop, type HatchedPetStage, type PetGeometry } from "./geometry";
import { PET_PALETTES } from "./palette";
import { PetAura, PetBack, PetBody, PetDefs, PetHead, PetNeck } from "./PetFigure";
import { EggDefs, PetEggBurst, PetEggShell } from "./PetEgg";
import { BLINK_FRAMES, earTwitchFrames, eggNudgeFrames, hatchShakeFrames, reactionTracks, SLOW_BLINK_FRAMES } from "./motion";
import { heartPath, sparklePath } from "./shapes";
import { useResolvedTheme } from "../../../lib/theme";
import "./pet.css";

export type PetHandle = {
  /** Plays a one-shot reaction on top of the current mood. */
  readonly play: (reaction: PetReaction) => void;
};

export type PetBackdrop = "light" | "dark";

export type PetProps = {
  readonly species: PetSpecies;
  readonly stage: PetStage;
  readonly mood?: PetMood;
  /** Rendered width and height in px. */
  readonly size?: number;
  /** Crops the frame around the pet (bottom-anchored); hats and hops may overflow. 1 = full frame. */
  readonly zoom?: number;
  readonly accessories?: PetAccessories;
  /** Eyes follow a mouse pointer (desktop). */
  readonly trackPointer?: boolean;
  /** Declarative trigger: `reaction` plays each time `reactionKey` changes. */
  readonly reaction?: PetReaction | null;
  readonly reactionKey?: string | number;
  /** Called when a reaction triggered from props or `play` ends (not for idle yawns). */
  readonly onReactionEnd?: (reaction: PetReaction) => void;
  /** Egg crack progress, 0..1. */
  readonly crack?: number;
  /** Egg with mixed speckles because the species is not known yet. */
  readonly mysteryEgg?: boolean;
  /** Surface behind the pet, tunes shadows and floating letters. */
  readonly backdrop?: PetBackdrop;
  /** Flat locked silhouette (evolution previews). */
  readonly silhouette?: boolean;
  /** Static pose regardless of the effects setting. */
  readonly still?: boolean;
  readonly name?: string;
  /** Localized mood text for the accessible label. */
  readonly moodLabel?: string;
  /** Overrides the accessible label entirely. */
  readonly label?: string;
  /** Hide from assistive tech when a parent already labels it (e.g. a button). */
  readonly decorative?: boolean;
  readonly className?: string;
  readonly style?: CSSProperties;
  readonly ref?: Ref<PetHandle>;
};

type FxItem = {
  readonly id: number;
  readonly kind: "heart" | "sparkle" | "burst" | "flash";
  readonly x: number;
  readonly y: number;
  readonly size: number;
  readonly delay: number;
  readonly dx?: number;
  readonly dy?: number;
};

type HatchPhase = "shake" | "burst";

let fxCounter = 0;
const nextFxId = () => (fxCounter += 1);

function amplitude(intensity: EffectsIntensity): number {
  return intensity === "full" ? 1 : intensity === "subtle" ? 0.5 : 0;
}

function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

/** Square viewBox for a zoom level, kept centred and anchored just under the ground. */
function frameFor(zoom: number): { readonly x: number; readonly y: number; readonly size: number } {
  const size = Math.round((120 / Math.max(1, zoom)) * 100) / 100;
  return { x: Math.round((60 - size / 2) * 100) / 100, y: Math.round((120 - size) * 0.9 * 100) / 100, size };
}

function cleanId(id: string): string {
  return `pet${id.replace(/[^a-zA-Z0-9_-]/g, "")}`;
}

export function Pet({
  species,
  stage,
  mood = "content",
  size = 120,
  zoom = 1,
  accessories,
  trackPointer = false,
  reaction = null,
  reactionKey,
  onReactionEnd,
  crack = 0,
  mysteryEgg = false,
  backdrop: backdropProp,
  silhouette = false,
  still = false,
  name,
  moodLabel,
  label,
  decorative = false,
  className,
  style,
  ref,
}: PetProps) {
  const uid = cleanId(useId());
  // Without an explicit backdrop the pet follows the app theme (light or dark canvas).
  const theme = useResolvedTheme();
  const backdrop: PetBackdrop = backdropProp ?? theme;
  const contextIntensity = useEffectsIntensity();
  const intensity: EffectsIntensity = still || silhouette ? "off" : contextIntensity;
  const svgRef = useRef<SVGSVGElement>(null);

  const [active, setActive] = useState<{ readonly reaction: PetReaction; readonly id: number } | null>(null);
  const [hatch, setHatch] = useState<HatchPhase | null>(null);
  const [revealEyes, setRevealEyes] = useState<PetEyeState | null>(null);
  const [fx, setFx] = useState<readonly FxItem[]>([]);

  // Once hatched, keep showing the baby until the parent moves the stage on.
  const [hatchedFrom, setHatchedFrom] = useState<PetStage | null>(null);
  if (hatchedFrom !== null && hatchedFrom !== stage) setHatchedFrom(null);
  const showBaby = stage === "egg" && hatchedFrom === "egg";
  const figureStage: HatchedPetStage | null = stage === "egg" ? (showBaby || hatch === "burst" ? "baby" : null) : stage;

  const geometry = useMemo<PetGeometry>(() => getPetGeometry(species, figureStage ?? "baby"), [species, figureStage]);
  const palette = PET_PALETTES[species];
  const equipped = useMemo(() => sanitizeAccessories(accessories), [accessories]);
  // Highest point of the head (ears, sprout or hat): particles start above it.
  const crownTop = useMemo(() => {
    let value = Math.min(headFeaturesTop(geometry), geometry.head.cy - geometry.head.ry);
    if (equipped.hat) {
      const anchor = getAccessoryAnchor(geometry.species, geometry.stage, "hat");
      value = Math.min(value, anchor.y - (HAT_HEIGHT[equipped.hat] ?? 0) * anchor.scale);
    }
    return value;
  }, [geometry, equipped.hat]);

  const timers = useRef<number[]>([]);
  const fxTimers = useRef<number[]>([]);
  const animations = useRef<Animation[]>([]);
  const hasActive = useRef(false);
  hasActive.current = active !== null || hatch !== null;
  const latest = useRef({ intensity, mood, onReactionEnd, figureStage, activeId: 0 });
  latest.current = { ...latest.current, intensity, mood, onReactionEnd, figureStage };

  const later = useCallback((ms: number, run: () => void) => {
    const handle = window.setTimeout(() => {
      timers.current = timers.current.filter((item) => item !== handle);
      run();
    }, ms);
    timers.current.push(handle);
  }, []);

  const animate = useCallback((selector: string, frames: Keyframe[], options: KeyframeAnimationOptions) => {
    const root = svgRef.current;
    if (!root) return;
    root.querySelectorAll<SVGElement>(selector).forEach((element) => {
      if (typeof element.animate !== "function") return;
      const animation = element.animate(frames, options);
      animations.current.push(animation);
      animation.onfinish = () => {
        animations.current = animations.current.filter((item) => item !== animation);
      };
    });
  }, []);

  const stopAll = useCallback(() => {
    timers.current.forEach((handle) => window.clearTimeout(handle));
    timers.current = [];
    animations.current.forEach((animation) => animation.cancel());
    animations.current = [];
  }, []);

  useEffect(() => () => {
    stopAll();
    fxTimers.current.forEach((handle) => window.clearTimeout(handle));
    fxTimers.current = [];
  }, [stopAll]);

  // Particles outlive the reaction that spawned them, so they keep their own timers.
  const spawn = useCallback((items: Omit<FxItem, "id">[], lifetime: number) => {
    if (items.length === 0) return;
    const created = items.map((item) => ({ ...item, id: nextFxId() }));
    setFx((current) => [...current, ...created]);
    const ids = new Set(created.map((item) => item.id));
    const handle = window.setTimeout(() => {
      fxTimers.current = fxTimers.current.filter((item) => item !== handle);
      setFx((current) => current.filter((item) => !ids.has(item.id)));
    }, lifetime);
    fxTimers.current.push(handle);
  }, []);

  const blink = useCallback((slow = false) => {
    animate(".pet-eye", slow ? SLOW_BLINK_FRAMES : BLINK_FRAMES, { duration: slow ? 900 : 190, easing: "ease-in-out" });
  }, [animate]);

  const play = useCallback((next: PetReaction, internal = false) => {
    const { intensity: level, figureStage: currentStage } = latest.current;
    const a = amplitude(level);
    const id = (latest.current.activeId += 1);
    stopAll();
    setHatch(null);
    setRevealEyes(null);

    const finish = (ms: number) => later(ms, () => {
      if (latest.current.activeId !== id) return;
      setActive(null);
      setHatch(null);
      setRevealEyes(null);
      if (!internal) latest.current.onReactionEnd?.(next);
    });

    // Eggs only rattle, or hatch.
    if (currentStage === null) {
      if (next !== "hatch") {
        if (a > 0) animate(".pet-egg-wobble", eggNudgeFrames(a), { duration: 620, easing: "ease-in-out" });
        setActive(null);
        finish(a > 0 ? 620 : 0);
        return;
      }
      setActive({ reaction: "hatch", id });
      if (a === 0) {
        setHatchedFrom("egg");
        setRevealEyes("happy");
        finish(STILL_REACTION_DURATION);
        return;
      }
      setHatch("shake");
      animate(".pet-egg-wobble", hatchShakeFrames(a), { duration: 1150, easing: "ease-in" });
      later(1150, () => {
        setHatch("burst");
        setHatchedFrom("egg");
        setRevealEyes("closed");
        const count = level === "full" ? 10 : 4;
        spawn([
          { kind: "flash", x: 60, y: 82, size: 30, delay: 0 },
          ...Array.from({ length: count }, (_, index) => {
            const angle = (index / count) * Math.PI * 2 + 0.3;
            const distance = randomBetween(30, 44);
            return { kind: "burst" as const, x: 60, y: 80, size: randomBetween(2.4, 4), delay: randomBetween(0, 0.08), dx: Math.cos(angle) * distance, dy: Math.sin(angle) * distance * 0.8 - 8 };
          }),
        ], 1100);
      });
      later(1750, () => setRevealEyes("open"));
      later(2250, () => blink());
      later(2600, () => setRevealEyes("happy"));
      finish(REACTION_DURATION.hatch);
      return;
    }

    if (next === "hatch") {
      setActive(null);
      return;
    }

    setActive({ reaction: next, id });
    if (a === 0) {
      if (next === "hop" || next === "purr") spawn([{ kind: "heart", x: 60, y: crownTop - 8, size: 10, delay: 0 }], STILL_REACTION_DURATION);
      finish(STILL_REACTION_DURATION);
      return;
    }

    for (const track of reactionTracks(next, a)) {
      animate(track.selector, track.frames, { duration: track.duration, easing: track.easing ?? "linear", delay: track.delay ?? 0 });
    }
    const top = crownTop;
    const many = level === "full";
    if (next === "hop") {
      spawn([{ kind: "heart", x: 60 + randomBetween(-3, 3), y: top - 6, size: 12, delay: 0.3 }], 1500);
    } else if (next === "purr") {
      const hearts = many ? [-22, 0, 21] : [18];
      spawn(hearts.map((dx, index) => ({ kind: "heart" as const, x: 60 + dx, y: top + 6 + Math.abs(dx) * 0.35, size: index === 1 ? 9 : 7.5, delay: 0.12 + index * 0.16 })), 1500);
    } else if (next === "dance") {
      const points = many ? [[-30, 18], [32, 12], [-22, -2], [26, -6], [2, -10]] : [[-28, 12], [28, 4]];
      spawn(points.map(([dx, dy], index) => ({ kind: "sparkle" as const, x: 60 + dx, y: top + dy, size: randomBetween(3.2, 4.6), delay: index * 0.22 })), 1900);
    }
    finish(REACTION_DURATION[next]);
  }, [animate, blink, crownTop, geometry, later, spawn, stopAll]);

  useImperativeHandle(ref, () => ({ play: (next: PetReaction) => play(next) }), [play]);

  // Declarative trigger: replay whenever the key changes (not on mount).
  const lastKey = useRef(reactionKey);
  useEffect(() => {
    if (reactionKey === lastKey.current) return;
    lastKey.current = reactionKey;
    if (reaction) play(reaction);
  }, [reaction, reactionKey, play]);

  // Idle life: random blinks, ear twitches, and yawns when sleepy.
  const idleAllowed = intensity !== "off" && figureStage !== null;
  useEffect(() => {
    if (!idleAllowed) return;
    let handle = 0;
    const loop = () => {
      const current = latest.current;
      const slow = current.intensity === "subtle" ? 1.5 : 1;
      const delay = (current.mood === "sleepy" ? randomBetween(2600, 5200) : randomBetween(1900, 4800)) * slow;
      handle = window.setTimeout(() => {
        const now = latest.current;
        if (!hasActive.current) {
          const a = amplitude(now.intensity);
          const twitch = () => animate(Math.random() < 0.5 ? ".pet-ear--l" : ".pet-ear--r", earTwitchFrames(a), { duration: 420, easing: "ease-in-out" });
          if (now.mood === "content" || now.mood === "excited") {
            blink();
            if (Math.random() < 0.18) later(260, blink);
            if (Math.random() < 0.3) twitch();
          } else if (now.mood === "happy") {
            if (Math.random() < 0.45) twitch();
          } else if (now.mood === "sleepy") {
            if (Math.random() < 0.3 && now.intensity === "full") play("yawn", true);
            else blink(true);
          }
        }
        loop();
      }, delay);
    };
    loop();
    return () => window.clearTimeout(handle);
  }, [idleAllowed, animate, blink, later, play]);

  // Pointer tracking: rAF-throttled, writes CSS variables only.
  const tracking = trackPointer && intensity !== "off" && figureStage !== null;
  const eyeY = geometry.eye.y;
  const lookRadius = geometry.lookRadius;
  const frame = frameFor(zoom);
  useEffect(() => {
    const root = svgRef.current;
    if (!tracking || !root) return;
    let pending = 0;
    let pointerX = 0;
    let pointerY = 0;
    const update = () => {
      pending = 0;
      const rect = root.getBoundingClientRect();
      if (rect.width === 0) return;
      const scale = rect.width / frame.size;
      const dx = pointerX - (rect.left + (60 - frame.x) * scale);
      const dy = pointerY - (rect.top + (eyeY - frame.y) * scale);
      const distance = Math.hypot(dx, dy) || 1;
      const reach = Math.min(1, distance / (60 + rect.width));
      const k = (lookRadius * reach) / distance;
      root.style.setProperty("--pet-look-x", `${(dx * k).toFixed(2)}px`);
      root.style.setProperty("--pet-look-y", `${(dy * k * 0.75).toFixed(2)}px`);
    };
    const onMove = (event: PointerEvent) => {
      if (event.pointerType === "touch") return;
      pointerX = event.clientX;
      pointerY = event.clientY;
      if (!pending) pending = window.requestAnimationFrame(update);
    };
    const onLeave = () => {
      root.style.setProperty("--pet-look-x", "0px");
      root.style.setProperty("--pet-look-y", "0px");
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    document.documentElement.addEventListener("pointerleave", onLeave);
    return () => {
      window.removeEventListener("pointermove", onMove);
      document.documentElement.removeEventListener("pointerleave", onLeave);
      if (pending) window.cancelAnimationFrame(pending);
      root.style.removeProperty("--pet-look-x");
      root.style.removeProperty("--pet-look-y");
    };
  }, [tracking, eyeY, lookRadius, frame.x, frame.y, frame.size]);

  const base = moodExpression(mood);
  const override = active ? reactionExpression(active.reaction, mood) : null;
  const expression: PetExpression = revealEyes
    ? { eyes: revealEyes, mouth: revealEyes === "happy" ? "open" : "small", blush: revealEyes === "happy" }
    : override ?? base;

  const showEgg = figureStage === null || hatch === "shake";
  const eggCrack = hatch === "shake" ? 1 : crack;
  const sparkles = intensity === "full" ? 7 : intensity === "subtle" ? 3 : 4;
  const accessible = label ?? [name, moodLabel ?? (figureStage ? mood : undefined)].filter(Boolean).join(", ");

  const classes = [
    "pet",
    `pet--${species}`,
    `pet--mood-${mood}`,
    `pet--fx-${intensity}`,
    `pet--on-${backdrop}`,
    intensity === "off" ? "pet--still" : "",
    silhouette ? "pet--silhouette" : "",
    active ? `pet--react-${active.reaction}` : "",
    figureStage === null ? "pet--egg" : "",
    crack >= 0.6 ? "pet--restless" : "",
    className ?? "",
  ].filter(Boolean).join(" ");

  const top = geometry.head.cy - geometry.head.ry;

  return (
    <svg
      ref={svgRef}
      className={classes}
      style={style}
      width={size}
      height={size}
      viewBox={`${frame.x} ${frame.y} ${frame.size} ${frame.size}`}
      overflow="visible"
      role={decorative ? undefined : "img"}
      aria-label={decorative ? undefined : accessible || undefined}
      aria-hidden={decorative ? true : undefined}
      focusable="false"
      data-species={species}
      data-stage={figureStage ?? "egg"}
      data-mood={mood}
    >
      {(showEgg || hatch === "burst") && <EggDefs uid={uid} species={mysteryEgg ? null : species} />}
      {figureStage && <PetDefs uid={uid} geometry={geometry} palette={palette} />}
      {figureStage && geometry.radiant && !silhouette && <PetAura uid={uid} geometry={geometry} sparkles={sparkles} />}
      <ellipse className="pet-shadow" cx={60} cy={108.5} rx={figureStage ? geometry.body.rx * 1.1 : 23} ry={figureStage ? 3.6 : 3.2} />
      {showEgg && (
        <g className="pet-egg-wobble">
          <PetEggShell uid={uid} species={mysteryEgg ? null : species} crack={eggCrack} glow={hatch === "shake" ? palette.glow : undefined} />
        </g>
      )}
      {figureStage && !(hatch === "shake") && (
        <g className={hatch === "burst" ? "pet-figure pet-born" : "pet-figure"}>
          <g className="pet-react">
            <g className="pet-idle">
              <PetBack uid={uid} geometry={geometry} palette={palette} />
              <PetBody uid={uid} geometry={geometry} palette={palette} />
              <g className="pet-head">
                <PetHead uid={uid} geometry={geometry} palette={palette} expression={expression} accessories={equipped} />
              </g>
              <PetNeck geometry={geometry} accessories={equipped} />
            </g>
          </g>
        </g>
      )}
      {hatch === "burst" && <PetEggBurst uid={uid} species={mysteryEgg ? null : species} />}
      {figureStage && mood === "asleep" && !active && !silhouette && (
        <g className="pet-zzz" aria-hidden="true">
          {[0, 1, 2].map((index) => (
            <g key={index} transform={`translate(${geometry.head.cx + geometry.head.rx * 0.66} ${top + 4})`}>
              <path className="pet-z" style={{ "--pet-delay": `${index * 1.15}s`, "--pet-z-scale": 0.8 + index * 0.12 } as CSSProperties} d="M-3 -3H3L-3 3H3" fill="none" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" />
            </g>
          ))}
        </g>
      )}
      {figureStage && mood === "excited" && !silhouette && intensity !== "off" && (
        <g className="pet-excite" aria-hidden="true">
          {[[-34, -2, 3.2, 0], [33, 6, 2.6, 0.5], [26, -16, 2.2, 0.9]].map(([dx, dy, r, delay]) => (
            <path key={`${dx}`} className="pet-shimmer" style={{ "--pet-delay": `${delay}s` } as CSSProperties} d={sparklePath(60 + dx, top + 12 + dy, r)} fill="#ffe28a" stroke="#f0b53c" strokeWidth={0.5} />
          ))}
        </g>
      )}
      <g className="pet-fx-layer" aria-hidden="true">
        {fx.map((item) => (
          <g key={item.id} transform={`translate(${item.x.toFixed(2)} ${item.y.toFixed(2)})`}>
            <g className={`pet-fx pet-fx--${item.kind}`} style={{ "--pet-delay": `${item.delay}s`, "--pet-dx": `${(item.dx ?? 0).toFixed(2)}px`, "--pet-dy": `${(item.dy ?? 0).toFixed(2)}px` } as CSSProperties}>
              {item.kind === "heart" && <path d={heartPath(0, 0, item.size)} fill="#ff6f86" stroke="#d83e5d" strokeWidth={1} strokeLinejoin="round" />}
              {item.kind === "sparkle" && <path d={sparklePath(0, 0, item.size)} fill="#ffe28a" stroke="#eba935" strokeWidth={0.6} />}
              {item.kind === "burst" && <path d={sparklePath(0, 0, item.size)} fill={palette.glow} stroke="#fff" strokeWidth={0.5} />}
              {item.kind === "flash" && <circle r={item.size} fill={palette.glow} />}
            </g>
          </g>
        ))}
      </g>
    </svg>
  );
}
