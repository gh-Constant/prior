import type { QuadrantKey, Task } from "../types";
import { TaskRow } from "./TaskRow";

type Props = { id: QuadrantKey; label: string; tasks: Task[]; onChange: (task: Task) => Promise<void>; onDelete: (task: Task) => Promise<void>; onEdit: (task: Task) => void };

export function Quadrant({ id, label, tasks, onChange, onDelete, onEdit }: Props) {
  return (
    <section className={`quadrant quadrant-${id}`} aria-labelledby={`${id}-heading`}>
      <header className="quadrant-header">
        <div><span className="quadrant-dot" aria-hidden="true" /><h2 id={`${id}-heading`}>{label}</h2></div>
      </header>
      <div className="task-list">
        {tasks.map((task) => <TaskRow key={task.id} task={task} onChange={onChange} onDelete={onDelete} onEdit={onEdit} hideFlags />)}
      </div>
    </section>
  );
}
