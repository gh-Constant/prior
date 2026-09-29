// Light / dark appearance. The preference is a UI preference synced with the
// account (accountPreferences.ts); the resolved theme is written to
// <html data-theme="…"> before the first paint so CSS tokens never flash.
//
// First paint is handled by public/theme-init.js (a blocking script in
// index.html, external so it passes the Tauri CSP); initTheme() then takes over
// and keeps the document, the browser chrome and the native window in step.
import { useSyncExternalStore } from "react";
import { setAccountPreference } from "./accountDocuments";
import { PREFERENCES_APPLIED } from "./accountPreferences";
import { isDesktop } from "./platform";

export type ThemePreference = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

export const THEME_STORAGE_KEY = "prior.theme";
export const THEME_CHANGED = "prior-theme-changed";
export const THEME_PREFERENCES: readonly ThemePreference[] = ["system", "light", "dark"];
/** Canvas colors, for <meta name="theme-color"> (browser chrome). Mirrors --canvas in index.css. */
export const THEME_COLORS: Readonly<Record<ResolvedTheme, string>> = { light: "#fafaf9", dark: "#191715" };
const DARK_QUERY = "(prefers-color-scheme: dark)";

function darkQuery(): MediaQueryList | null {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return null;
  try {
    return window.matchMedia(DARK_QUERY);
  } catch {
    return null;
  }
}

function systemPrefersDark(): boolean {
  return darkQuery()?.matches ?? false;
}

/** Narrows an untrusted value (storage, synced preferences) to a preference. */
export function parseThemePreference(value: unknown): ThemePreference | null {
  return value === "light" || value === "dark" || value === "system" ? value : null;
}

export function getThemePreference(): ThemePreference {
  try {
    return parseThemePreference(localStorage.getItem(THEME_STORAGE_KEY)) ?? "system";
  } catch {
    // Storage can be blocked; fall through to the default.
    return "system";
  }
}

export function resolveTheme(preference: ThemePreference = getThemePreference()): ResolvedTheme {
  if (preference === "system") return systemPrefersDark() ? "dark" : "light";
  return preference;
}

let nativeRequested: string | undefined;

/** Desktop shells: the native window (title bar, traffic lights, menus) follows the preference. */
function syncNativeWindow(preference: ThemePreference): void {
  if (!isDesktop()) return; // Web has no window chrome to theme; Android keeps its system bars.
  // "system" hands control back to the OS so prefers-color-scheme keeps following it.
  const next = preference === "system" ? null : preference;
  const key = next ?? "system";
  if (nativeRequested === key) return;
  nativeRequested = key;
  void import("@tauri-apps/api/window")
    .then(({ getCurrentWindow }) => getCurrentWindow().setTheme(next))
    .catch(() => {
      // Older shells or a missing permission: the webview is still themed.
      nativeRequested = undefined;
    });
}

/** Swaps the palette in one frame: without this every button would fade between themes. */
function withoutTransitions(root: HTMLElement, change: () => void): void {
  if (typeof requestAnimationFrame !== "function") {
    change();
    return;
  }
  root.classList.add("theme-switching");
  change();
  requestAnimationFrame(() => requestAnimationFrame(() => root.classList.remove("theme-switching")));
}

/** Writes the resolved theme to the document root. */
export function applyTheme(): ResolvedTheme {
  const preference = getThemePreference();
  const theme = resolveTheme(preference);
  if (typeof document !== "undefined") {
    const root = document.documentElement;
    const write = () => {
      root.dataset.theme = theme;
      root.style.colorScheme = theme;
    };
    if (root.dataset.theme && root.dataset.theme !== theme) withoutTransitions(root, write);
    else write();
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", THEME_COLORS[theme]);
  }
  syncNativeWindow(preference);
  return theme;
}

function notify(): void {
  window.dispatchEvent(new Event(THEME_CHANGED));
}

export function setThemePreference(preference: ThemePreference): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, preference);
    // Follows the account to other devices (UI_PREFERENCE_KEYS).
    setAccountPreference("ui", { [THEME_STORAGE_KEY]: preference });
  } catch {
    // The theme still applies for this session.
  }
  applyTheme();
  notify();
}

let listening = false;

/** One set of global listeners re-applies the theme whatever its source of change. */
function listen(): void {
  if (listening || typeof window === "undefined") return;
  listening = true;
  const reapply = () => {
    applyTheme();
    notify();
  };
  darkQuery()?.addEventListener("change", () => {
    if (getThemePreference() === "system") reapply();
  });
  // Synced preferences arrived from the account.
  window.addEventListener(PREFERENCES_APPLIED, reapply);
  // Another tab or window of the web app changed it.
  window.addEventListener("storage", (event) => {
    if (event.key === null || event.key === THEME_STORAGE_KEY) reapply();
  });
}

function subscribe(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  listen();
  window.addEventListener(THEME_CHANGED, onChange);
  return () => window.removeEventListener(THEME_CHANGED, onChange);
}

export function useThemePreference(): ThemePreference {
  return useSyncExternalStore(subscribe, getThemePreference, () => "system");
}

/** The theme actually shown, following the system when the preference is "system". */
export function useResolvedTheme(): ResolvedTheme {
  return useSyncExternalStore(subscribe, () => resolveTheme(), () => "light");
}

/** Applies the theme now and keeps following system changes. Call once before rendering. */
export function initTheme(): void {
  applyTheme();
  listen();
}
