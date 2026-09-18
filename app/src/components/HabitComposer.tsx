import { useEffect, useRef, useState } from "react";
import type { Habit, HabitDraft, HabitUnit } from "../types";
import { dateKey } from "../lib/habits";
import { useModalDialog } from "../hooks/useModalDialog";
import { useI18n } from "../lib/i18n";
import { Icon } from "./Icon";
import { CustomSelect } from "./CustomSelect";

type Vars = Record<string, string | number>;
type TFn = (key: string, vars?: Vars) => string;
type TpFn = (base: string, count: number, vars?: Vars) => string;

const WEEKDAY_SHORT_KEYS = [
  "habits.composer.weekdayShortMon",
  "habits.composer.weekdayShortTue",
  "habits.composer.weekdayShortWed",
  "habits.composer.weekdayShortThu",
  "habits.composer.weekdayShortFri",
  "habits.composer.weekdayShortSat",
  "habits.composer.weekdayShortSun",
] as const;

const WEEKDAY_LONG_KEYS = [
  "habits.composer.weekdayLongMonday",
  "habits.composer.weekdayLongTuesday",
  "habits.composer.weekdayLongWednesday",
  "habits.composer.weekdayLongThursday",
  "habits.composer.weekdayLongFriday",
  "habits.composer.weekdayLongSaturday",
  "habits.composer.weekdayLongSunday",
] as const;

const WEEKDAY_VALUES = [1, 2, 3, 4, 5, 6, 0] as const;

const SCHEDULE_WEEKDAY_KEYS = [
  "habits.schedule.weekdaySunday",
  "habits.schedule.weekdayMonday",
  "habits.schedule.weekdayTuesday",
  "habits.schedule.weekdayWednesday",
  "habits.schedule.weekdayThursday",
  "habits.schedule.weekdayFriday",
  "habits.schedule.weekdaySaturday",
] as const;

function joinLocalizedList(items: string[], lang = "fr"): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0];
  try {
    const formatter = new Intl.ListFormat(lang, { style: "long", type: "conjunction" });
    return formatter.format(items);
  } catch {
    const conj = lang === "fr" ? " et " : lang === "de" ? " und " : lang === "es" ? " y " : lang === "pt" ? " e " : " and ";
    return `${items.slice(0, -1).join(", ")}${conj}${items[items.length - 1]}`;
  }
}

function scheduleLabelFor(input: Pick<Habit, "interval" | "unit" | "daysOfWeek">, t: TFn, tp: TpFn, lang = "fr"): string {
  const interval = Number.isFinite(input.interval) && input.interval > 0 ? Math.floor(input.interval) : 1;
  const selected = [...new Set((input.daysOfWeek ?? []).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))].sort((left, right) => ((left + 6) % 7) - ((right + 6) % 7));
  if (input.unit === "week" && selected.length) {
    if (selected.length === 7) {
      if (interval === 1) {
        return lang === "fr" ? "Tous les jours" : lang === "en" ? "Every day" : tp("habits.schedule.day", 1);
      }
      return t("habits.schedule.everyWeeks", { count: interval, days: lang === "fr" ? "jours" : "days" });
    }
    const dayNames = selected.map((day) => {
      const raw = t(SCHEDULE_WEEKDAY_KEYS[day]);
      if (lang === "fr") {
        return raw.endsWith("s") ? raw : `${raw}s`;
      }
      return raw;
    });
    const days = joinLocalizedList(dayNames, lang);
    return interval === 1
      ? t("habits.schedule.everyDays", { days })
      : t("habits.schedule.everyWeeks", { count: interval, days });
  }
  if (input.unit === "day") {
    if (interval === 1) {
      return lang === "fr" ? "Tous les jours" : lang === "en" ? "Every day" : tp("habits.schedule.day", 1);
    }
    return tp("habits.schedule.day", interval);
  }
  if (input.unit === "week") return tp("habits.schedule.week", interval);
  if (input.unit === "month") return tp("habits.schedule.month", interval);
  return tp("habits.schedule.year", interval);
}

type FrequencyMode = "daily" | "weekdays" | "custom";

type Props = { readonly habit?: Habit; readonly onSave: (input: HabitDraft) => Promise<void>; readonly onCancel: () => void };

function today(): string {
  return dateKey(new Date());
}

function initialMode(habit?: Habit): FrequencyMode {
  if (!habit) return "daily";
  if (habit.unit === "day" && (habit.interval === 1 || !habit.interval) && (!habit.daysOfWeek || habit.daysOfWeek.length === 0)) {
    return "daily";
  }
  if (habit.unit === "week" && (habit.interval === 1 || !habit.interval) && habit.daysOfWeek && habit.daysOfWeek.length > 0) {
    return "weekdays";
  }
  return "custom";
}

