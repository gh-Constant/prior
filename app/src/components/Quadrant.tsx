import type { QuadrantKey, Task } from "../types";
import { TaskRow } from "./TaskRow";

type Props = { readonly id: QuadrantKey; readonly label: string; readonly tasks: Task[]; readonly onChange: (task: Task) => Promise<void>; readonly onDelete: (task: Task) => Promise<void>; readonly onEdit: (task: Task) => void };

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
