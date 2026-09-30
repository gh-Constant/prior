import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { Habit, Project, Task } from "../types";
import type { Note } from "../lib/notes";
import { useI18n } from "../lib/i18n";
import { habitItems, noteItems, projectItems, readRecent, rememberRecent, searchPalette, taskItems, type PaletteItem, type PaletteKind } from "../lib/commandPalette";
import { Icon, type IconName } from "./Icon";
import "./CommandPalette.css";

export type PaletteCommand = { id: string; label: string; keywords?: string; icon: IconName; run: () => void };

type Props = {
  readonly tasks: readonly Task[];
  readonly habits: readonly Habit[];
  readonly notes: readonly Note[];
  readonly projects: readonly Project[];
  readonly commands: readonly PaletteCommand[];
  readonly onOpenTask: (task: Task) => void;
  readonly onOpenHabit: (habit: Habit) => void;
  readonly onOpenNote: (note: Note) => void;
  readonly onOpenProject: (project: Project) => void;
  readonly onClose: () => void;
};

const KIND_ICON: Record<PaletteKind, IconName> = { command: "command", task: "check-circle", habit: "refresh", note: "file", project: "folder" };

/** True for the palette shortcut: ⌘K on Apple platforms, Ctrl+K elsewhere. */
export function isPaletteShortcut(event: Pick<globalThis.KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey">, apple: boolean): boolean {
  if (event.key.toLowerCase() !== "k" || event.altKey || event.shiftKey) return false;
  // On macOS, Ctrl+K is "delete to end of line" in text fields: leave it.
  return apple ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
}

/** ⌘K / Ctrl+K search and command palette (ARIA combobox + listbox). */
export function CommandPalette({ tasks, habits, notes, projects, commands, onOpenTask, onOpenHabit, onOpenNote, onOpenProject, onClose }: Props) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const recent = useMemo(() => readRecent(), []);

  const items = useMemo<PaletteItem[]>(() => [
    ...commands.map((command) => ({ key: `command:${command.id}`, kind: "command" as const, id: command.id, label: command.label, keywords: command.keywords })),
    ...taskItems(tasks),
    ...habitItems(habits),
    ...noteItems(notes),
    ...projectItems(projects),
  ], [commands, tasks, habits, notes, projects]);
  const groups = useMemo(() => searchPalette(query, items, recent), [query, items, recent]);
  const flat = useMemo(() => groups.flatMap((group) => group.items), [groups]);
  const activeItem = flat[Math.min(active, flat.length - 1)];
  const optionId = (item: PaletteItem) => `${listId}-${item.key.replace(/[^a-zA-Z0-9_-]/g, "_")}`;

  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => { setActive(0); }, [query]);
  useEffect(() => {
    if (!activeItem) return;
    document.getElementById(optionId(activeItem))?.scrollIntoView?.({ block: "nearest" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeItem?.key]);

  function run(item: PaletteItem) {
    rememberRecent(item.key);
    onClose();
    if (item.kind === "command") commands.find((command) => command.id === item.id)?.run();
    else if (item.kind === "task") { const task = tasks.find((entry) => entry.id === item.id); if (task) onOpenTask(task); }
    else if (item.kind === "habit") { const habit = habits.find((entry) => entry.id === item.id); if (habit) onOpenHabit(habit); }
    else if (item.kind === "note") { const note = notes.find((entry) => entry.id === item.id); if (note) onOpenNote(note); }
    else { const project = projects.find((entry) => entry.id === item.id); if (project) onOpenProject(project); }
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") { event.preventDefault(); setActive((index) => (flat.length ? (index + 1) % flat.length : 0)); }
    else if (event.key === "ArrowUp") { event.preventDefault(); setActive((index) => (flat.length ? (index - 1 + flat.length) % flat.length : 0)); }
    else if (event.key === "Home" && event.ctrlKey) { event.preventDefault(); setActive(0); }
    else if (event.key === "End" && event.ctrlKey) { event.preventDefault(); setActive(Math.max(0, flat.length - 1)); }
    else if (event.key === "Enter") { event.preventDefault(); if (activeItem) run(activeItem); }
    else if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onClose(); }
    else if (event.key === "Tab") { event.preventDefault(); }
  }

  const groupLabel = (kind: PaletteKind | "recent") => t(`palette.groups.${kind}`);
  const iconFor = (item: PaletteItem): IconName => item.kind === "command" ? commands.find((command) => command.id === item.id)?.icon ?? "command" : KIND_ICON[item.kind];

  return (
    <div className="command-palette-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="command-palette" role="dialog" aria-modal="true" aria-label={t("palette.label")}>
        <div className="command-palette-search">
          <Icon name="search" aria-hidden="true" />
          <input
            ref={inputRef}
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={activeItem ? optionId(activeItem) : undefined}
            aria-label={t("palette.label")}
            placeholder={t("palette.placeholder")}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onKeyDown}
            autoComplete="off"
            spellCheck={false}
          />
          <kbd className="command-palette-esc">Esc</kbd>
        </div>
        <div ref={listRef} id={listId} role="listbox" className="command-palette-list" aria-label={t("palette.results")}>
          {groups.length === 0 && <p className="command-palette-empty" role="status">{t("palette.empty")}</p>}
          {groups.map((group) => (
            <div key={group.kind} role="group" aria-labelledby={`${listId}-${group.kind}`} className="command-palette-group">
              <div id={`${listId}-${group.kind}`} className="command-palette-group-label" role="presentation">{groupLabel(group.kind)}</div>
              {group.items.map((item) => {
                const selected = activeItem?.key === item.key;
                return (
                  <div
                    key={item.key}
                    id={optionId(item)}
                    role="option"
                    aria-selected={selected}
                    className={`command-palette-option ${selected ? "active" : ""} ${item.completed ? "completed" : ""}`}
                    onMouseMove={() => { const index = flat.findIndex((entry) => entry.key === item.key); if (index !== active) setActive(index); }}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => run(item)}
                  >
                    <Icon name={iconFor(item)} aria-hidden="true" />
                    <span className="command-palette-option-label">{item.label}</span>
                    {group.kind === "recent" && <span className="command-palette-option-kind">{groupLabel(item.kind)}</span>}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
        <div className="command-palette-footer" aria-hidden="true">
          <span><kbd>↑</kbd><kbd>↓</kbd> {t("palette.navigate")}</span>
          <span><kbd>↵</kbd> {t("palette.open")}</span>
        </div>
      </div>
    </div>
  );
}