export function HabitComposer({ habit, onSave, onCancel }: Props) {
  const { t, tp, lang } = useI18n();
  const editing = Boolean(habit);
  const initialStartDate = habit?.startDate ?? today();
  const [title, setTitle] = useState(habit?.title ?? "");
  const [important, setImportant] = useState(habit?.important ?? false);
  const [urgent, setUrgent] = useState(habit?.urgent ?? false);
  const [interval, setInterval] = useState(habit?.interval ?? 1);
  const [unit, setUnit] = useState<HabitUnit>(habit?.unit ?? "day");
  const [frequencyMode, setFrequencyMode] = useState<FrequencyMode>(() => initialMode(habit));
  const [startDate, setStartDate] = useState(initialStartDate);
  const [endDate, setEndDate] = useState(habit?.endDate ?? "");
  const [daysOfWeek, setDaysOfWeek] = useState<number[]>(habit?.daysOfWeek ?? []);
  const [dateError, setDateError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  useModalDialog(dialogRef);

  useEffect(() => {
    if (typeof window !== "undefined" && window.matchMedia?.("(hover: none)")?.matches) return;
    inputRef.current?.focus();
  }, []);

  function toggleWeekday(value: number) {
    setDaysOfWeek((current) => current.includes(value) ? current.filter((day) => day !== value) : [...current, value].sort((left, right) => left - right));
  }

  function handleFrequencyModeChange(mode: FrequencyMode) {
    setFrequencyMode(mode);
    if (mode === "daily") {
      setUnit("day");
      setInterval(1);
      setDaysOfWeek([]);
    } else if (mode === "weekdays") {
      setUnit("week");
      setInterval(1);
      if (daysOfWeek.length === 0) {
        const defaultDay = new Date(startDate ? `${startDate}T12:00:00` : Date.now()).getDay();
        setDaysOfWeek([defaultDay]);
      }
    }
  }

  function handleUnitChange(nextUnit: HabitUnit) {
    setUnit(nextUnit);
    if (nextUnit !== "week") {
      setDaysOfWeek([]);
      if (nextUnit === "day" && interval === 1 && frequencyMode === "weekdays") {
        setFrequencyMode("daily");
      }
    } else {
      if (interval === 1 && frequencyMode === "daily") {
        setFrequencyMode("weekdays");
      }
    }
    setDateError("");
  }

  async function submit() {
    const clean = title.trim();
    if (!clean) return;
    if (endDate && endDate < startDate) {
      setDateError(t("habits.composer.dateError"));
      return;
    }
    setDateError("");
    await onSave({
      ...(habit ? { id: habit.id, completedDates: habit.completedDates, createdAt: habit.createdAt, updatedAt: habit.updatedAt, deletedAt: habit.deletedAt, serverRevision: habit.serverRevision } : {}),
      title: clean,
      important,
      urgent,
      interval: Math.max(1, Math.floor(interval) || 1),
      unit,
      startDate,
      endDate: endDate || null,
      daysOfWeek: unit === "week" ? daysOfWeek : [],
    });
  }

  function handleCancel(event: React.SyntheticEvent<HTMLDialogElement>) {
    event.preventDefault();
    onCancel();
  }

  const schedule = scheduleLabelFor({ interval, unit, daysOfWeek }, t, tp, lang);

  return (
    <>
      <button type="button" className="modal-backdrop" aria-label={t("habits.composer.closeDialog")} onClick={onCancel} />
      <dialog ref={dialogRef} className="modal composer-modal habit-composer" aria-labelledby="habit-dialog-title" onCancel={handleCancel}>
        <form onSubmit={(event) => { event.preventDefault(); void submit(); }}>
          <div className="modal-header">
            <div><p className="eyebrow">{t("habits.composer.eyebrow")}</p><h2 id="habit-dialog-title">{editing ? t("habits.composer.titleEdit") : t("habits.composer.titleNew")}</h2></div>
            <button type="button" className="icon-button" aria-label={t("habits.composer.close")} onClick={onCancel}><Icon name="close" /></button>
          </div>
          <div className="composer-input-row">
            <span className="composer-mark habit-mark" aria-hidden="true"><Icon name="calendar-check" /></span>
            <input ref={inputRef} value={title} onChange={(event) => setTitle(event.target.value)} placeholder={t("habits.composer.namePlaceholder")} aria-label={t("habits.composer.titleLabel")} />
          </div>

          <div className="habit-frequency-modes" role="radiogroup" aria-label={t("habits.composer.frequencyLabel")}>
            <button
              type="button"
              role="radio"
              aria-checked={frequencyMode === "daily"}
              className={`habit-frequency-btn ${frequencyMode === "daily" ? "active" : ""}`}
              onClick={() => handleFrequencyModeChange("daily")}
            >
              <Icon name="sun" />
              <span>{t("habits.composer.freqDaily")}</span>
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={frequencyMode === "weekdays"}
              className={`habit-frequency-btn ${frequencyMode === "weekdays" ? "active" : ""}`}
              onClick={() => handleFrequencyModeChange("weekdays")}
            >
              <Icon name="calendar-check" />
              <span>{t("habits.composer.freqWeekdays")}</span>
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={frequencyMode === "custom"}
              className={`habit-frequency-btn ${frequencyMode === "custom" ? "active" : ""}`}
              onClick={() => handleFrequencyModeChange("custom")}
            >
              <Icon name="sliders" />
              <span>{t("habits.composer.freqCustom")}</span>
            </button>
          </div>

          <div className="habit-schedule-fields" style={{ display: frequencyMode === "custom" ? "grid" : "none" }}>
            <label className="field">
              <span>{t("habits.composer.repeatEvery")}</span>
              <input type="number" min="1" max="365" value={interval} onChange={(event) => setInterval(Number(event.target.value))} />
            </label>
            <label className="field habit-period-field">
              <span>{t("habits.composer.period")}</span>
              <CustomSelect<HabitUnit>
                ariaLabel={t("habits.composer.period")}
                value={unit}
                onChange={(next) => handleUnitChange(next as HabitUnit)}
                options={[
                  { value: "day", label: t("habits.composer.periodDay") },
                  { value: "week", label: t("habits.composer.periodWeek") },
                  { value: "month", label: t("habits.composer.periodMonth") },
                  { value: "year", label: t("habits.composer.periodYear") },
                ]}
              />
            </label>
          </div>

          {(frequencyMode === "weekdays" || (frequencyMode === "custom" && unit === "week")) && (
            <div className="habit-weekday-picker">
              <div className="habit-field-label">
                <span>{t("habits.composer.onDays")}</span>
                <small>{t("habits.composer.daysHint")}</small>
              </div>
              <div className="habit-quick-presets">
                <button
                  type="button"
                  className={`habit-preset-chip ${[1, 2, 3, 4, 5].every((d) => daysOfWeek.includes(d)) && daysOfWeek.length === 5 ? "active" : ""}`}
                  onClick={() => setDaysOfWeek([1, 2, 3, 4, 5])}
                >
                  {t("habits.composer.presetWorkdays")}
                </button>
                <button
                  type="button"
                  className={`habit-preset-chip ${[6, 0].every((d) => daysOfWeek.includes(d)) && daysOfWeek.length === 2 ? "active" : ""}`}
                  onClick={() => setDaysOfWeek([6, 0])}
                >
                  {t("habits.composer.presetWeekend")}
                </button>
                <button
                  type="button"
                  className={`habit-preset-chip ${daysOfWeek.length === 7 ? "active" : ""}`}
                  onClick={() => setDaysOfWeek([1, 2, 3, 4, 5, 6, 0])}
                >
                  {t("habits.composer.presetAllDays")}
                </button>
              </div>
              <div className="habit-weekday-options" role="group" aria-label={t("habits.composer.daysLabel")}>
                {WEEKDAY_VALUES.map((value, index) => (
                  <button
                    key={value}
                    type="button"
                    className={daysOfWeek.includes(value) ? "selected" : ""}
                    aria-pressed={daysOfWeek.includes(value)}
                    aria-label={t(WEEKDAY_LONG_KEYS[index])}
                    onClick={() => toggleWeekday(value)}
                  >
                    {t(WEEKDAY_SHORT_KEYS[index])}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="habit-date-fields">
            <label className="field"><span>{t("habits.composer.starts")}</span><input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} /></label>
            <label className="field"><span>{t("habits.composer.ends")} <em>{t("habits.composer.optional")}</em></span><input type="date" min={startDate} value={endDate} onChange={(event) => setEndDate(event.target.value)} /></label>
          </div>
          <p className="habit-schedule-preview" aria-live="polite">{schedule} · {endDate ? t("habits.composer.endsOn", { date: endDate }) : t("habits.composer.noEnd")}</p>
          {dateError && <p className="habit-form-error" role="alert">{dateError}</p>}
          <div className="composer-options">
            <button type="button" className={`option-button flag-toggle ${important ? "selected important" : ""}`} aria-pressed={important} onClick={() => setImportant((value) => !value)}><Icon name="star" /> {t("habits.composer.important")}</button>
            <button type="button" className={`option-button flag-toggle ${urgent ? "selected urgent" : ""}`} aria-pressed={urgent} onClick={() => setUrgent((value) => !value)}><Icon name="bolt" /> {t("habits.composer.urgent")}</button>
          </div>
          <div className="modal-footer">
            <button type="button" className="secondary-button" onClick={onCancel}>{t("habits.composer.cancel")}</button>
            <button className="primary-button" type="submit" disabled={!title.trim()}>{editing ? t("habits.composer.save") : t("habits.composer.create")}</button>
          </div>
        </form>
      </dialog>
    </>
  );
}
