import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useFloatingMenu } from "../hooks/useFloatingMenu";
import { useI18n } from "../lib/i18n";
import { Icon } from "./Icon";
import "./DateTimePicker.css";

type Props = {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly time?: string | null;
  readonly onTimeChange?: (value: string | null) => void;
  readonly allowTime?: boolean;
  readonly min?: string;
  readonly ariaLabel: string;
  readonly placeholder?: string;
  readonly disabled?: boolean;
  readonly required?: boolean;
  readonly className?: string;
};

const WEEK_START_MONDAY = [1, 2, 3, 4, 5, 6, 0];

function dateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function parseDate(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(year, month - 1, day);
  return parsed.getFullYear() === year && parsed.getMonth() === month - 1 && parsed.getDate() === day ? parsed : null;
}

function monthStart(value?: string): Date {
  const selected = value ? parseDate(value) : null;
  const basis = selected ?? new Date();
  return new Date(basis.getFullYear(), basis.getMonth(), 1);
}

function calendarDays(month: Date): Date[] {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const leading = (first.getDay() + 6) % 7;
  const start = new Date(first);
  start.setDate(first.getDate() - leading);
  return Array.from({ length: 42 }, (_, index) => {
    const day = new Date(start);
    day.setDate(start.getDate() + index);
    return day;
  });
}

function addDays(value: Date, count: number): Date {
  const result = new Date(value);
  result.setDate(result.getDate() + count);
  return result;
}

export function formatDateTimePickerValue(value: string, time: string | null | undefined, lang: string, fallback: string): string {
  const date = parseDate(value);
  if (!date) return fallback;
  const today = new Date();
  const todayValue = dateKey(today);
  const tomorrowValue = dateKey(addDays(today, 1));
  const relative = value === todayValue
    ? new Intl.RelativeTimeFormat(lang, { numeric: "auto" }).format(0, "day")
    : value === tomorrowValue
      ? new Intl.RelativeTimeFormat(lang, { numeric: "auto" }).format(1, "day")
      : new Intl.DateTimeFormat(lang, { day: "numeric", month: "short", year: date.getFullYear() === today.getFullYear() ? undefined : "numeric" }).format(date);
  return time ? `${relative} · ${time}` : relative;
}

export function DateTimePicker({ value, onChange, time, onTimeChange, allowTime = false, min, ariaLabel, placeholder, disabled = false, required = false, className = "" }: Props) {
  const { t, lang } = useI18n();
  const [open, setOpen] = useState(false);
  const [visibleMonth, setVisibleMonth] = useState(() => monthStart(value));
  const triggerRef = useRef<HTMLButtonElement>(null);
  const floating = useFloatingMenu(triggerRef, { open, onClose: () => setOpen(false), minWidth: 292, maxWidth: 332, estimatedHeight: allowTime ? 424 : 370 });
  const days = useMemo(() => calendarDays(visibleMonth), [visibleMonth]);
  const today = dateKey(new Date());
  const tomorrow = dateKey(addDays(new Date(), 1));

  useEffect(() => {
    if (open) setVisibleMonth(monthStart(value));
  }, [open, value]);

  function selectDate(next: string) {
    if (min && next < min) return;
    onChange(next);
  }

  const popup = open ? (
    <div ref={floating.menuRef} className={`date-time-picker-menu ${floating.placement === "top" ? "open-top" : "open-bottom"}`} style={floating.style} role="dialog" aria-label={ariaLabel}>
      <div className="date-time-picker-shortcuts">
        <button type="button" onClick={() => selectDate(today)}>{t("common.datePicker.today")}</button>
        <button type="button" onClick={() => selectDate(tomorrow)}>{t("common.datePicker.tomorrow")}</button>
      </div>
      <div className="date-time-picker-month-header">
        <button type="button" aria-label={t("common.datePicker.previousMonth")} onClick={() => setVisibleMonth((current) => new Date(current.getFullYear(), current.getMonth() - 1, 1))}><Icon name="chevron-left" /></button>
        <strong>{new Intl.DateTimeFormat(lang, { month: "long", year: "numeric" }).format(visibleMonth)}</strong>
        <button type="button" aria-label={t("common.datePicker.nextMonth")} onClick={() => setVisibleMonth((current) => new Date(current.getFullYear(), current.getMonth() + 1, 1))}><Icon name="chevron-right" /></button>
      </div>
      <div className="date-time-picker-weekdays" aria-hidden="true">
        {WEEK_START_MONDAY.map((weekday) => <span key={weekday}>{new Intl.DateTimeFormat(lang, { weekday: "narrow" }).format(new Date(2026, 5, 7 + weekday))}</span>)}
      </div>
      <div className="date-time-picker-grid" role="grid">
        {days.map((day) => {
          const key = dateKey(day);
          const outside = day.getMonth() !== visibleMonth.getMonth();
          const unavailable = Boolean(min && key < min);
          return <button key={key} type="button" role="gridcell" disabled={unavailable} aria-selected={key === value} className={`${outside ? "outside" : ""} ${key === today ? "today" : ""} ${key === value ? "selected" : ""}`.trim()} onClick={() => selectDate(key)}>{day.getDate()}</button>;
        })}
      </div>
      {allowTime && onTimeChange && (
        <div className="date-time-picker-time-row">
          <div><Icon name="clock" /><span>{t("common.datePicker.time")}</span></div>
          {time ? (
            <div className="date-time-picker-time-controls">
              <input type="time" aria-label={t("common.datePicker.time")} value={time} onChange={(event) => onTimeChange(event.target.value || null)} />
              <button type="button" className="date-time-picker-remove-time" onClick={() => onTimeChange(null)}>{t("common.datePicker.removeTime")}</button>
            </div>
          ) : (
            <button type="button" className="date-time-picker-add-time" onClick={() => { if (!value) selectDate(today); onTimeChange("09:00"); }}><Icon name="plus" />{t("common.datePicker.addTime")}</button>
          )}
        </div>
      )}
      <div className="date-time-picker-footer">
        {!required && <button type="button" className="date-time-picker-clear" disabled={!value} onClick={() => { onChange(""); onTimeChange?.(null); }}>{t("common.datePicker.clear")}</button>}
        <button type="button" className="date-time-picker-done" onClick={() => setOpen(false)}>{t("common.datePicker.done")}</button>
      </div>
    </div>
  ) : null;

  return (
    <div className={`date-time-picker ${className}`.trim()}>
      <button ref={triggerRef} type="button" className={`date-time-picker-trigger ${open ? "open" : ""} ${value ? "has-value" : ""}`} aria-label={`${ariaLabel} · ${t("common.datePicker.open")}`} aria-haspopup="dialog" aria-expanded={open} disabled={disabled} onClick={() => setOpen((current) => !current)}>
        <Icon name="calendar-check" />
        <span>{formatDateTimePickerValue(value, time, lang, placeholder ?? ariaLabel)}</span>
        <Icon name="chevron-down" className="date-time-picker-chevron" />
      </button>
      <input className="date-time-picker-value-input" type="text" aria-label={ariaLabel} value={value} disabled={disabled} tabIndex={-1} onChange={(event) => onChange(event.target.value)} />
      {floating.portalTarget && popup ? createPortal(popup, floating.portalTarget) : popup}
    </div>
  );
}
