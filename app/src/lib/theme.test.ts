import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { memoryStorage } from "../test/memoryStorage";

type ThemeModule = typeof import("./theme");

/** A controllable (prefers-color-scheme: dark) query. */
function mockSystemTheme(dark: boolean) {
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  const query = {
    matches: dark,
    media: "(prefers-color-scheme: dark)",
    onchange: null,
    addEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => listeners.add(listener),
    removeEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => listeners.delete(listener),
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => true,
  };
  vi.stubGlobal("matchMedia", vi.fn(() => query));
  return {
    set(next: boolean) {
      query.matches = next;
      for (const listener of listeners) listener({ matches: next } as MediaQueryListEvent);
    },
  };
}

/** theme.ts keeps its listeners module-wide: every test gets a fresh copy. */
async function loadTheme(): Promise<ThemeModule> {
  vi.resetModules();
  return import("./theme");
}

describe("theme", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", memoryStorage());
    const meta = document.createElement("meta");
    meta.name = "theme-color";
    meta.content = "#20201f";
    document.head.append(meta);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.head.querySelector('meta[name="theme-color"]')?.remove();
    delete document.documentElement.dataset.theme;
    document.documentElement.style.colorScheme = "";
    document.documentElement.classList.remove("theme-switching");
  });

  it("parses only known preferences and defaults to the system", async () => {
    const theme = await loadTheme();
    expect(theme.parseThemePreference("dark")).toBe("dark");
    expect(theme.parseThemePreference("light")).toBe("light");
    expect(theme.parseThemePreference("system")).toBe("system");
    expect(theme.parseThemePreference("Dark")).toBeNull();
    expect(theme.parseThemePreference(null)).toBeNull();
    expect(theme.parseThemePreference(1)).toBeNull();

    expect(theme.getThemePreference()).toBe("system");
    localStorage.setItem("prior.theme", "sepia");
    expect(theme.getThemePreference()).toBe("system");
    localStorage.setItem("prior.theme", "dark");
    expect(theme.getThemePreference()).toBe("dark");
  });

  it("resolves the system preference through prefers-color-scheme", async () => {
    const theme = await loadTheme();
    mockSystemTheme(true);
    expect(theme.resolveTheme("system")).toBe("dark");
    expect(theme.resolveTheme("light")).toBe("light");
    mockSystemTheme(false);
    expect(theme.resolveTheme("system")).toBe("light");
    expect(theme.resolveTheme("dark")).toBe("dark");
  });

  it("falls back to light when matchMedia is unavailable", async () => {
    const theme = await loadTheme();
    vi.stubGlobal("matchMedia", undefined);
    expect(theme.resolveTheme("system")).toBe("light");
  });

  it("writes the resolved theme, color-scheme and browser chrome color to the document", async () => {
    const theme = await loadTheme();
    mockSystemTheme(true);
    expect(theme.applyTheme()).toBe("dark");
    const root = document.documentElement;
    expect(root.dataset.theme).toBe("dark");
    expect(root.style.colorScheme).toBe("dark");
    expect(document.querySelector('meta[name="theme-color"]')?.getAttribute("content")).toBe(theme.THEME_COLORS.dark);

    localStorage.setItem("prior.theme", "light");
    expect(theme.applyTheme()).toBe("light");
    expect(root.dataset.theme).toBe("light");
    expect(document.querySelector('meta[name="theme-color"]')?.getAttribute("content")).toBe(theme.THEME_COLORS.light);
  });

  it("saves a chosen preference locally and for the account, then notifies", async () => {
    const theme = await loadTheme();
    mockSystemTheme(false);
    const changed = vi.fn();
    window.addEventListener(theme.THEME_CHANGED, changed);

    theme.setThemePreference("dark");

    expect(localStorage.getItem("prior.theme")).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(changed).toHaveBeenCalledTimes(1);
    const { readAccountDocuments } = await import("./accountDocuments");
    expect(readAccountDocuments().records["preferences/ui"]).toMatchObject({ "prior.theme": "dark" });
    window.removeEventListener(theme.THEME_CHANGED, changed);
  });

  it("follows the system while the preference is system, and only then", async () => {
    const theme = await loadTheme();
    const system = mockSystemTheme(false);
    theme.initTheme();
    expect(document.documentElement.dataset.theme).toBe("light");

    act(() => system.set(true));
    expect(document.documentElement.dataset.theme).toBe("dark");

    theme.setThemePreference("light");
    act(() => system.set(false));
    act(() => system.set(true));
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("re-applies when synced account preferences arrive or another tab changes it", async () => {
    const theme = await loadTheme();
    const { PREFERENCES_APPLIED, UI_PREFERENCE_KEYS } = await import("./accountPreferences");
    expect(UI_PREFERENCE_KEYS).toContain("prior.theme");
    mockSystemTheme(false);
    theme.initTheme();

    localStorage.setItem("prior.theme", "dark");
    window.dispatchEvent(new Event(PREFERENCES_APPLIED));
    expect(document.documentElement.dataset.theme).toBe("dark");

    localStorage.setItem("prior.theme", "light");
    window.dispatchEvent(new StorageEvent("storage", { key: "prior.theme" }));
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("keeps React in sync through useThemePreference and useResolvedTheme", async () => {
    const theme = await loadTheme();
    const system = mockSystemTheme(false);
    const preference = renderHook(() => theme.useThemePreference());
    const resolved = renderHook(() => theme.useResolvedTheme());
    expect(preference.result.current).toBe("system");
    expect(resolved.result.current).toBe("light");

    act(() => system.set(true));
    expect(resolved.result.current).toBe("dark");

    act(() => theme.setThemePreference("light"));
    expect(preference.result.current).toBe("light");
    expect(resolved.result.current).toBe("light");
    preference.unmount();
    resolved.unmount();
  });

  it("swaps palettes without transitions only when the theme actually changes", async () => {
    const theme = await loadTheme();
    mockSystemTheme(false);
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => frames.push(callback));
    const root = document.documentElement;

    theme.applyTheme();
    expect(root.classList.contains("theme-switching")).toBe(false);

    theme.setThemePreference("dark");
    expect(root.classList.contains("theme-switching")).toBe(true);
    while (frames.length) frames.shift()?.(0);
    expect(root.classList.contains("theme-switching")).toBe(false);
  });
});
