import type { Task } from "../../types";
import { useI18n } from "../../lib/i18n";
import { describeRecurrence, normalizeRecurrence } from "../../lib/recurrence";
import { Icon } from "../Icon";
import "./TaskExtras.css";

/** Repeat glyph and a short summary ("Daily", "Every 2 weeks"); nothing for a task that does not repeat. */
export function RecurrenceChip({ task, variant = "task" }: { readonly task: Pick<Task, "recurrence" | "dueDate">; readonly variant?: "task" | "project" }) {
  const { t, lang } = useI18n();
  const rule = normalizeRecurrence(task.recurrence);
  if (!rule) return null;
  const full = describeRecurrence(rule, t, lang, { dueDate: task.dueDate });
  const label = t("recurrence.chipLabel", { text: full });
  return (
    <span className={`${variant === "project" ? "project-chip" : "task-chip"} task-recurrence-chip`} role="img" aria-label={label} title={full}>
      <Icon name="repeat" />{describeRecurrence(rule, t, lang, { dueDate: task.dueDate, short: true })}
    </span>
  );
}
