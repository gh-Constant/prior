import type { Task } from "../types";
import { TaskRow } from "./TaskRow";

type Props = {
  tasks: Task[];
  onChange: (task: Task) => Promise<void>;
  onDelete: (task: Task) => Promise<void>;
};

export function TaskColumns({ tasks, onChange, onDelete }: Props) {
  return (
    <section className="task-columns" aria-label="Task columns">
      {tasks.map((task) => (
        <div className="task-card" key={task.id}>
          <TaskRow task={task} onChange={onChange} onDelete={onDelete} />
        </div>
      ))}
    </section>
  );
}
