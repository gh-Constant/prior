import type { Project, QuadrantKey, Task } from "../types";
import { TaskRow } from "./TaskRow";

type Props = { readonly id: QuadrantKey; readonly label: string; readonly tasks: Task[]; readonly onChange: (task: Task) => Promise<void>; readonly onDelete: (task: Task) => Promise<void>; readonly onEdit: (task: Task) => void; readonly projects?: readonly Project[]; readonly hideNextStatus?: boolean };

export function Quadrant({ id, label, tasks, onChange, onDelete, onEdit, projects = [], hideNextStatus = false }: Props) {
  const projectById = new Map(projects.map((project) => [project.id, project]));
  return (
    <section className={`quadrant quadrant-${id}`} aria-labelledby={`${id}-heading`}>
      <header className="quadrant-header">
        <div><span className="quadrant-dot" aria-hidden="true" /><h2 id={`${id}-heading`}>{label}</h2></div>
      </header>
      <div className="task-list">
        {tasks.map((task) => <TaskRow key={task.id} task={task} project={task.projectId ? projectById.get(task.projectId) ?? null : null} onChange={onChange} onDelete={onDelete} onEdit={onEdit} hideFlags hideNextStatus={hideNextStatus} />)}
      </div>
    </section>
  );
}
