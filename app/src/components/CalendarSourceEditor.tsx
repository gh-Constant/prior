import { useState } from "react";
import type { CalendarSource } from "../lib/calendar";
import { matchesHiddenTitle } from "../lib/calendarEvents";
import { useCalendarLabels } from "../lib/calendarLabels";
import { CalendarColors } from "./CalendarEventEditor";
import { Modal } from "./Modal";

export function CalendarSourceEditor({ initial, isNew, onClose, onSave, onRemove, onRefresh, syncing }: {
  initial: CalendarSource; isNew: boolean; onClose: () => void; onSave: (source: CalendarSource) => boolean;
  onRemove: () => boolean; onRefresh: () => void; syncing: boolean;
}) {
  const l = useCalendarLabels();
  const [source, setSource] = useState(initial);
  const [keyword, setKeyword] = useState("");
  const [error, setError] = useState("");
  const [removing, setRemoving] = useState(false);
  const imported = source.type !== "local";
  const hidden = Object.values(source.eventOverrides ?? {}).filter((value) => value.hidden).length;
  const matches = initial.events.filter((event) => matchesHiddenTitle(event.title, keyword));
  const rules = source.hiddenTitles ?? [];
  return <Modal title={isNew ? l.newCalendar : l.settings} onClose={onClose} className="calendar-editor-modal">
    <form className="calendar-editor-form" onSubmit={(event) => {
      event.preventDefault();
      if (!source.name.trim()) { setError(l.calendarName); return; }
      if (onSave({ ...source, name: source.name.trim() })) onClose(); else setError(l.storageError);
    }}>
      <p className="calendar-editor-hint">{imported ? l.readOnlyHint : l.localHint}</p>
      <label>{l.name}<input autoFocus required maxLength={150} value={source.name} onChange={(event) => setSource({ ...source, name: event.target.value })} /></label>
      <label>{l.description}<textarea rows={2} maxLength={2000} value={source.description ?? ""} onChange={(event) => setSource({ ...source, description: event.target.value })} /></label>
      <CalendarColors value={source.color} onChange={(color) => setSource({ ...source, color })} />
      <label className="calendar-checkbox"><input type="checkbox" checked={source.locked ?? false} onChange={(event) => setSource({ ...source, locked: event.target.checked })} />{l.locked}</label><small>{l.lockHint}</small>
      {imported && <section className="calendar-filter-settings"><h3>{l.filters}</h3><p>{l.filterHint}</p>
        <div className="calendar-filter-input"><input aria-label={l.keyword} placeholder={l.keyword} value={keyword} maxLength={150} onChange={(event) => setKeyword(event.target.value)} /><button type="button" className="secondary-button" disabled={!keyword.trim()} onClick={() => { if (!rules.includes(keyword.trim())) setSource({ ...source, hiddenTitles: [...rules, keyword.trim()] }); setKeyword(""); }}>{l.addRule}</button></div>
        {keyword.trim() && <div className="calendar-filter-preview" role="status"><strong>{matches.length} {l.matches}</strong>{matches.slice(0, 3).map((event) => <span key={event.id}>{event.title} · {event.date}</span>)}</div>}
        <ul className="calendar-rule-list">{rules.map((rule, index) => <li key={`${rule}-${index}`}><span>{rule}</span><small>{initial.events.filter((event) => matchesHiddenTitle(event.title, rule)).length} {l.matches}</small><button type="button" aria-label={`${l.delete} ${rule}`} onClick={() => setSource({ ...source, hiddenTitles: rules.filter((_, i) => i !== index) })}>×</button></li>)}</ul>
        {hidden > 0 && <button type="button" className="secondary-button" onClick={() => setSource({ ...source, eventOverrides: Object.fromEntries(Object.entries(source.eventOverrides ?? {}).map(([id, value]) => [id, { ...value, hidden: false }])) })}>{l.restore} ({hidden})</button>}
        {(source.url || source.accountId) && <button type="button" className="secondary-button" disabled={syncing} onClick={onRefresh}>{syncing ? "…" : l.refresh}</button>}
        {initial.syncError && <p role="alert">{l.syncError}</p>}
      </section>}
      {removing && <div className="calendar-delete-confirm"><p>{l.removeHint}</p><button type="button" className="secondary-button" onClick={() => { if (onRemove()) onClose(); else setError(l.storageError); }}>{l.deleteConfirm}</button><button type="button" onClick={() => setRemoving(false)}>{l.cancel}</button></div>}
      {error && <p role="alert" className="calendar-import-error">{error}</p>}
      <div className="calendar-editor-actions">{!isNew && <button type="button" className="secondary-button" onClick={() => setRemoving(true)}>{l.removeCalendar}</button>}<button type="button" className="secondary-button" onClick={onClose}>{l.cancel}</button><button type="submit" className="primary-button">{l.save}</button></div>
    </form>
  </Modal>;
}
