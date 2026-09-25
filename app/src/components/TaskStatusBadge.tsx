import type { CSSProperties } from "react";
import { taskStatusTone } from "../lib/taskStatusAppearance";
import "./TaskStatusBadge.css";

export function TaskStatusBadge({ status, category, label }: { status?: string | null; category?: string; label: string }) {
  // Neutral chip; only the status dot carries the workflow color.
  const style = { "--task-status-color": taskStatusTone(status, category).color } as CSSProperties;
  return <span className="task-status-badge" style={style}>
    <span className="task-status-dot" aria-hidden="true" />{label}
  </span>;
}
