import { useEffect, useRef, useState, type DragEvent, type KeyboardEvent } from "react";
import { MAX_CHECKLIST_ITEMS, type ChecklistItem } from "../../types";
import { useI18n } from "../../lib/i18n";
import { generateUuid } from "../../lib/uuid";
import { Icon } from "../Icon";
import "./TaskExtras.css";

type Props = {
  readonly items: readonly ChecklistItem[];
  readonly onChange: (items: ChecklistItem[]) => void;
  readonly disabled?: boolean;
};

function renumber(items: ChecklistItem[]): ChecklistItem[] {
  return items.map((item, position) => ({ ...item, position }));
}

/** "3/5" style progress, or null for an empty checklist. */
export function checklistProgress(items: readonly ChecklistItem[] | undefined): { done: number; total: number } | null {
  if (!items?.length) return null;
  return { done: items.filter((item) => item.done).length, total: items.length };
}

/**
 * An ordered checklist: Enter adds the next item, Backspace on an empty item
 * deletes it, Alt+↑/↓ (or dragging the handle) reorders. Titles are saved
 * when an item loses focus, so typing does not create a sync write per key.
 */
export function ChecklistEditor({ items, onChange, disabled = false }: Props) {
  const { t } = useI18n();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [newTitle, setNewTitle] = useState("");
  const [dragId, setDragId] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const inputs = useRef(new Map<string, HTMLInputElement>());
  const focusNext = useRef<string | null>(null);
  const newInput = useRef<HTMLInputElement>(null);
  const sorted = [...items].sort((left, right) => left.position - right.position);
  const full = sorted.length >= MAX_CHECKLIST_ITEMS;
  const progress = checklistProgress(sorted);

  useEffect(() => {
    if (!focusNext.current) return;
    const target = focusNext.current === "new" ? newInput.current : inputs.current.get(focusNext.current);
    focusNext.current = null;
    target?.focus();
  });

  function commit(next: ChecklistItem[]) {
    onChange(renumber(next));
  }

  function titleOf(item: ChecklistItem): string {
    return drafts[item.id] ?? item.title;
  }

  function saveTitle(item: ChecklistItem) {
    const draft = drafts[item.id];
    if (draft === undefined) return;
    setDrafts(({ [item.id]: _removed, ...rest }) => rest);
    const title = draft.trim();
    if (title === item.title) return;
    if (!title) {
      commit(sorted.filter((entry) => entry.id !== item.id));
      return;
    }
    commit(sorted.map((entry) => (entry.id === item.id ? { ...entry, title } : entry)));
  }

  function addAfter(index: number, title = "") {
    if (full) return;
    const item: ChecklistItem = { id: generateUuid(), title: title.trim(), done: false, position: index + 1 };
    if (!item.title) {
      // An empty row only lives in the editor until it gets a title.
      focusNext.current = "new";
      return;
    }
    const next = [...sorted.slice(0, index + 1), item, ...sorted.slice(index + 1)];
    commit(next);
  }

  function move(index: number, delta: number) {
    const target = index + delta;
    if (target < 0 || target >= sorted.length) return;
    const next = [...sorted];
    const [item] = next.splice(index, 1);
    next.splice(target, 0, item);
    focusNext.current = item.id;
    setAnnouncement(t("checklist.moved", { title: item.title, position: target + 1, total: next.length }));
    commit(next);
  }

  function onItemKeyDown(event: KeyboardEvent<HTMLInputElement>, item: ChecklistItem, index: number) {
    if (event.key === "Enter") {
      event.preventDefault();
      saveTitle(item);
      addAfter(index);
    } else if (event.key === "Backspace" && titleOf(item) === "") {
      event.preventDefault();
      const previous = sorted[index - 1];
      focusNext.current = previous ? previous.id : "new";
      setDrafts(({ [item.id]: _removed, ...rest }) => rest);
      commit(sorted.filter((entry) => entry.id !== item.id));
    } else if (event.altKey && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
      event.preventDefault();
      saveTitle(item);
      move(index, event.key === "ArrowUp" ? -1 : 1);
    } else if (event.key === "ArrowDown" && !event.altKey) {
      const next = sorted[index + 1];
      if (next) inputs.current.get(next.id)?.focus(); else newInput.current?.focus();
    } else if (event.key === "ArrowUp" && !event.altKey) {
      const previous = sorted[index - 1];
      if (previous) inputs.current.get(previous.id)?.focus();
    }
  }

  function onNewKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      if (!newTitle.trim() || full) return;
      commit([...sorted, { id: generateUuid(), title: newTitle.trim(), done: false, position: sorted.length }]);
      setNewTitle("");
      focusNext.current = "new";
    } else if (event.key === "Backspace" && newTitle === "" && sorted.length) {
      event.preventDefault();
      inputs.current.get(sorted[sorted.length - 1].id)?.focus();
    } else if (event.key === "ArrowUp" && sorted.length) {
      inputs.current.get(sorted[sorted.length - 1].id)?.focus();
    }
  }

  function onDrop(event: DragEvent<HTMLLIElement>, targetId: string) {
    event.preventDefault();
    if (!dragId || dragId === targetId) return;
    const from = sorted.findIndex((item) => item.id === dragId);
    const to = sorted.findIndex((item) => item.id === targetId);
    setDragId(null);
    if (from < 0 || to < 0) return;
    const next = [...sorted];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    commit(next);
  }

  return (
    <section className="checklist-editor" aria-labelledby="checklist-heading">
      <div className="checklist-header">
        <h3 id="checklist-heading">{t("checklist.title")}</h3>
        {progress && <span className="checklist-count" aria-label={t("checklist.progress", { done: progress.done, total: progress.total })}>{progress.done}/{progress.total}</span>}
      </div>
      {progress && (
        <div className="checklist-bar" role="progressbar" aria-label={t("checklist.title")} aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={progress.done}>
          <span style={{ width: `${(progress.done / progress.total) * 100}%` }} />
        </div>
      )}
      <ul className="checklist-items">
        {sorted.map((item, index) => (
          <li
            key={item.id}
            className={`checklist-item ${item.done ? "done" : ""} ${dragId === item.id ? "dragging" : ""}`}
            onDragOver={(event) => { if (dragId) event.preventDefault(); }}
            onDrop={(event) => onDrop(event, item.id)}
          >
            <span
              className="checklist-handle"
              draggable={!disabled}
              aria-hidden="true"
              title={t("checklist.dragHint")}
              onDragStart={(event) => { setDragId(item.id); event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", item.id); }}
              onDragEnd={() => setDragId(null)}
            >
              <Icon name="grip" />
            </span>
            <input
              type="checkbox"
              checked={item.done}
              disabled={disabled}
              aria-label={item.done ? t("checklist.uncheck", { title: item.title }) : t("checklist.check", { title: item.title })}
              onChange={() => commit(sorted.map((entry) => (entry.id === item.id ? { ...entry, done: !entry.done } : entry)))}
            />
            <input
              ref={(node) => { if (node) inputs.current.set(item.id, node); else inputs.current.delete(item.id); }}
              className="checklist-title"
              value={titleOf(item)}
              disabled={disabled}
              maxLength={400}
              aria-label={t("checklist.itemLabel", { position: index + 1 })}
              aria-describedby="checklist-keys"
              onChange={(event) => setDrafts((current) => ({ ...current, [item.id]: event.target.value }))}
              onBlur={() => saveTitle(item)}
              onKeyDown={(event) => onItemKeyDown(event, item, index)}
            />
            <button type="button" className="checklist-remove" disabled={disabled} aria-label={t("checklist.remove", { title: item.title })} onClick={() => commit(sorted.filter((entry) => entry.id !== item.id))}>
              <Icon name="close" />
            </button>
          </li>
        ))}
      </ul>
      <div className="checklist-new">
        <Icon name="plus" aria-hidden="true" />
        <input
          ref={newInput}
          value={newTitle}
          disabled={disabled || full}
          maxLength={400}
          placeholder={full ? t("checklist.full") : t("checklist.add")}
          aria-label={t("checklist.add")}
          aria-describedby="checklist-keys"
          onChange={(event) => setNewTitle(event.target.value)}
          onKeyDown={onNewKeyDown}
          onBlur={() => {
            if (!newTitle.trim() || full) return;
            commit([...sorted, { id: generateUuid(), title: newTitle.trim(), done: false, position: sorted.length }]);
            setNewTitle("");
          }}
        />
      </div>
      <p id="checklist-keys" className="visually-hidden">{t("checklist.keys")}</p>
      <p className="visually-hidden" aria-live="polite">{announcement}</p>
    </section>
  );
}
