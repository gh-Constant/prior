// Supported UI languages.
import { setAccountPreference } from "../accountDocuments";
//
// Only interface chrome goes through i18n. Content created by the user
// (task titles, notes, habits, AI answers, project names…) is never
// translated and always stays in the language it was written in.
export const LANGUAGES = [
  { code: "en", label: "English", nativeName: "English" },
  { code: "fr", label: "French", nativeName: "Français" },
  { code: "es", label: "Spanish", nativeName: "Español" },
  { code: "de", label: "German", nativeName: "Deutsch" },
  { code: "pt", label: "Portuguese", nativeName: "Português" },
] as const;

export type Language = (typeof LANGUAGES)[number]["code"];

export const DEFAULT_LANGUAGE: Language = "en";

const STORAGE_KEY = "prior.language";

function baseTag(tag: string): string {
  return tag.toLowerCase().split(/[-_]/)[0] ?? "";
}

// Reads the device language: OS locale on desktop/mobile builds, browser
// language on web. Covers PC, navigateur et téléphone via navigator.
export function detectLanguage(): Language {
  const nav = typeof navigator === "undefined" ? undefined : navigator;
  const candidates = [...(nav?.languages ?? []), nav?.language ?? ""];
  for (const candidate of candidates) {
    const base = baseTag(candidate);
    if (LANGUAGES.some((entry) => entry.code === base)) return base as Language;
  }
  return DEFAULT_LANGUAGE;
}

export function getStoredLanguage(): Language | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return LANGUAGES.some((entry) => entry.code === raw) ? (raw as Language) : null;
  } catch {
    return null;
  }
}

export function setStoredLanguage(lang: Language): void {
  try {
    localStorage.setItem(STORAGE_KEY, lang);
    setAccountPreference("ui", { [STORAGE_KEY]: lang });
  } catch {
    // Private mode etc. — the language simply won't persist.
  }
}

// Explicit choice wins, otherwise follow the device.
export function resolveInitialLanguage(): Language {
  return getStoredLanguage() ?? detectLanguage();
}

export function languageName(code: Language): string {
  return LANGUAGES.find((entry) => entry.code === code)?.nativeName ?? code;
}
