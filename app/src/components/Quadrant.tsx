import type { QuadrantKey, Task } from "../types";
import { TaskRow } from "./TaskRow";

type Props = { id: QuadrantKey; label: string; helper: string; tasks: Task[]; onChange: (task: Task) => Promise<void>; onDelete: (task: Task) => Promise<void> };

export function Quadrant({ id, label, helper, tasks, onChange, onDelete }: Props) {
  return (
    <section className={`quadrant quadrant-${id}`} aria-labelledby={`${id}-heading`}>
      <header className="quadrant-header">
        <div><h2 id={`${id}-heading`}>{label}</h2><p>{helper}</p></div>
        <span className="quadrant-count">{tasks.length || "—"}</span>
      </header>
      <div className="task-list">
        {tasks.length === 0 ? <p className="empty-quadrant">Nothing here yet</p> : tasks.map((task) => <TaskRow key={task.id} task={task} onChange={onChange} onDelete={onDelete} />)}
      </div>
    </section>
  );
}
