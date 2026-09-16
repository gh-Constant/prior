import type { Task } from "../types";
import { TaskRow } from "./TaskRow";

type Props = {
  readonly tasks: Task[];
  readonly onChange: (task: Task) => Promise<void>;
  readonly onDelete: (task: Task) => Promise<void>;
  readonly onEdit: (task: Task) => void;
};

export function TaskColumns({ tasks, onChange, onDelete, onEdit }: Props) {
  return (
    <section className="task-columns" aria-label="Task columns">
      {tasks.map((task) => (
        <div className="task-card" key={task.id}>
          <TaskRow task={task} onChange={onChange} onDelete={onDelete} onEdit={onEdit} />
        </div>
      ))}
    </section>
  );
}
