import type { ImportRecurrence } from "./types";

/**
 * HOOK (recurring tasks): turn a repeat phrase from an export ("every
 * monday", "every! 2 weeks", "tous les lundis") into a recurrence.
 *
 * Returns null until `Task.recurrence` exists in this branch; the importers
 * then keep the phrase as "Repeats: <text>" in the description. When the
 * recurrence feature is merged, implement this by reusing the quick-add
 * parser (`taskTitleParser.ts`) or `lib/recurrence.ts`. `importTasks`
 * (App.tsx) already passes `PlanTask.recurrence` on to `localStore.saveTask`,
 * which stores it once `TaskDraft` has the field.
 */
export function toRecurrence(_text: string): ImportRecurrence | null {
  return null;
}
