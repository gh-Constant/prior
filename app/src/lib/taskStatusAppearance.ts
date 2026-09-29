import type { CSSProperties } from "react";

export type StatusTone = { color: string; background: string; borderColor: string };
// CSS custom properties (index.css, --status-*) so the palette follows the light/dark theme.
function tone(name: string): StatusTone {
  return { color: `var(--status-${name})`, background: `var(--status-${name}-soft)`, borderColor: `var(--status-${name}-line)` };
}
const tones = {
  neutral: tone("neutral"),
  todo: tone("todo"),
  progress: tone("progress"),
  waiting: tone("waiting"),
  done: tone("done"),
  canceled: tone("canceled"),
} satisfies Record<string, StatusTone>;

/** Stable IDs, never translated labels, determine the shared workflow palette. */
export function taskStatusTone(status?: string | null, category?: string): StatusTone {
  switch (status) {
    case "inbox": case "backlog": return tones.neutral;
    case "next": case "todo": return tones.todo;
    case "in_progress": return tones.progress;
    case "waiting": return tones.waiting;
    case "done": return tones.done;
    case "canceled": case "cancelled": return tones.canceled;
  }
  switch (category) {
    case "unstarted": return tones.todo;
    case "started": return tones.progress;
    case "completed": return tones.done;
    case "canceled": return tones.canceled;
    default: return tones.neutral;
  }
}

export function taskStatusVariables(status?: string | null, category?: string): CSSProperties {
  const tone = taskStatusTone(status, category);
  return { "--task-status-color": tone.color, "--task-status-background": tone.background, "--task-status-border": tone.borderColor } as CSSProperties;
}
