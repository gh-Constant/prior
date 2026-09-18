import type { Project, Task } from "../types";
import { TaskRow } from "./TaskRow";

type Props = {
  readonly tasks: Task[];
  readonly onChange: (task: Task) => Promise<void>;
  readonly onDelete: (task: Task) => Promise<void>;
  readonly onEdit: (task: Task) => void;
  readonly projects?: readonly Project[];
};

export function TaskColumns({ tasks, onChange, onDelete, onEdit, projects = [] }: Props) {
  const projectById = new Map(projects.map((project) => [project.id, project]));
  return (
    <section className="task-columns" aria-label="Task columns">
      {tasks.map((task) => (
        <div className="task-card" key={task.id}>
          <TaskRow task={task} project={task.projectId ? projectById.get(task.projectId) ?? null : null} onChange={onChange} onDelete={onDelete} onEdit={onEdit} />
        </div>
      ))}
    </section>
  );
}
