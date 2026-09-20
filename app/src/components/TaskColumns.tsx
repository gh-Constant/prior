import type { Project, Task } from "../types";
import { useI18n } from "../lib/i18n";
import { TaskRow } from "./TaskRow";

type Props = {
  readonly tasks: Task[];
  readonly onChange: (task: Task) => Promise<void>;
  readonly onDelete: (task: Task) => Promise<void>;
  readonly onEdit: (task: Task) => void;
  readonly projects?: readonly Project[];
  readonly hideNextStatus?: boolean;
};

export function TaskColumns({ tasks, onChange, onDelete, onEdit, projects = [], hideNextStatus = false }: Props) {
  const { t } = useI18n();
  const projectById = new Map(projects.map((project) => [project.id, project]));
  return (
    <section className="task-columns" aria-label={t("tasks.columns.label")}>
      {tasks.map((task) => (
        <div className="task-card" key={task.id}>
          <TaskRow task={task} project={task.projectId ? projectById.get(task.projectId) ?? null : null} hideNextStatus={hideNextStatus} onChange={onChange} onDelete={onDelete} onEdit={onEdit} />
        </div>
      ))}
    </section>
  );
}
