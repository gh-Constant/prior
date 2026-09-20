import { useEffect, useRef, useState } from "react";
import type { CalendarEvent, CalendarSource } from "../lib/calendar";
import { CALENDAR_COLORS, parseDateKey } from "../lib/calendar";
import { validateCalendarEvent, type EventEditScope } from "../lib/calendarEvents";
import { useCalendarLabels } from "../lib/calendarLabels";
import { draftCalendarEvent } from "../lib/calendarAgent";
import { Modal } from "./Modal";

export function CalendarColors({ value, onChange, defaultOption = false }: { value: string; onChange: (color: string) => void; defaultOption?: boolean }) {
  const l = useCalendarLabels();
  return <div className="calendar-colors" role="group" aria-label={l.color}>
    {defaultOption && <button type="button" aria-pressed={!value} onClick={() => onChange("")}>{l.defaultColor}</button>}
    {CALENDAR_COLORS.map((color) => <button type="button" key={color} style={{ background: color }} className="calendar-color-choice" aria-label={`${l.color} ${color}`} aria-pressed={value === color} onClick={() => onChange(color)}>{value === color ? "✓" : ""}</button>)}
    <label className="calendar-custom-color"><span>{l.color}</span><input type="color" aria-label={l.color} value={value || CALENDAR_COLORS[0]} onChange={(event) => onChange(event.target.value)} /></label>
  </div>;
}

