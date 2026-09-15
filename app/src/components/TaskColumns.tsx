import type { Task } from "../types";
import { TaskRow } from "./TaskRow";

type Props = {
  tasks: Task[];
  onChange: (task: Task) => Promise<void>;
  onDelete: (task: Task) => Promise<void>;
};

const COLUMNS = [
  { key: "none", label: "No priority" },
  { key: "important", label: "Important" },
  { key: "urgent", label: "Urgent" },
  { key: "both", label: "Both" },
] as const;

type ColumnKey = (typeof COLUMNS)[number]["key"];

function columnFor(task: Task): ColumnKey {
  if (task.important && task.urgent) return "both";
  if (task.important) return "important";
  if (task.urgent) return "urgent";
  return "none";
}

export function TaskColumns({ tasks, onChange, onDelete }: Props) {
  return (
    <div className="task-columns" aria-label="Tasks by priority">
      {COLUMNS.map((column) => {
        const columnTasks = tasks.filter((task) => columnFor(task) === column.key);
        const headingId = `task-column-${column.key}`;

        return (
          <section className={`task-column task-column-${column.key}`} key={column.key} aria-labelledby={headingId}>
            <header className="task-column-header">
              <h2 id={headingId}>{column.label}</h2>
              <span aria-label={`${columnTasks.length} tasks`}>{columnTasks.length}</span>
            </header>
            <div className="task-column-list">
              {columnTasks.map((task) => <TaskRow key={task.id} task={task} onChange={onChange} onDelete={onDelete} />)}
            </div>
          </section>
        );
      })}
    </div>
  );
}
