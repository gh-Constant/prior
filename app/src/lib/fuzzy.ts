// Small fuzzy matcher for the command palette: every query character must
// appear in order. Word starts, consecutive runs and early matches score
// higher; accents and case are ignored.

export function foldText(value: string): string {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** Score of query against text, or null when it does not match. Higher is better. */
export function fuzzyScore(query: string, text: string): number | null {
  const needle = foldText(query).replace(/\s+/g, " ").trim();
  if (!needle) return 0;
  const haystack = foldText(text);
  // Exact substring beats any scattered match.
  const direct = haystack.indexOf(needle);
  if (direct >= 0) {
    const wordStart = direct === 0 || /[\s\-_/.:]/.test(haystack[direct - 1]);
    return 1000 - direct + (wordStart ? 200 : 0) + needle.length * 5;
  }
  let score = 0;
  let position = 0;
  let previous = -2;
  for (const char of needle) {
    if (char === " ") continue;
    const found = haystack.indexOf(char, position);
    if (found < 0) return null;
    if (found === previous + 1) score += 8;
    if (found === 0 || /[\s\-_/.:]/.test(haystack[found - 1])) score += 6;
    score -= Math.min(found - position, 10);
    previous = found;
    position = found + 1;
  }
  return score;
}

/** Best score over several fields (title weighs more than body text). */
export function bestScore(query: string, fields: ReadonlyArray<{ text: string; weight?: number }>): number | null {
  let best: number | null = null;
  for (const field of fields) {
    if (!field.text) continue;
    const score = fuzzyScore(query, field.text);
    if (score === null) continue;
    const weighted = score * (field.weight ?? 1);
    if (best === null || weighted > best) best = weighted;
  }
  return best;
}
