import type { QuadrantKey, Task } from "../types";

export const QUADRANTS: ReadonlyArray<{
  key: QuadrantKey;
  label: string;
  helper: string;
  important: boolean;
  urgent: boolean;
}> = [
  { key: "focus", label: "Important + urgent", helper: "Important and urgent", important: true, urgent: true },
  { key: "plan", label: "Important", helper: "Important, not urgent", important: true, urgent: false },
  { key: "quick", label: "Urgent", helper: "Urgent, not important", important: false, urgent: true },
  { key: "later", label: "No priority", helper: "Neither urgent nor important", important: false, urgent: false },
];

export function quadrantFor(task: Pick<Task, "important" | "urgent">): QuadrantKey {
  if (task.important && task.urgent) return "focus";
  if (task.important) return "plan";
  if (task.urgent) return "quick";
  return "later";
}
