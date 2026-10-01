import { normalizeRecurrence } from "../recurrence";
import { parseTaskTitle } from "../taskTitleParser";
import type { ImportRecurrence } from "./types";

const PHRASE_LANGS = ["en-US", "fr-FR"] as const;

/**
 * Turns a repeat phrase from an export ("every monday", "every! 2 weeks",
 * "tous les lundis") into a recurrence, reusing the quick-add parser. Returns
 * null when the phrase is not a repeat rule the parser understands; the
 * importers then keep it as "Repeats: <text>" in the description.
 */
export function toRecurrence(text: string): ImportRecurrence | null {
  const phrase = text.trim();
  if (!phrase) return null;
  for (const lang of PHRASE_LANGS) {
    const value = parseTaskTitle(phrase, { lang }).fields.recurrence;
    const rule = value === undefined ? null : normalizeRecurrence(String(value));
    if (rule) return rule;
  }
  return null;
}
