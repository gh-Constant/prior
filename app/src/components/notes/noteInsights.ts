import type { Note, NoteFolder } from "../../lib/notes";

/** Pure, render-free helpers that derive the note metadata the workspace shows. */

export type OutlineHeading = { readonly level: number; readonly text: string; readonly line: number };

const FENCE = /^\s*```/;
const HEADING = /^(#{1,6})\s+(.+)$/;
const WIKI_LINK = /\[\[([^\]|#]+)/g;

/** Strips the inline Markdown a heading may carry so the outline reads as plain text. */
export function plainInline(value: string): string {
  return value
    .replace(/!?\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2")
    .replace(/!?\[\[([^\]]+)\]\]/g, "$1")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/(\*\*|__|~~|`|\$)/g, "")
    .trim();
}

/** Headings in document order, skipping fenced code so indexes match rendered <h*> elements. */
export function extractOutline(body: string): OutlineHeading[] {
  const headings: OutlineHeading[] = [];
  let inCode = false;
  body.replace(/\r\n?/g, "\n").split("\n").forEach((line, index) => {
    if (FENCE.test(line)) { inCode = !inCode; return; }
    if (inCode) return;
    const match = line.match(HEADING);
    if (match) headings.push({ level: match[1].length, text: plainInline(match[2]) || match[2].trim(), line: index });
  });
  return headings;
}

/** Unique #tags used in the body, outside code, in first-seen order. */
export function extractTags(body: string): string[] {
  const seen = new Map<string, string>();
  let inCode = false;
  for (const rawLine of body.replace(/\r\n?/g, "\n").split("\n")) {
    if (FENCE.test(rawLine)) { inCode = !inCode; continue; }
    if (inCode) continue;
    const line = rawLine.replace(/`[^`]*`/g, " ");
    for (const match of line.matchAll(/(^|\s)#([\w-]+)/g)) {
      const tag = match[2];
      if (/^\d+$/.test(tag)) continue;
      const key = tag.toLowerCase();
      if (!seen.has(key)) seen.set(key, tag);
    }
  }
  return [...seen.values()];
}

export function countWords(body: string): number {
  return body.trim().split(/\s+/).filter(Boolean).length;
}

/** Lower-cased titles a note links to with [[wiki links]]. */
export function linkTargets(body: string): Set<string> {
  const targets = new Set<string>();
  for (const match of body.matchAll(WIKI_LINK)) {
    const target = match[1].trim().toLowerCase();
    if (target) targets.add(target);
  }
  return targets;
}

/** Notes whose body links to `note` (case-insensitive, like the link resolver). */
export function findBacklinks(note: Note, notes: readonly Note[]): Note[] {
  const title = note.title.trim().toLowerCase();
  if (!title) return [];
  return notes.filter((candidate) => candidate.id !== note.id && linkTargets(candidate.body).has(title));
}

/** Notes connected to `note` in either direction: resolved outgoing links first, then backlinks. */
export function findNeighbors(note: Note, notes: readonly Note[]): Note[] {
  const byTitle = new Map(notes.map((candidate) => [candidate.title.trim().toLowerCase(), candidate] as const));
  const neighbors = new Map<string, Note>();
  for (const target of linkTargets(note.body)) {
    const linked = byTitle.get(target);
    if (linked && linked.id !== note.id) neighbors.set(linked.id, linked);
  }
  for (const backlink of findBacklinks(note, notes)) neighbors.set(backlink.id, backlink);
  return [...neighbors.values()];
}

/** Folder ancestry from the top level down to `folderId`. */
export function folderChain(folderId: string | null, folders: readonly NoteFolder[]): NoteFolder[] {
  const chain: NoteFolder[] = [];
  let current = folderId ? folders.find((folder) => folder.id === folderId) : undefined;
  let guard = 0;
  while (current && guard < 16) {
    chain.unshift(current);
    const parentId = current.parentId;
    current = parentId ? folders.find((folder) => folder.id === parentId) : undefined;
    guard += 1;
  }
  return chain;
}

/** Folder ids that (transitively) contain at least one of `notes`, for pruning a filtered tree. */
export function foldersWithNotes(notes: readonly Note[], folders: readonly NoteFolder[]): Set<string> {
  const ids = new Set<string>();
  for (const note of notes) for (const folder of folderChain(note.folderId, folders)) ids.add(folder.id);
  return ids;
}

/** Each unit applies while the elapsed amount, expressed in that unit, stays under the limit. */
const RELATIVE_STEPS: ReadonlyArray<readonly [Intl.RelativeTimeFormatUnit, number, number]> = [
  ["minute", 60, 60],
  ["hour", 60, 24],
  ["day", 24, 7],
];

/**
 * "2 min ago" for the last week, otherwise null so callers can fall back to a date.
 * Anything under 45 seconds reads as "now".
 */
export function relativeTime(iso: string, lang: string, now: number = Date.now()): string | null {
  const time = new Date(iso).getTime();
  if (Number.isNaN(time)) return null;
  let delta = (time - now) / 1000;
  const formatter = new Intl.RelativeTimeFormat(lang, { numeric: "auto", style: "short" });
  if (Math.abs(delta) < 45) return formatter.format(0, "second");
  for (const [unit, divisor, limit] of RELATIVE_STEPS) {
    delta /= divisor;
    if (Math.abs(delta) < limit) return formatter.format(Math.round(delta), unit);
  }
  return null;
}

/** "15 Sep" this year, "15 Sep 2025" otherwise. */
export function shortDate(iso: string, lang: string, now: number = Date.now()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const sameYear = date.getFullYear() === new Date(now).getFullYear();
  return date.toLocaleDateString(lang, { day: "numeric", month: "short", ...(sameYear ? {} : { year: "numeric" }) });
}
