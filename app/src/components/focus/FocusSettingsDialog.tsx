import { useI18n } from "../../lib/i18n";
import { POMODORO_PRESETS, pomodoroStore, updateSettings, usePomodoro, type PomodoroSettings } from "../../lib/pomodoro";
import { Modal } from "../Modal";

type NumberKey = "focusMinutes" | "breakMinutes" | "longBreakMinutes" | "longEvery";

function Stepper({ label, value, min, max, step, unit, onChange }: { readonly label: string; readonly value: number; readonly min: number; readonly max: number; readonly step: number; readonly unit: string; readonly onChange: (value: number) => void }) {
  const clamp = (next: number) => Math.min(max, Math.max(min, next));
  return (
    <div className="focus-stepper">
      <span className="focus-stepper-label">{label}</span>
      <div className="focus-stepper-control" role="group" aria-label={label}>
        <button type="button" aria-label={`${label} −`} disabled={value <= min} onClick={() => onChange(clamp(value - step))}>−</button>
        <output aria-live="polite"><strong>{value}</strong> <span>{unit}</span></output>
        <button type="button" aria-label={`${label} +`} disabled={value >= max} onClick={() => onChange(clamp(value + step))}>+</button>
      </div>
    </div>
  );
}

/** Durations, rhythm presets, auto-start and sound for the Focus timer. */
export function FocusSettingsDialog({ onClose }: { readonly onClose: () => void }) {
  const { t } = useI18n();
  const { settings } = usePomodoro();
  const apply = (patch: Partial<PomodoroSettings>) => pomodoroStore.update((state) => updateSettings(state, patch));
  const setNumber = (key: NumberKey) => (value: number) => apply({ [key]: value });
  const minutes = t("focus.settings.minutes");

  return (
    <Modal title={t("focus.settings.title")} onClose={onClose} className="focus-settings-modal" maxWidth={480}>
      <div className="prior-modal-body focus-settings">
        <div className="focus-presets" role="radiogroup" aria-label={t("focus.settings.rhythm")}>
          {POMODORO_PRESETS.map((preset) => {
            const active = settings.focusMinutes === preset.focusMinutes && settings.breakMinutes === preset.breakMinutes && settings.longBreakMinutes === preset.longBreakMinutes;
            return (
              <button key={preset.id} type="button" role="radio" aria-checked={active} className={`focus-preset ${active ? "is-active" : ""}`} onClick={() => apply({ focusMinutes: preset.focusMinutes, breakMinutes: preset.breakMinutes, longBreakMinutes: preset.longBreakMinutes })}>
                <strong>{t(`focus.settings.presets.${preset.id}`)}</strong>
                <span>{preset.focusMinutes} / {preset.breakMinutes} min</span>
              </button>
            );
          })}
        </div>
        <Stepper label={t("focus.phase.focus")} value={settings.focusMinutes} min={5} max={120} step={5} unit={minutes} onChange={setNumber("focusMinutes")} />
        <Stepper label={t("focus.phase.break")} value={settings.breakMinutes} min={1} max={30} step={1} unit={minutes} onChange={setNumber("breakMinutes")} />
        <Stepper label={t("focus.phase.long")} value={settings.longBreakMinutes} min={5} max={60} step={5} unit={minutes} onChange={setNumber("longBreakMinutes")} />
        <Stepper label={t("focus.settings.longEvery")} value={settings.longEvery} min={2} max={8} step={1} unit={t("focus.settings.sessionsUnit")} onChange={setNumber("longEvery")} />
        <div className="focus-switch-row">
          <span><strong>{t("focus.settings.autoStart")}</strong><small>{t("focus.settings.autoStartHint")}</small></span>
          <button type="button" role="switch" className="focus-switch" aria-checked={settings.autoStart} aria-label={t("focus.settings.autoStart")} onClick={() => apply({ autoStart: !settings.autoStart })} />
        </div>
        <div className="focus-switch-row">
          <span><strong>{t("focus.settings.sound")}</strong><small>{t("focus.settings.soundHint")}</small></span>
          <button type="button" role="switch" className="focus-switch" aria-checked={settings.sound} aria-label={t("focus.settings.sound")} onClick={() => apply({ sound: !settings.sound })} />
        </div>
      </div>
    </Modal>
  );
}
