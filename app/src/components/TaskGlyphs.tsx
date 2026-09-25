import type { TaskPriority, TaskStatus } from "../types";
import "./TaskList.css";

/** Linear-like workflow glyph: the shape carries the state, colour is secondary. */
export function StatusGlyph({ status, label }: { readonly status: TaskStatus; readonly label?: string }) {
  return <span className={`status-glyph status-glyph-${status}`} role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true} />;
}

/** Priority bars (P2–P4) or the coral urgent square for P1. */
export function PriorityGlyph({ priority, label }: { readonly priority: TaskPriority; readonly label: string }) {
  if (priority === 1) return <span className="priority-glyph priority-glyph-1" role="img" aria-label={label} title={label}>!</span>;
  return <span className={`priority-glyph priority-glyph-${priority}`} role="img" aria-label={label} title={label}><i /><i /><i /></span>;
}

/** Two-letter avatar derived from a real assignee name. */
export function InitialsAvatar({ initials, name }: { readonly initials: string; readonly name: string }) {
  return <span className="task-avatar" title={name} role="img" aria-label={name}>{initials}</span>;
}

/** Outline calendar used by due-date chips (the shared icon set only has a filled one). */
export function CalendarGlyph() {
  return (
    <svg className="task-glyph-svg" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2.5" y="3.5" width="11" height="10" rx="2" />
      <path d="M2.5 6.5h11M5.5 2v3M10.5 2v3" />
    </svg>
  );
}

/** Horizontal ellipsis for "more actions" buttons. */
export function MoreGlyph() {
  return (
    <svg className="task-glyph-svg" viewBox="0 0 16 16" aria-hidden="true" fill="currentColor">
      <circle cx="3.5" cy="8" r="1.25" />
      <circle cx="8" cy="8" r="1.25" />
      <circle cx="12.5" cy="8" r="1.25" />
    </svg>
  );
}
