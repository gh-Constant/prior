// Desktop quick capture (specs/QUICK_CAPTURE.md). The shortcut is registered
// in Rust (tauri-plugin-global-shortcut) so it works while the main window is
// hidden; this module stores the per-device choice and pushes it to Rust.
import { isDesktop, isMac } from "./platform";

export const DEFAULT_QUICK_ADD_SHORTCUT = "CommandOrControl+Shift+Space";
export const QUICK_TASK_CREATED_EVENT = "prior://quick-task-created";
const SETTINGS_KEY = "prior.quick-add.v1";

export type QuickAddSettings = { enabled: boolean; shortcut: string };

export function getQuickAddSettings(): QuickAddSettings {
  try {
    const parsed = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}") as Partial<QuickAddSettings>;
    return {
      enabled: parsed.enabled !== false,
      shortcut: typeof parsed.shortcut === "string" && parsed.shortcut.trim() ? parsed.shortcut.trim() : DEFAULT_QUICK_ADD_SHORTCUT,
    };
  } catch {
    return { enabled: true, shortcut: DEFAULT_QUICK_ADD_SHORTCUT };
  }
}

export function saveQuickAddSettings(settings: QuickAddSettings): void {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* storage unavailable */ }
}

/** Registers (or clears) the global shortcut in the desktop shell. */
export async function applyQuickAddShortcut(settings = getQuickAddSettings()): Promise<void> {
  if (!isDesktop()) return;
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("quick_add_set_shortcut", { shortcut: settings.enabled ? settings.shortcut : null });
}

export function isQuickAddWindow(search = typeof window === "undefined" ? "" : window.location.search): boolean {
  return new URLSearchParams(search).get("quick-add") === "1";
}

const KEY_NAMES: Record<string, string> = { " ": "Space", ArrowUp: "Up", ArrowDown: "Down", ArrowLeft: "Left", ArrowRight: "Right", Escape: "Escape", Enter: "Enter", Tab: "Tab" };

/**
 * Accelerator for a key press ("CommandOrControl+Shift+Space"), or null while
 * only modifiers are held or when no modifier is used (a bare key would
 * steal typing in every app).
 */
export function acceleratorFromEvent(event: Pick<KeyboardEvent, "key" | "code" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey">, apple = isMac()): string | null {
  if (["Meta", "Control", "Alt", "Shift", "OS"].includes(event.key)) return null;
  const parts: string[] = [];
  if (apple ? event.metaKey : event.ctrlKey) parts.push("CommandOrControl");
  if (apple && event.ctrlKey) parts.push("Control");
  if (!apple && event.metaKey) parts.push("Super");
  if (event.altKey) parts.push("Alt");
  if (event.shiftKey) parts.push("Shift");
  if (!parts.length) return null;
  let key = KEY_NAMES[event.key] ?? "";
  if (!key) {
    if (/^Key[A-Z]$/.test(event.code)) key = event.code.slice(3);
    else if (/^Digit\d$/.test(event.code)) key = event.code.slice(5);
    else if (/^F\d{1,2}$/.test(event.key)) key = event.key;
    else return null;
  }
  return [...parts, key].join("+");
}

/** Human form: ⌘⇧Space on a Mac, Ctrl+Shift+Space elsewhere. */
export function formatShortcut(accelerator: string, apple = isMac()): string {
  const names = accelerator.split("+");
  if (apple) {
    const symbols: Record<string, string> = { CommandOrControl: "⌘", Command: "⌘", Control: "⌃", Alt: "⌥", Shift: "⇧", Super: "⌘" };
    return names.map((name) => symbols[name] ?? name).join("");
  }
  const labels: Record<string, string> = { CommandOrControl: "Ctrl", Control: "Ctrl", Super: "Win" };
  return names.map((name) => labels[name] ?? name).join("+");
}
