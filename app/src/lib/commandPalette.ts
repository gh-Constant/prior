// Command palette search (specs/COMMAND_PALETTE.md): fuzzy results across
// tasks, habits, notes, projects and commands, grouped, recent items first.
import type { Habit, Project, Task } from "../types";
import type { Note } from "./notes";
import { bestScore } from "./fuzzy";

export type PaletteKind = "command" | "task" | "habit" | "note" | "project";

export type PaletteItem = {
  /** Unique across kinds: "<kind>:<id>". */
  key: string;
  kind: PaletteKind;
  id: string;
  label: string;
  detail?: string;
  /** Extra text that can match (description, checklist, keywords). */
  keywords?: string;
  completed?: boolean;
};

export type PaletteGroup = { kind: PaletteKind | "recent"; items: PaletteItem[] };

const RECENT_KEY = "prior.palette.recent.v1";
const RECENT_LIMIT = 8;
const GROUP_LIMIT = 8;

export function readRecent(): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]") as unknown;
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string").slice(0, RECENT_LIMIT) : [];
  } catch {
    return [];
  }
}

export function rememberRecent(key: string): void {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify([key, ...readRecent().filter((item) => item !== key)].slice(0, RECENT_LIMIT)));
  } catch { /* storage unavailable */ }
}

export function taskItems(tasks: readonly Task[]): PaletteItem[] {
  return tasks.filter((task) => !task.deletedAt).map((task) => ({
    key: `task:${task.id}`,
    kind: "task" as const,
    id: task.id,
    label: task.title,
    keywords: [task.description, ...(task.checklist ?? []).map((item) => item.title)].filter(Boolean).join(" "),
    completed: task.completed,
  }));
}

export function habitItems(habits: readonly Habit[]): PaletteItem[] {
  return habits.filter((habit) => !habit.deletedAt).map((habit) => ({ key: `habit:${habit.id}`, kind: "habit" as const, id: habit.id, label: habit.title }));
}

export function noteItems(notes: readonly Note[]): PaletteItem[] {
  return notes.filter((note) => !note.deletedAt).map((note) => ({ key: `note:${note.id}`, kind: "note" as const, id: note.id, label: note.title || note.body.slice(0, 60), keywords: note.body.slice(0, 2000) }));
}

export function projectItems(projects: readonly Project[]): PaletteItem[] {
  return projects.filter((project) => !project.deletedAt).map((project) => ({ key: `project:${project.id}`, kind: "project" as const, id: project.id, label: project.name, keywords: project.description }));
}

const KIND_ORDER: PaletteKind[] = ["command", "task", "habit", "note", "project"];

/**
 * Groups results for a query. With no query: recent items, then commands.
 * With a query: recent matches first, then each kind by score (open tasks
 * before completed ones).
 */
export function searchPalette(query: string, items: readonly PaletteItem[], recent: readonly string[] = []): PaletteGroup[] {
  const byKey = new Map(items.map((item) => [item.key, item]));
  const trimmed = query.trim();
  if (!trimmed) {
    const recentItems = recent.map((key) => byKey.get(key)).filter((item): item is PaletteItem => Boolean(item));
    const recentKeys = new Set(recentItems.map((item) => item.key));
    const groups: PaletteGroup[] = [];
    if (recentItems.length) groups.push({ kind: "recent", items: recentItems });
    groups.push({ kind: "command", items: items.filter((item) => item.kind === "command" && !recentKeys.has(item.key)) });
    return groups.filter((group) => group.items.length > 0);
  }
  const scored = items
    .map((item) => ({ item, score: bestScore(trimmed, [{ text: item.label, weight: 3 }, { text: item.detail ?? "", weight: 2 }, { text: item.keywords ?? "", weight: 1 }]) }))
    .filter((entry): entry is { item: PaletteItem; score: number } => entry.score !== null)
    .map((entry) => ({ ...entry, score: entry.score - (entry.item.completed ? 150 : 0) }))
    .sort((left, right) => right.score - left.score);
  const recentSet = new Set(recent);
  const recentMatches = scored.filter((entry) => recentSet.has(entry.item.key)).slice(0, 4).map((entry) => entry.item);
  const shown = new Set(recentMatches.map((item) => item.key));
  const groups: PaletteGroup[] = recentMatches.length ? [{ kind: "recent", items: recentMatches }] : [];
  for (const kind of KIND_ORDER) {
    const kindItems = scored.filter((entry) => entry.item.kind === kind && !shown.has(entry.item.key)).slice(0, GROUP_LIMIT).map((entry) => entry.item);
    if (kindItems.length) groups.push({ kind, items: kindItems });
  }
  return groups;
}
