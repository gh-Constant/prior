import { useState } from "react";
import type { RecurrenceUnit, TaskRecurrence } from "../../types";
import { useI18n } from "../../lib/i18n";
import {
  MAX_RECURRENCE_INTERVAL,
  describeRecurrence,
  localDateKey,
  normalizeRecurrence,
  ordinalDay,
  presetOf,
  presetRecurrence,
  weekdayName,
  weekdayOfKey,
  type RecurrencePreset,
} from "../../lib/recurrence";
import { CustomSelect } from "../CustomSelect";
import { DateTimePicker } from "../DateTimePicker";
import { Icon } from "../Icon";
import "./TaskExtras.css";

type Props = {
  readonly value: TaskRecurrence | null | undefined;
  /** The task's due date: presets are worded against it (today when none). */
  readonly dueDate: string | null | undefined;
  /** The parent also gives a repeating task without a due date today as its first one. */
  readonly onChange: (recurrence: TaskRecurrence | null) => void;
  readonly disabled?: boolean;
  readonly className?: string;
};

const UNITS: readonly RecurrenceUnit[] = ["day", "week", "month", "year"];
// Weeks run Monday to Sunday in the toggles.
const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0] as const;

/**
 * Repeat rule picker: presets worded against the due date, plus an inline
 * "Custom" editor (interval, unit, weekdays, from completion, end date).
 * The editor sits inside the task sheet, so on phones it is part of the
 * bottom sheet rather than a popover that could be clipped.
 */
export function RecurrencePicker({ value, dueDate, onChange, disabled = false, className = "" }: Props) {
  const { t, lang } = useI18n();
  const rule = normalizeRecurrence(value);
  const [editing, setEditing] = useState(false);
  const referenceDate = dueDate || localDateKey(new Date());
  const selected: RecurrencePreset = editing ? "custom" : presetOf(rule, referenceDate);
  const dueParts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(referenceDate);
  const dueDay = dueParts ? Number(dueParts[3]) : new Date().getDate();
  const yearDate = dueParts
    ? new Intl.DateTimeFormat(lang, { day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(Date.UTC(2024, Number(dueParts[2]) - 1, dueDay)))
    : "";
  const weekday = weekdayOfKey(referenceDate) ?? new Date().getDay();

  function choose(next: string) {
    if (next === "none") {
      setEditing(false);
      onChange(null);
    } else if (next === "custom") {
      setEditing(true);
      if (!rule) onChange({ interval: 1, unit: "week", daysOfWeek: [weekday] });
    } else {
      setEditing(false);
      onChange(presetRecurrence(next as Exclude<RecurrencePreset, "none" | "custom">, referenceDate));
    }
  }

  function update(changes: Partial<TaskRecurrence>) {
    const merged = { ...(rule ?? { interval: 1, unit: "week" as const }), ...changes };
    if (merged.unit !== "week") delete merged.daysOfWeek;
    onChange(normalizeRecurrence(merged) ?? rule);
  }

  function toggleDay(day: number) {
    const current = rule?.daysOfWeek ?? [];
    const next = current.includes(day) ? current.filter((item) => item !== day) : [...current, day];
    update({ daysOfWeek: next });
  }

  const summary = rule ? describeRecurrence(rule, t, lang, { dueDate }) : t("recurrence.none");

  return (
    <div className={`recurrence-picker ${className}`.trim()}>
      <CustomSelect<string>
        className="custom-select-pill recurrence-picker-select"
        ariaLabel={t("recurrence.label")}
        disabled={disabled}
        value={selected}
        onChange={choose}
        renderTriggerLabel={() => <><Icon name="repeat" aria-hidden="true" /><span className="custom-select-text">{summary}</span></>}
        options={[
          { value: "none", label: t("recurrence.none"), icon: "close" },
          { value: "daily", label: t("recurrence.every.day"), icon: "repeat" },
          { value: "weekdays", label: t("recurrence.picker.weekdaysPreset"), icon: "repeat" },
          { value: "weekly", label: t("recurrence.weekOn", { days: weekdayName(weekday, lang, "long") }), icon: "repeat" },
          { value: "monthly", label: t("recurrence.monthOn", { day: ordinalDay(dueDay, lang) }), icon: "repeat" },
          { value: "yearly", label: t("recurrence.yearOn", { date: yearDate }), icon: "repeat" },
          { value: "custom", label: t("recurrence.picker.custom"), icon: "gear" },
        ]}
      />
      {editing && rule && (
        <fieldset className="recurrence-custom" disabled={disabled}>
          <legend>{t("recurrence.picker.customTitle")}</legend>
          <div className="recurrence-custom-row">
            <label className="recurrence-custom-field">
              <span>{t("recurrence.picker.every")}</span>
              <input
                type="number"
                inputMode="numeric"
                min={1}
                max={MAX_RECURRENCE_INTERVAL}
                value={rule.interval}
                aria-label={t("recurrence.picker.every")}
                onChange={(event) => {
                  const interval = Math.floor(Number(event.target.value));
                  if (Number.isFinite(interval) && interval >= 1 && interval <= MAX_RECURRENCE_INTERVAL) update({ interval });
                }}
              />
            </label>
            <CustomSelect<string>
              className="custom-select-pill recurrence-unit-select"
              ariaLabel={t("recurrence.picker.unit")}
              value={rule.unit}
              onChange={(unit) => update({ unit: unit as RecurrenceUnit, ...(unit === "week" && !rule.daysOfWeek?.length ? { daysOfWeek: [weekday] } : {}) })}
              options={UNITS.map((unit) => ({ value: unit, label: t(`recurrence.picker.units.${unit}`) }))}
            />
          </div>
          {rule.unit === "week" && (
            <div className="recurrence-days" role="group" aria-label={t("recurrence.picker.on")}>
              {WEEKDAY_ORDER.map((day) => {
                const active = rule.daysOfWeek?.includes(day) ?? false;
                return (
                  <button
                    key={day}
                    type="button"
                    className={`recurrence-day ${active ? "active" : ""}`}
                    aria-pressed={active}
                    aria-label={t("recurrence.picker.dayToggle", { day: weekdayName(day, lang, "long") })}
                    onClick={() => toggleDay(day)}
                  >{weekdayName(day, lang).slice(0, 2)}</button>
                );
              })}
            </div>
          )}
          <label className="recurrence-switch">
            <input type="checkbox" checked={rule.basis === "completion"} onChange={(event) => update({ basis: event.target.checked ? "completion" : undefined })} />
            <span>
              {t("recurrence.picker.fromCompletion")}
              <small>{t("recurrence.picker.fromCompletionHint")}</small>
            </span>
          </label>
          <div className="recurrence-end">
            <DateTimePicker
              className="pill"
              value={rule.until ?? ""}
              onChange={(until) => update({ until: until || null })}
              min={dueDate || undefined}
              ariaLabel={t("recurrence.picker.endDate")}
              placeholder={t("recurrence.picker.endDate")}
            />
            {rule.until && <button type="button" className="recurrence-link" onClick={() => update({ until: null })}>{t("recurrence.picker.clearEnd")}</button>}
          </div>
          <div className="recurrence-actions">
            <span className="recurrence-summary">{t("recurrence.picker.summary", { text: summary })}</span>
            <button type="button" className="secondary-button" onClick={() => setEditing(false)}>{t("recurrence.picker.done")}</button>
          </div>
        </fieldset>
      )}
    </div>
  );
}
