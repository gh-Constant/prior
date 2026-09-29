// Glue between the app's actions and the game's feedback: where a completion
// burst starts, where its "+XP" label lands, how much motion and which
// confetti the player chose, and the pet's reaction. Nothing happens here in
// Calm mode.
import { useEffect, useState } from "react";
import { celebrateCompletion } from "../../components/game/fx/celebrate";
import { playSound, type GameSound } from "../fx/sound";
import type { Habit, QuadrantKey, Task } from "../../types";
import { quadrantFor } from "../priority";
import { equippedConfetti } from "./catalog";
import { gameStore } from "./gameStore";
import { applyDailyCurve, HABIT_XP, MAX_HABIT_BONUS_XP, taskXp } from "./rules";
import type { EffectsIntensity, PetReaction } from "./types";

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";
const PET_REACTION_EVENT = "prior:pet-reaction";
/** Completion controls the burst should start from, most specific first. */
const CONTROL_SELECTOR = ".complete-control, .habit-check-wrap, .today-habit-check, button, [role='checkbox']";

const xpTargets = new Set<Element>();
let lastPointer: { readonly rect: DOMRect; readonly at: number } | null = null;

if (typeof document !== "undefined") {
  const remember = (target: EventTarget | null) => {
    const element = target instanceof Element ? target.closest(CONTROL_SELECTOR) ?? target : null;
    if (element) lastPointer = { rect: element.getBoundingClientRect(), at: Date.now() };
  };
  document.addEventListener("pointerdown", (event) => remember(event.target), true);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") remember(document.activeElement);
  }, true);
}

/** The XP bar labels fly into. The visible one wins (sidebar or mobile bar). */
export function registerXpTarget(element: Element | null): () => void {
  if (!element) return () => undefined;
  xpTargets.add(element);
  return () => xpTargets.delete(element);
}

function visibleXpTarget(): Element | null {
  for (const element of xpTargets) {
    const rect = element.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) return element;
  }
  return null;
}

function origin(): DOMRect {
  if (lastPointer && Date.now() - lastPointer.at < 3000) return lastPointer.rect;
  const width = typeof window === "undefined" ? 0 : window.innerWidth;
  const height = typeof window === "undefined" ? 0 : window.innerHeight;
  return new DOMRect(width / 2 - 10, height / 2 - 10, 20, 20);
}

/** The motion the player asked for; the system's reduced-motion setting wins. */
export function currentIntensity(): EffectsIntensity {
  const { enabled, profile } = gameStore.getSnapshot();
  if (!enabled || !profile) return "off";
  if (typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(REDUCED_MOTION).matches) return "off";
  return profile.effects;
}

export function gameSound(sound: GameSound): void {
  const { enabled, profile } = gameStore.getSnapshot();
  if (enabled && profile?.sounds) playSound(sound);
}

export function emitPetReaction(reaction: PetReaction): void {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent<PetReaction>(PET_REACTION_EVENT, { detail: reaction }));
}

/** The latest reaction to play on the companion, with a key that changes each time. */
export function usePetReaction(): { reaction: PetReaction | null; key: number } {
  const [state, setState] = useState<{ reaction: PetReaction | null; key: number }>({ reaction: null, key: 0 });
  useEffect(() => {
    const handle = (event: Event) => {
      const reaction = (event as CustomEvent<PetReaction>).detail;
      setState((current) => ({ reaction, key: current.key + 1 }));
    };
    window.addEventListener(PET_REACTION_EVENT, handle);
    return () => window.removeEventListener(PET_REACTION_EVENT, handle);
  }, []);
  return state;
}

/**
 * Celebrates a completion that earned xp (shown optimistically before the
 * server confirms it on sync).
 */
export function celebrateEarned(quadrant: QuadrantKey, xp: number): void {
  const { enabled, profile } = gameStore.getSnapshot();
  if (!enabled || !profile) return;
  void celebrateCompletion({
    quadrant,
    from: origin(),
    xp,
    to: visibleXpTarget(),
    intensity: currentIntensity(),
    theme: equippedConfetti(profile.equipped),
  });
  emitPetReaction("hop");
  gameSound("complete");
}

function localDay(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/** Shows a task completion's XP right away and celebrates it. */
export function rewardTaskCompletion(task: Pick<Task, "id" | "important" | "urgent" | "dueDate" | "createdAt">): void {
  const { enabled, profile } = gameStore.getSnapshot();
  if (!enabled || !profile) return;
  const quadrant = quadrantFor(task);
  const createdAt = new Date(task.createdAt);
  const raw = taskXp({ quadrant, dueDate: task.dueDate, createdAt: Number.isNaN(createdAt.getTime()) ? new Date(0) : createdAt, completedAt: new Date() });
  const xp = applyDailyCurve(profile.todayTaskXp, raw);
  gameStore.addOptimisticXp(task.id, xp);
  celebrateEarned(quadrant, xp);
}

/** Shows a habit check-in's XP right away. Only today and yesterday earn XP. */
export function rewardHabitCheckIn(habit: Pick<Habit, "id" | "important" | "urgent" | "completedDates">, date: string): void {
  const { enabled, profile } = gameStore.getSnapshot();
  if (!enabled || !profile) return;
  const today = new Date();
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  if (date !== localDay(today) && date !== localDay(yesterday)) return;
  const dates = new Set([...habit.completedDates, date]);
  let run = 0;
  for (let day = new Date(`${date}T12:00:00`); dates.has(localDay(day)); day.setDate(day.getDate() - 1)) run++;
  const xp = HABIT_XP + Math.min(Math.max(run - 1, 0), MAX_HABIT_BONUS_XP);
  gameStore.addOptimisticXp(`${habit.id}:${date}`, xp);
  celebrateEarned(quadrantFor(habit), xp);
}

/** Takes back optimistic XP when a completion is undone before syncing. */
export function revokeCompletion(id: string): void {
  gameStore.removeOptimisticXp(id);
}
