import type { CSSProperties } from "react";

export type StatusTone = { color: string; background: string; borderColor: string };
const tones = {
  neutral: { color: "#596273", background: "#f1f3f5", borderColor: "#dce1e7" },
  todo: { color: "#2563b8", background: "#edf4ff", borderColor: "#cbdffc" },
  progress: { color: "#956000", background: "#fff6d9", borderColor: "#eedb9f" },
  waiting: { color: "#7950b3", background: "#f4eeff", borderColor: "#dfcef5" },
  done: { color: "#237347", background: "#eaf7ef", borderColor: "#c2e5cf" },
  canceled: { color: "#b34343", background: "#fff0f0", borderColor: "#efcccc" },
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
