import { useMemo } from "react";
import { useI18n } from "../../lib/i18n";
import { savePlanningSettings } from "../../lib/planning";
import { DEFAULT_PLANNING_SETTINGS, type PeakWindow, type PlanningSettings } from "../../lib/timeBlocking";
import { useHostedAiAvailable } from "../../hooks/useHostedAi";
import { usePlanningSettings } from "../../hooks/useTimeBlocking";
import { CustomSelect } from "../CustomSelect";
import { SettingsRow, SettingsSection } from "../SettingsLayout";
import "./Planning.css";

const PEAKS: readonly PeakWindow[] = ["morning", "afternoon", "evening", "none"];
const PEAK_KEYS: Record<PeakWindow, string> = { morning: "peakMorning", afternoon: "peakAfternoon", evening: "peakEvening", none: "peakNone" };
// Monday first, as in the calendar.
const WEEK = [1, 2, 3, 4, 5, 6, 0];

function Switch({ id, checked, onChange, disabled }: { readonly id: string; readonly checked: boolean; readonly onChange: (value: boolean) => void; readonly disabled?: boolean }) {
  return <button id={id} type="button" role="switch" className="settings-switch" aria-checked={checked} disabled={disabled} onClick={() => onChange(!checked)} />;
}

/** Settings → Time blocking (also shown in a dialog from the calendar and Today). */
export function PlanningSettingsPanel() {
  const { t, tp, lang } = useI18n();
  const settings = usePlanningSettings();
  const hosted = useHostedAiAvailable();
  const off = !settings.enabled;
  const weekdayNames = useMemo(() => {
    const format = new Intl.DateTimeFormat(lang, { weekday: "short" });
    // 4 January 2026 is a Sunday.
    return Array.from({ length: 7 }, (_, day) => format.format(new Date(2026, 0, 4 + day)));
  }, [lang]);
  const minutes = (count: number) => t("planning.settings.minutes", { count });
  const minuteOptions = (values: readonly number[]) => values.map((value) => ({ value, label: value >= 60 && value % 60 === 0 ? `${value / 60} h` : minutes(value) }));

  function update(patch: Partial<PlanningSettings>) {
    savePlanningSettings({ ...settings, ...patch });
  }

  const lunch = Boolean(settings.lunchStart && settings.lunchEnd);
  return (
    <>
      <SettingsSection title={t("planning.settings.title")}>
        <SettingsRow label={t("planning.settings.enabled")} htmlFor="planning-enabled" description={t("planning.settings.enabledHint")}>
          <Switch id="planning-enabled" checked={settings.enabled} onChange={(enabled) => update({ enabled })} />
        </SettingsRow>
        <SettingsRow label={t("planning.settings.ai")} htmlFor="planning-ai" description={<>
          {t("planning.settings.aiHint")}
          {hosted === false && <span className="settings-row-note">{t("planning.settings.aiUnavailable")}</span>}
        </>}>
          <Switch id="planning-ai" checked={settings.useAI} disabled={off} onChange={(useAI) => update({ useAI })} />
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title={t("planning.settings.workHours")}>
        <SettingsRow label={t("planning.settings.workDays")}>
          <div className="planning-days" role="group" aria-label={t("planning.settings.workDays")}>
            {WEEK.map((day) => {
              const active = settings.workDays.includes(day);
              return <button key={day} type="button" className={`planning-day${active ? " is-active" : ""}`} aria-pressed={active} disabled={off} onClick={() => update({ workDays: active ? settings.workDays.filter((item) => item !== day) : [...settings.workDays, day] })}>{weekdayNames[day]}</button>;
            })}
          </div>
        </SettingsRow>
        <SettingsRow label={t("planning.settings.workHours")}>
          <div className="settings-inline-actions">
            <input type="time" className="planning-time" aria-label={`${t("planning.settings.workHours")} · ${t("planning.settings.from")}`} value={settings.dayStart} disabled={off} onChange={(event) => event.target.value && update({ dayStart: event.target.value })} />
            <span aria-hidden="true">–</span>
            <input type="time" className="planning-time" aria-label={`${t("planning.settings.workHours")} · ${t("planning.settings.to")}`} value={settings.dayEnd} disabled={off} onChange={(event) => event.target.value && update({ dayEnd: event.target.value })} />
          </div>
        </SettingsRow>
        <SettingsRow label={t("planning.settings.lunch")} htmlFor="planning-lunch" description={t("planning.settings.lunchHint")}>
          <div className="settings-inline-actions">
            <Switch id="planning-lunch" checked={lunch} disabled={off} onChange={(value) => update(value ? { lunchStart: "12:00", lunchEnd: "13:00" } : { lunchStart: null, lunchEnd: null })} />
            {lunch && <>
              <input type="time" className="planning-time" aria-label={`${t("planning.settings.lunch")} · ${t("planning.settings.from")}`} value={settings.lunchStart ?? ""} disabled={off} onChange={(event) => event.target.value && update({ lunchStart: event.target.value })} />
              <span aria-hidden="true">–</span>
              <input type="time" className="planning-time" aria-label={`${t("planning.settings.lunch")} · ${t("planning.settings.to")}`} value={settings.lunchEnd ?? ""} disabled={off} onChange={(event) => event.target.value && update({ lunchEnd: event.target.value })} />
            </>}
          </div>
        </SettingsRow>
        <SettingsRow label={t("planning.settings.peak")} description={t("planning.settings.peakHint")}>
          <div className="settings-select">
            <CustomSelect id="planning-peak" ariaLabel={t("planning.settings.peak")} value={settings.peak} disabled={off} onChange={(peak) => update({ peak: peak as PeakWindow })} options={PEAKS.map((peak) => ({ value: peak, label: t(`planning.settings.${PEAK_KEYS[peak]}`) }))} />
          </div>
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title={t("planning.settings.blocks")} footer={<button type="button" className="secondary-button" disabled={off} onClick={() => savePlanningSettings({ ...DEFAULT_PLANNING_SETTINGS, enabled: settings.enabled, useAI: settings.useAI })}>{t("planning.settings.reset")}</button>}>
        <SettingsRow label={t("planning.settings.blocks")} description={t("planning.settings.blocksHint")}>
          <div className="settings-inline-actions">
            <div className="settings-select planning-select"><CustomSelect id="planning-min-block" ariaLabel={t("planning.settings.minBlock")} value={settings.minBlockMinutes} disabled={off} onChange={(value) => update({ minBlockMinutes: Number(value), maxBlockMinutes: Math.max(Number(value), settings.maxBlockMinutes) })} options={minuteOptions([15, 20, 25, 30, 45, 60])} /></div>
            <span aria-hidden="true">–</span>
            <div className="settings-select planning-select"><CustomSelect id="planning-max-block" ariaLabel={t("planning.settings.maxBlock")} value={settings.maxBlockMinutes} disabled={off} onChange={(value) => update({ maxBlockMinutes: Number(value), minBlockMinutes: Math.min(Number(value), settings.minBlockMinutes) })} options={minuteOptions([30, 45, 60, 90, 120, 180, 240])} /></div>
          </div>
        </SettingsRow>
        <SettingsRow label={t("planning.settings.dailyLimit")} description={t("planning.settings.dailyLimitHint")}>
          <div className="settings-select planning-select"><CustomSelect id="planning-daily" ariaLabel={t("planning.settings.dailyLimit")} value={settings.dailyFocusMinutes} disabled={off} onChange={(value) => update({ dailyFocusMinutes: Number(value) })} options={minuteOptions([120, 180, 240, 300, 360, 420, 480, 600])} /></div>
        </SettingsRow>
        <SettingsRow label={t("planning.settings.buffer")} description={t("planning.settings.bufferHint")}>
          <div className="settings-select planning-select"><CustomSelect id="planning-buffer" ariaLabel={t("planning.settings.buffer")} value={settings.bufferMinutes} disabled={off} onChange={(value) => update({ bufferMinutes: Number(value) })} options={[{ value: 0, label: "0" }, ...minuteOptions([5, 10, 15, 30])]} /></div>
        </SettingsRow>
        <SettingsRow label={t("planning.settings.breaks")}>
          <div className="settings-select planning-select"><CustomSelect id="planning-breaks" ariaLabel={t("planning.settings.breaks")} value={settings.breakMinutes} disabled={off} onChange={(value) => update({ breakMinutes: Number(value) })} options={[{ value: 0, label: "0" }, ...minuteOptions([5, 10, 15])]} /></div>
        </SettingsRow>
        <SettingsRow label={t("planning.settings.defaultDuration")} description={t("planning.settings.defaultDurationHint")}>
          <div className="settings-select planning-select"><CustomSelect id="planning-default" ariaLabel={t("planning.settings.defaultDuration")} value={settings.defaultMinutes} disabled={off} onChange={(value) => update({ defaultMinutes: Number(value) })} options={minuteOptions([15, 30, 45, 60, 90])} /></div>
        </SettingsRow>
        <SettingsRow label={t("planning.settings.horizon")}>
          <div className="settings-select planning-select"><CustomSelect id="planning-horizon" ariaLabel={t("planning.settings.horizon")} value={settings.horizonDays} disabled={off} onChange={(value) => update({ horizonDays: Number(value) })} options={[3, 5, 7, 14].map((value) => ({ value, label: tp("planning.settings.days", value) }))} /></div>
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title={t("planning.settings.calendarsTitle")}>
        <SettingsRow label={t("planning.settings.calendarsTitle")} description={t("planning.settings.calendarsHint")} />
      </SettingsSection>
    </>
  );
}
