import { useEffect, useState } from "react";
import type { WorkspaceView } from "../components/AppSidebar";
import { PREFERENCES_APPLIED } from "./accountPreferences";
import { setAccountPreference } from "./accountDocuments";

/**
 * The spaces a person can switch off in the navigation (sidebar, phone
 * "More" screen, ⌘K). Today, Tasks and Projects are the core of Prior and
 * always stay. The choice is made in the product tour and in Settings →
 * General, and syncs with the account's UI preferences.
 */
export const OPTIONAL_VIEWS = ["calendar", "focus", "eisenhower", "habits", "notes", "inbox", "waiting", "mine"] as const satisfies readonly WorkspaceView[];
export type OptionalView = (typeof OPTIONAL_VIEWS)[number];

/** What the tour pre-selects: the spaces most people use every week. */
export const DEFAULT_ENABLED_VIEWS: readonly OptionalView[] = ["calendar", "focus", "eisenhower", "habits", "notes"];

export const HIDDEN_VIEWS_KEY = "prior.nav.hidden";
export const TOUR_DONE_KEY = "prior.tour.done";
export const TOUR_VERSION = "1";
const NAV_CHANGED = "prior-nav-changed";
export const REPLAY_TOUR_EVENT = "prior-replay-tour";

export function isOptionalView(view: string): view is OptionalView {
  return (OPTIONAL_VIEWS as readonly string[]).includes(view);
}

/** Hidden spaces; nothing is hidden until the person chooses (existing accounts keep everything). */
export function readHiddenViews(): OptionalView[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(HIDDEN_VIEWS_KEY) ?? "[]") as unknown;
    return Array.isArray(parsed) ? parsed.filter((value): value is OptionalView => typeof value === "string" && isOptionalView(value)) : [];
  } catch {
    return [];
  }
}

export function writeHiddenViews(hidden: readonly OptionalView[]): void {
  const value = JSON.stringify(OPTIONAL_VIEWS.filter((view) => hidden.includes(view)));
  try {
    localStorage.setItem(HIDDEN_VIEWS_KEY, value);
  } catch {
    // Storage unavailable: the choice lasts for this session.
  }
  setAccountPreference("ui", { [HIDDEN_VIEWS_KEY]: value });
  if (typeof window !== "undefined") window.dispatchEvent(new Event(NAV_CHANGED));
}

/** Saves the spaces chosen in the tour: everything optional that was not picked is hidden. */
export function writeEnabledViews(enabled: readonly OptionalView[]): void {
  writeHiddenViews(OPTIONAL_VIEWS.filter((view) => !enabled.includes(view)));
}

export function isTourDone(): boolean {
  try {
    return localStorage.getItem(TOUR_DONE_KEY) === TOUR_VERSION;
  } catch {
    return false;
  }
}

export function markTourDone(): void {
  try {
    localStorage.setItem(TOUR_DONE_KEY, TOUR_VERSION);
  } catch {
    // ignore
  }
  setAccountPreference("ui", { [TOUR_DONE_KEY]: TOUR_VERSION });
}

/** The hidden spaces, kept current across Settings, the tour and other devices. */
export function useHiddenViews(): readonly OptionalView[] {
  const [hidden, setHidden] = useState(readHiddenViews);
  useEffect(() => {
    const reload = () => setHidden(readHiddenViews());
    window.addEventListener(NAV_CHANGED, reload);
    window.addEventListener(PREFERENCES_APPLIED, reload);
    window.addEventListener("storage", reload);
    return () => {
      window.removeEventListener(NAV_CHANGED, reload);
      window.removeEventListener(PREFERENCES_APPLIED, reload);
      window.removeEventListener("storage", reload);
    };
  }, []);
  return hidden;
}

export function isViewShown(view: WorkspaceView, hidden: readonly OptionalView[]): boolean {
  return !isOptionalView(view) || !hidden.includes(view);
}
