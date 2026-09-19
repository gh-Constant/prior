import { taskStatusTone } from "../lib/taskStatusAppearance";
import "./TaskStatusBadge.css";

export function TaskStatusBadge({ status, category, label }: { status?: string | null; category?: string; label: string }) {
  return <span className="task-status-badge" style={taskStatusTone(status, category)}>
    <span className="task-status-dot" aria-hidden="true" />{label}
  </span>;
}
