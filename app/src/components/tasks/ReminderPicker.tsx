import { useState } from "react";
import type { Task } from "../../types";
import { useI18n } from "../../lib/i18n";
import { requestNotificationPermission } from "../../lib/notificationScheduler";
import { fromDateTimeLocal, reminderPresets, toDateTimeLocal, type ReminderPreset } from "../../lib/reminders";
import { CustomSelect } from "../CustomSelect";
import "./TaskExtras.css";

type Props = {
  readonly task: Pick<Task, "dueDate" | "dueTime">;
  readonly value: string | null | undefined;
  readonly onChange: (reminderAt: string | null) => void;
  readonly disabled?: boolean;
  readonly className?: string;
};

export function formatReminder(iso: string, lang: string, now = new Date()): string {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return "";
  const sameYear = date.getFullYear() === now.getFullYear();
  return date.toLocaleString(lang, { weekday: "short", day: "numeric", month: "short", ...(sameYear ? {} : { year: "numeric" }), hour: "2-digit", minute: "2-digit" });
}

/** Reminder presets ("at due time", "10 min before"…) plus a custom time. */
export function ReminderPicker({ task, value, onChange, disabled = false, className = "" }: Props) {
  const { t, lang } = useI18n();
  const presets = reminderPresets(task);
  const [custom, setCustom] = useState(false);
  const current = value ?? null;
  const matching = current ? presets.find((preset) => preset.at === new Date(current).toISOString()) : undefined;
  const selected = custom ? "custom" : !current ? "none" : matching ? matching.preset : "custom";

  function choose(next: ReminderPreset | "none" | "custom") {
    if (next === "none") {
      setCustom(false);
      onChange(null);
      return;
    }
    if (next === "custom") {
      setCustom(true);
      return;
    }
    setCustom(false);
    const preset = presets.find((item) => item.preset === next);
    if (!preset) return;
    // Ask for notification permission when the first reminder is set.
    void requestNotificationPermission().catch(() => undefined);
    onChange(preset.at);
  }

  return (
    <div className={`reminder-picker ${className}`.trim()}>
      <CustomSelect<string>
        className="custom-select-pill reminder-picker-select"
        ariaLabel={t("reminders.picker.label")}
        disabled={disabled}
        value={selected}
        onChange={(next) => choose(next as ReminderPreset | "none" | "custom")}
        renderTriggerLabel={() => <span className="custom-select-text">{current ? t("reminders.picker.set", { when: formatReminder(current, lang) }) : t("reminders.picker.none")}</span>}
        options={[
          { value: "none", label: t("reminders.picker.none"), icon: "bell" },
          ...presets.map((preset) => ({ value: preset.preset, label: `${t(`reminders.presets.${preset.preset}`)} · ${formatReminder(preset.at, lang)}`, icon: "bell" as const })),
          { value: "custom", label: t("reminders.presets.custom"), icon: "clock" },
        ]}
      />
      {selected === "custom" && (
        <input
          type="datetime-local"
          className="reminder-picker-custom"
          aria-label={t("reminders.picker.custom")}
          disabled={disabled}
          value={toDateTimeLocal(current)}
          onChange={(event) => {
            const next = fromDateTimeLocal(event.target.value);
            if (next) void requestNotificationPermission().catch(() => undefined);
            onChange(next);
          }}
        />
      )}
    </div>
  );
}