export function CalendarEventEditor({ initial, sources, editing, onClose, onSave, onDelete }: {
  initial: CalendarEvent; sources: CalendarSource[]; editing?: CalendarEvent; onClose: () => void;
  onSave: (event: CalendarEvent, scope: EventEditScope) => boolean; onDelete?: (scope: EventEditScope) => boolean;
}) {
  const l = useCalendarLabels();
  const [draft, setDraft] = useState(initial);
  const [scope, setScope] = useState<EventEditScope>("series");
  const [endMode, setEndMode] = useState(initial.recurrence?.until ? "until" : initial.recurrence?.count ? "after" : "never");
  const [error, setError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [aiReady, setAiReady] = useState(false);
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  const localSources = sources.filter((source) => source.type === "local");
  const set = (patch: Partial<CalendarEvent>) => setDraft((current) => ({ ...current, ...patch }));
  const rule = draft.recurrence;
  const recurringEdit = Boolean(editing?.recurrence);

  async function prepare() {
    const controller = new AbortController();
    request.current?.abort(); request.current = controller;
    setBusy(true); setError(""); setAiReady(false);
    try {
      const next = await draftCalendarEvent(prompt, draft, controller.signal);
      setDraft(next); setEndMode(next.recurrence?.until ? "until" : next.recurrence?.count ? "after" : "never"); setAiReady(true);
    } catch {
      if (!controller.signal.aborted) setError(l.aiError);
    } finally { if (!controller.signal.aborted) setBusy(false); }
  }

  return <Modal title={editing ? l.editEvent : l.newEvent} onClose={onClose} className="calendar-editor-modal">
    <form className="calendar-editor-form" onSubmit={(event) => {
      event.preventDefault();
      const validation = validateCalendarEvent(draft);
      if (validation) { setError(l[validation as keyof typeof l] as string); return; }
      if (onSave(draft, scope)) onClose();
      else setError(l.storageError);
    }}>
      {!editing && <section className="calendar-ai-draft"><button type="button" className="secondary-button" onClick={() => setAiOpen(!aiOpen)} aria-expanded={aiOpen}>✦ {l.ai}</button>{aiOpen && <>
        <p>{l.aiHint}</p><textarea aria-label={l.ai} value={prompt} maxLength={4000} onChange={(event) => setPrompt(event.target.value)} placeholder={l.aiPlaceholder} disabled={busy} />
        <button type="button" className="secondary-button" disabled={busy || !prompt.trim()} onClick={() => void prepare()}>{busy ? l.thinking : l.ai}</button>
        {busy && <button type="button" onClick={() => { request.current?.abort(); setBusy(false); }}>{l.cancel}</button>}
        <p role="status" aria-live="polite">{busy ? l.thinking : aiReady ? l.aiReady : ""}</p>
      </>}</section>}
      <fieldset disabled={busy} className="calendar-editor-fields">
        {recurringEdit && <label>{l.scope}<select value={scope} onChange={(event) => {
          const nextScope = event.target.value as EventEditScope; setScope(nextScope);
          if (nextScope === "occurrence") set({ ...initial, date: editing!.occurrenceDate ?? editing!.date, endDate: editing!.endDate, recurrence: undefined });
          else { setDraft(initial); setEndMode(initial.recurrence?.until ? "until" : initial.recurrence?.count ? "after" : "never"); }
        }}><option value="series">{l.series}</option><option value="occurrence">{l.occurrence}</option></select></label>}
        <label>{l.title}<input autoFocus required maxLength={300} value={draft.title} onChange={(event) => set({ title: event.target.value })} /></label>
        <label>{l.calendar}<select value={draft.sourceId} required onChange={(event) => set({ sourceId: event.target.value })}>{localSources.map((source) => <option key={source.id} value={source.id}>{source.name}</option>)}</select></label>
        <label className="calendar-checkbox"><input type="checkbox" checked={draft.startTime === null} onChange={(event) => set({ startTime: event.target.checked ? null : "10:00", endTime: event.target.checked ? null : "11:00" })} />{l.allDay}</label>
        <div className="calendar-form-grid">
          <label>{l.start}<input type="date" required min="1900-01-01" max="2200-12-31" value={draft.date} onChange={(event) => set({ date: event.target.value, endDate: (draft.endDate ?? draft.date) < event.target.value ? event.target.value : draft.endDate })} /></label>
          <label>{l.end}<input type="date" required min={draft.date} max="2200-12-31" value={draft.endDate ?? draft.date} onChange={(event) => set({ endDate: event.target.value })} /></label>
          {draft.startTime !== null && <><label>{l.start}<input type="time" required value={draft.startTime} onChange={(event) => set({ startTime: event.target.value })} /></label><label>{l.end}<input type="time" required value={draft.endTime ?? ""} onChange={(event) => set({ endTime: event.target.value })} /></label></>}
        </div>
        <small>{l.timezone} · {Intl.DateTimeFormat().resolvedOptions().timeZone}</small>
        {scope !== "occurrence" && <><label>{l.repeat}<select value={rule?.frequency ?? "none"} onChange={(event) => { set({ recurrence: event.target.value === "none" ? undefined : { frequency: event.target.value as NonNullable<CalendarEvent["recurrence"]>["frequency"], interval: 1, weekdays: [parseDateKey(draft.date).getDay()] } }); setEndMode("never"); }}>
          {(["none", "daily", "weekly", "monthly", "yearly"] as const).map((value) => <option value={value} key={value}>{l[value]}</option>)}</select></label>
          {rule && <div className="calendar-recurrence-fields"><label>{l.every}<input type="number" required min={1} max={365} value={rule.interval} onChange={(event) => set({ recurrence: { ...rule, interval: Number(event.target.value) } })} /></label>
            {rule.frequency === "weekly" && <div role="group" aria-label={l.days} className="calendar-weekdays">{[1, 2, 3, 4, 5, 6, 0].map((day) => <button type="button" key={day} aria-pressed={rule.weekdays?.includes(day) ?? false} onClick={() => set({ recurrence: { ...rule, weekdays: rule.weekdays?.includes(day) ? rule.weekdays.filter((value) => value !== day) : [...(rule.weekdays ?? []), day] } })}>{l.weekdays[day]}</button>)}</div>}
            <label>{l.ends}<select value={endMode} onChange={(event) => { setEndMode(event.target.value); set({ recurrence: { ...rule, until: event.target.value === "until" ? draft.date : undefined, count: event.target.value === "after" ? 10 : undefined } }); }}>{["never", "until", "after"].map((value) => <option value={value} key={value}>{l[value as "never"]}</option>)}</select></label>
            {endMode === "until" && <label>{l.until}<input type="date" required min={draft.date} value={rule.until ?? ""} onChange={(event) => set({ recurrence: { ...rule, until: event.target.value } })} /></label>}
            {endMode === "after" && <label>{l.count}<input type="number" required min={1} max={10000} value={rule.count ?? 10} onChange={(event) => set({ recurrence: { ...rule, count: Number(event.target.value) } })} /></label>}
          </div>}
        </>}
        <label>{l.location}<input maxLength={1000} value={draft.location ?? ""} onChange={(event) => set({ location: event.target.value })} /></label>
        <label>{l.description}<textarea rows={3} maxLength={10000} value={draft.description ?? ""} onChange={(event) => set({ description: event.target.value })} /></label>
        <CalendarColors defaultOption value={draft.customColor ?? ""} onChange={(color) => set({ customColor: color || undefined })} />
        <label className="calendar-checkbox"><input type="checkbox" checked={localSources.find((source) => source.id === draft.sourceId)?.locked || (draft.locked ?? false)} disabled={localSources.find((source) => source.id === draft.sourceId)?.locked} onChange={(event) => set({ locked: event.target.checked })} />{l.locked}{localSources.find((source) => source.id === draft.sourceId)?.locked ? ` · ${l.calendar}` : ""}</label><small>{l.lockHint}</small>
      </fieldset>
      {error && <p role="alert" className="calendar-import-error">{error}</p>}
      {confirmDelete && <div className="calendar-delete-confirm"><p>{l.deleteHint}</p><button type="button" className="secondary-button" onClick={() => { if (onDelete?.(scope)) onClose(); else setError(l.storageError); }}>{l.deleteConfirm}</button><button type="button" onClick={() => setConfirmDelete(false)}>{l.cancel}</button></div>}
      <div className="calendar-editor-actions">{onDelete && <button type="button" className="secondary-button" disabled={busy} onClick={() => setConfirmDelete(true)}>{l.delete}</button>}<button type="button" className="secondary-button" onClick={onClose}>{l.cancel}</button><button type="submit" className="primary-button" disabled={busy || !localSources.length}>{l.save}</button></div>
    </form>
  </Modal>;
}
